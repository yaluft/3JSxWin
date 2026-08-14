// Wallpaper scenes plus the original aurora.
// Each is one full-screen quad, same five-color palette, one draw.

import * as THREE from 'three';
import { hexToRgb } from './config.js';
import { createSky } from './sky.js';
import { ASCII_GBUFFER, ASCII_SCENE_IDS, createAsciiBackdrop } from './ascii.js?v=3';
export { SCENE_IDS, SCENE_META } from './scenes-meta.js';
import { SCENE_IDS } from './scenes-meta.js';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMMON = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform vec3  uVoid;
  uniform vec3  uTide;
  uniform vec3  uVerdant;
  uniform vec3  uIris;
  uniform vec3  uFrost;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uHeight;
  uniform float uHorizonY;
  uniform float uHorizonGlow;
  uniform float uReflection;
  uniform float uStars;
  uniform float uTwinkle;
  uniform float uGrain;
  uniform float uVignette;
  uniform int   uOctaves;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 8; i++) {
      if (i >= uOctaves) break;
      sum += amp * vnoise(p);
      p = rot * p * 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  vec3 finish(vec3 col, vec2 uv) {
    col *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.4), 0.0, 1.0);
    col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (uGrain + 1.0 / 255.0);
    return max(col, 0.0);
  }
`;

const TERRASCII = ASCII_GBUFFER + /* glsl */ `
  // Landscape of horizontal tubes riding a dune field — same ASCII pass as the tube demo.
  float terrainH(vec2 p, float t) {
    return fbm(p * 0.55 + vec2(t * 0.18, 0.0)) * 0.7
         + fbm(p * 1.6 - vec2(0.0, t * 0.11)) * 0.28;
  }

  float sdCylX(vec3 p, float r) {
    return length(p.yz) - r;
  }

  float mapField(vec3 p, float t) {
    float spacing = 0.28;
    float idz = floor(p.z / spacing);
    float lz = p.z - (idz + 0.5) * spacing;
    float h = terrainH(vec2(p.x, idz * spacing), t);
    float wave = 0.06 * sin(p.x * 3.2 + idz * 0.7 - t * 2.4);
    return sdCylX(vec3(p.x, p.y - h - wave, lz), 0.07 + 0.02 * sin(idz));
  }

  vec3 fieldNormal(vec3 p, float t) {
    vec2 e = vec2(0.02, 0.0);
    float h = mapField(p, t);
    return normalize(vec3(
      mapField(p + e.xyy, t) - h,
      mapField(p + e.yxy, t) - h,
      mapField(p + e.yyx, t) - h
    ));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.22 + uSpeed * 1.8);
    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.38);

    vec3 ro = vec3(t * 1.15, 0.85, 0.1);
    vec3 rd = normalize(vec3(p.x, p.y - 0.12, 1.15));
    float dAcc = 0.05;
    float hit = -1.0;
    for (int i = 0; i < 56; i++) {
      float d = mapField(ro + rd * dAcc, t);
      if (d < 0.008) { hit = dAcc; break; }
      dAcc += clamp(d, 0.01, 0.28);
      if (dAcc > 18.0) break;
    }

    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec3 pos = ro + rd * hit;
    vec3 nrm = fieldNormal(pos, t);
    vec3 sun = normalize(vec3(0.55, 0.65, 0.2));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.85);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 22.0);
    float fog = exp(-hit * 0.07);
    gl_FragColor = asciiLit(diff, spec, fog, 0.0);
  }
`;

const HEXASCII = ASCII_GBUFFER + /* glsl */ `
  // Instanced vertical tubes deformed by traveling ripples —
  // https://offscreencanvas.com/renders/webgl-ascii/

  float sdCylY(vec3 p, float r, float h) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  float mapTubes(vec3 p, float t) {
    float spacing = 0.26;
    vec2 id = floor(p.xz / spacing);
    vec2 l = p.xz - (id + 0.5) * spacing;
    vec2 wp = (id + 0.5) * spacing;

    vec2 src1 = vec2(sin(t * 0.37) * 3.2, cos(t * 0.29) * 3.2);
    vec2 src2 = vec2(cos(t * 0.21) * 2.6, sin(t * 0.33) * 2.6);
    float d1 = length(wp - src1);
    float d2 = length(wp - src2);
    float wave = sin(d1 * 2.5 - t * 4.2) * exp(-d1 * 0.16)
               + 0.7 * sin(d2 * 1.9 - t * 3.1) * exp(-d2 * 0.18);

    float h = 0.7 + 1.15 * (0.5 + 0.5 * wave);
    float r = 0.072 + 0.032 * (0.5 + 0.5 * wave);
    float lift = wave * 0.38;
    return sdCylY(vec3(l.x, p.y - lift, l.y), r, h);
  }

  vec3 tubeNormal(vec3 p, float t) {
    vec2 e = vec2(0.012, 0.0);
    float h = mapTubes(p, t);
    return normalize(vec3(
      mapTubes(p + e.xyy, t) - h,
      mapTubes(p + e.yxy, t) - h,
      mapTubes(p + e.yyx, t) - h
    ));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.28 + uSpeed * 2.0);
    vec2 p = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.42);

    vec3 ro = vec3(0.15, 1.05, -1.55);
    vec3 ta = vec3(0.55, 0.05, 2.1);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
    vec3 vv = cross(ww, uu);
    vec3 rd = normalize(p.x * uu + p.y * vv + 1.25 * ww);

    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 72; i++) {
      float d = mapTubes(ro + rd * dAcc, t);
      if (d < 0.006) { hit = dAcc; break; }
      dAcc += clamp(d, 0.008, 0.22);
      if (dAcc > 14.0) break;
    }

    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec3 pos = ro + rd * hit;
    vec3 nrm = tubeNormal(pos, t);
    vec3 sun = normalize(vec3(0.65, 0.55, 0.35));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.8);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 28.0);
    float fog = exp(-hit * 0.055);
    gl_FragColor = asciiLit(diff, spec, fog, 0.0);
  }
`;

const STARWELL = COMMON + /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.18 + uSpeed * 2.4);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float r = length(p);
    float a = atan(p.y, p.x);

    // Logarithmic spiral well.
    float well = log(max(r, 0.002)) * 3.2 - t;
    float rings = 0.5 + 0.5 * sin(well * 6.0 + a * 3.0);
    float spokes = 0.5 + 0.5 * sin(a * 10.0 + well * 0.6);
    float tunnel = pow(rings, 3.0) * mix(0.4, 1.0, spokes) * uIntensity;
    tunnel *= smoothstep(1.2, 0.05, r);

    vec3 col = mix(uTide, uVoid, smoothstep(0.0, 0.85, r));
    col += mix(uVerdant, uIris, fract(well * 0.12)) * tunnel;
    col += uFrost * exp(-r * 14.0) * uHorizonGlow * 0.55;

    // Star streaks flying out of the well.
    float streak = hash21(vec2(floor(a * 28.0), floor(well)));
    float fly = step(1.0 - uStars * 0.18, streak) * exp(-abs(fract(well) - 0.5) * 18.0);
    col += uFrost * fly * (0.4 + 0.6 * uTwinkle) * 0.7;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const WARPSCII = ASCII_GBUFFER + /* glsl */ `
  // A ring of instanced tubes you fly through — same density ASCII as the tube demo.
  float sdCylZ(vec3 p, float r, float h) {
    vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  float mapTunnel(vec3 p, float t) {
    float n = 14.0;
    float ang = atan(p.y, p.x);
    float slice = 6.2831853 / n;
    float ia = floor(ang / slice + 0.5);
    float a = ia * slice;
    vec2 dir = vec2(cos(a), sin(a));
    float rad = 0.88 + 0.10 * sin(p.z * 2.0 - t * 3.2 + ia);
    vec3 q = p - vec3(dir * rad, 0.0);
    q.z = mod(q.z + 20.0, 0.48) - 0.24;
    return length(q) - (0.075 + 0.02 * sin(ia + t));
  }

  vec3 tunNormal(vec3 p, float t) {
    vec2 e = vec2(0.012, 0.0);
    float h = mapTunnel(p, t);
    return normalize(vec3(
      mapTunnel(p + e.xyy, t) - h,
      mapTunnel(p + e.yxy, t) - h,
      mapTunnel(p + e.yyx, t) - h
    ));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.35 + uSpeed * 2.4);
    vec2 p2 = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

    vec3 ro = vec3(0.0, 0.0, t * 2.2);
    vec3 rd = normalize(vec3(p2, 1.2));
    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 64; i++) {
      float d = mapTunnel(ro + rd * dAcc, t);
      if (d < 0.007) { hit = dAcc; break; }
      dAcc += clamp(d, 0.008, 0.25);
      if (dAcc > 12.0) break;
    }

    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec3 pos = ro + rd * hit;
    vec3 nrm = tunNormal(pos, t);
    vec3 sun = normalize(vec3(0.2, 0.55, 0.7));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.8);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 26.0);
    float fog = exp(-hit * 0.08);
    gl_FragColor = asciiLit(diff, spec, fog, 0.0);
  }
`;

const ION = COMMON + /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * uSpeed * 0.7;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    // Dipole field: two poles on a slow orbit.
    vec2 a = vec2(sin(t * 0.31), cos(t * 0.27)) * 0.42;
    vec2 b = -a * 0.85;
    vec2 da = p - a;
    vec2 db = p - b;
    float fa = atan(da.y, da.x);
    float fb = atan(db.y, db.x);
    float field = fa - fb;

    float lines = abs(sin(field * (5.0 + uHeight * 6.0)));
    float ribbon = pow(1.0 - lines, 10.0);
    ribbon += pow(1.0 - abs(sin(field * 2.0 + t)), 18.0) * 0.5;
    ribbon *= uIntensity;

    float poleA = exp(-length(da) * 18.0);
    float poleB = exp(-length(db) * 18.0);

    vec3 col = mix(uVoid, uTide, 0.45 + 0.2 * sin(field));
    col += uVerdant * ribbon * 0.85;
    col += uIris * ribbon * (0.35 + 0.65 * smoothstep(-1.0, 1.0, p.x));
    col += uFrost * (poleA + poleB) * uHorizonGlow;

    // Fast charged streaks along the field.
    float streak = hash21(vec2(floor(field * 12.0), floor(t * 2.0)));
    col += uFrost * step(0.93, streak) * ribbon * uTwinkle;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const WAVE = COMMON + /* glsl */ `
  // Hokusai stripes (onirenaud): cosine crests, foam on peaks, 4 inverted
  // mini-waves in the troughs so foam cannot leak between bands.

  float waveField(vec2 p, float t) {
    vec2 c = vec2(-0.28, 0.18);
    vec2 d = p - c;
    float ang = atan(d.y, d.x);
    float rad = length(d);
    float warp = 0.07 * sin(ang * 5.0 + t * 0.35) + 0.03 * sin(rad * 11.0 - t);
    return rad * 1.15 + ang * 0.22 + warp - t * 0.08;
  }

  float stripeProfile(float field) {
    float major = cos(field * 6.2831853);
    float mini = cos(field * 6.2831853 * 5.0);
    return major - 0.30 * mini;
  }

  float foamClaw(vec2 p, vec2 origin, float ang, float len) {
    vec2 d = p - origin;
    float a = atan(d.y, d.x) - ang;
    float r = length(d);
    float shaft = smoothstep(0.05, 0.0, abs(a) * r) * smoothstep(len, 0.0, r);
    float head = exp(-pow(r - len * 0.84, 2.0) * 380.0) * smoothstep(0.2, 0.0, abs(a));
    return max(shaft * 0.8, head);
  }

  float boat(vec2 p, vec2 c, float s, float tilt) {
    vec2 q = p - c;
    q.xy = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * q;
    q /= s;
    float hull = smoothstep(0.08, 0.0, abs(q.y + 0.35 * q.x * q.x)) * smoothstep(0.55, 0.0, abs(q.x));
    hull *= smoothstep(0.12, -0.02, q.y) * smoothstep(-0.18, -0.02, -q.y);
    float cabin = smoothstep(0.07, 0.0, abs(q.x + 0.05)) * smoothstep(0.12, 0.0, abs(q.y - 0.07));
    return max(hull, cabin * 0.85);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.10 + uSpeed * 0.7);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

    vec3 prussian = mix(vec3(0.07, 0.18, 0.42), uTide, 0.18);
    vec3 deep = mix(vec3(0.03, 0.07, 0.18), uVoid, 0.22);
    vec3 mid = mix(vec3(0.16, 0.36, 0.62), prussian, 0.4);
    vec3 foam = mix(vec3(0.93, 0.91, 0.84), uFrost, 0.16);
    vec3 skyA = mix(vec3(0.80, 0.74, 0.58), vec3(0.55, 0.5, 0.4), 0.15);
    vec3 skyB = mix(vec3(0.58, 0.68, 0.74), uTide, 0.12);
    vec3 wood = vec3(0.22, 0.13, 0.07);
    vec3 fujiSnow = vec3(0.93, 0.93, 0.90);

    vec3 col = mix(skyB, skyA, smoothstep(0.30, 0.95, uv.y));

    vec2 fuji = vec2(0.44 * aspect, 0.41);
    vec2 fp = p - fuji;
    float cone = abs(fp.x) * 2.35 - (0.18 - fp.y);
    float fujiBody = smoothstep(0.02, -0.01, cone) * smoothstep(-0.02, 0.12, fp.y) * smoothstep(0.22, 0.08, fp.y);
    float cap = smoothstep(0.015, -0.005, abs(fp.x) * 3.4 - (0.205 - fp.y)) * smoothstep(0.155, 0.195, fp.y);
    col = mix(col, mix(prussian, skyB, 0.5), fujiBody * 0.85);
    col = mix(col, fujiSnow, cap);

    float field = waveField(p, t);
    float profile = stripeProfile(field);
    float crestY = 0.34 + 0.28 * exp(-pow((p.x + 0.06) / 0.64, 2.0)) + 0.05 * sin(p.x * 2.0 + t);
    float below = crestY - p.y;
    float water = smoothstep(0.0, 0.01, below);

    float band = abs(fract(field * 7.2) - 0.5);
    float line = smoothstep(0.10, 0.035, band);
    float fill = smoothstep(-0.2, 0.55, profile);
    vec3 waterCol = mix(deep, mid, fill);
    waterCol = mix(waterCol, prussian, line * 0.85);
    waterCol = mix(waterCol, foam * 0.35 + mid, smoothstep(0.62, 0.9, profile) * 0.15);
    col = mix(col, waterCol, water);

    float crestFoam = smoothstep(0.68, 0.92, profile);
    float away = smoothstep(0.22, 0.0, below);
    crestFoam *= away * water * uIntensity;
    col = mix(col, foam, crestFoam * 0.75);

    float lip = exp(-abs(below) * 48.0) * water;
    col = mix(col, foam, lip * 0.55);

    vec2 curl = vec2(-0.02, crestY + 0.015);
    float claws = 0.0;
    for (int i = 0; i < 10; i++) {
      float fi = float(i);
      float ang = 0.22 + fi * 0.17 + 0.06 * sin(t * 0.8 + fi);
      float len = 0.09 + 0.04 * sin(fi * 1.6 + t);
      claws = max(claws, foamClaw(p, curl + vec2(fi * 0.032, 0.008 * sin(fi + t)), ang, len));
    }
    col = mix(col, foam, clamp(claws * uIntensity, 0.0, 1.0));

    float bob = 0.01 * sin(t * 1.2);
    float boats = boat(p, vec2(-0.16, 0.21 + bob), 0.21, 0.18);
    boats = max(boats, boat(p, vec2(0.11, 0.175 - bob * 0.6), 0.19, 0.27));
    boats = max(boats, boat(p, vec2(0.37, 0.155 + bob * 0.4), 0.16, 0.22));
    col = mix(col, wood, boats * 0.9);

    col += (hash21(gl_FragCoord.xy) - 0.5) * 0.025;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const BLOBSCII = ASCII_GBUFFER + /* glsl */ `
  // Three looping tubes (torus knots) — same density ASCII as the tube demo.
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  float mapLoops(vec3 p, float t) {
    vec3 a = p;
    a.yz *= rot2(t * 0.41);
    a.xz *= rot2(t * 0.23);
    float d = sdTorus(a, vec2(0.72, 0.085));

    vec3 b = p;
    b.xy *= rot2(t * 0.33 + 1.1);
    b.yz *= rot2(0.9);
    d = min(d, sdTorus(b, vec2(0.58, 0.07)));

    vec3 c = p;
    c.xz *= rot2(-t * 0.29);
    c.xy *= rot2(1.2 + 0.2 * sin(t));
    d = min(d, sdTorus(c, vec2(0.46, 0.06)));
    return d;
  }

  vec3 loopNormal(vec3 p, float t) {
    vec2 e = vec2(0.012, 0.0);
    float h = mapLoops(p, t);
    return normalize(vec3(
      mapLoops(p + e.xyy, t) - h,
      mapLoops(p + e.yxy, t) - h,
      mapLoops(p + e.yyx, t) - h
    ));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.24 + uSpeed * 1.7);
    vec2 p2 = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);

    vec3 ro = vec3(0.0, 0.15, 2.55);
    vec3 rd = normalize(vec3(p2, -1.35));
    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 64; i++) {
      float d = mapLoops(ro + rd * dAcc, t);
      if (d < 0.006) { hit = dAcc; break; }
      dAcc += clamp(d, 0.006, 0.22);
      if (dAcc > 7.0) break;
    }

    if (hit < 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec3 pos = ro + rd * hit;
    vec3 nrm = loopNormal(pos, t);
    vec3 sun = normalize(vec3(0.5, 0.7, 0.4));
    float diff = pow(clamp(dot(nrm, sun), 0.0, 1.0), 0.8);
    float spec = pow(clamp(dot(reflect(-sun, nrm), -rd), 0.0, 1.0), 30.0);
    float rim = pow(1.0 - clamp(dot(nrm, -rd), 0.0, 1.0), 2.4);
    gl_FragColor = asciiLit(diff, spec, 1.0, rim);
  }
`;

const EMBER = COMMON + /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.2 + uSpeed * 1.4);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float column = exp(-pow(p.x / (0.18 + 0.08 * uv.y), 2.0));
    float rise = fract(uv.y * 4.0 - t * 0.35);
    float heat = column * (0.25 + 0.75 * (1.0 - uv.y)) * uIntensity;
    vec3 col = mix(uVoid, uTide, uv.y * 0.3);
    col = mix(col, uIris, heat * 0.45);
    col = mix(col, uVerdant, heat * rise * 0.35);
    vec2 g = uv * uResolution / 7.0;
    vec2 id = floor(g);
    float n = hash21(id);
    vec2 f = fract(g) - 0.5;
    f.y += fract(t * (0.4 + n) + n) - 0.5;
    float spark = smoothstep(0.18, 0.0, length(f)) * step(0.62, n) * column;
    col += mix(uIris, uFrost, n) * spark * 1.4;
    col += uFrost * exp(-length(p - vec2(0.0, 0.0)) * 8.0) * 0.15 * uHorizonGlow;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const BLOOM = COMMON + /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.15 + uSpeed * 0.9);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float r = length(p);
    float a = atan(p.y, p.x);
    float petals = 6.0 + floor(uHeight * 4.0);
    float petal = 0.5 + 0.5 * cos(a * petals);
    float open = 0.22 + 0.18 * sin(t * 0.7);
    float bloom = smoothstep(open + 0.28, open, r / (0.35 + 0.25 * petal));
    float ring = exp(-pow(r - (open + 0.12), 2.0) * 80.0);
    vec3 col = mix(uVoid, uTide, smoothstep(0.0, 0.9, r));
    col = mix(col, uIris, bloom * 0.65 * uIntensity);
    col = mix(col, uVerdant, bloom * petal * 0.35);
    col += uFrost * ring * 0.55;
    col += uFrost * exp(-r * 14.0) * 0.2;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const PETRICHOR = COMMON + /* glsl */ `
  // First rain on dry earth: warm dust sky, wet ground, two rain layers, rare sheet-lightning.
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.12 + uSpeed * 1.6);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float hy = uHorizonY;

    vec3 dust = mix(uTide, uIris, 0.30);
    vec3 sky = mix(uVoid, dust, smoothstep(hy, 1.0, uv.y) * 0.58);
    sky = mix(sky, mix(uIris, uTide, 0.52), exp(-abs(uv.y - hy) * 7.2) * 0.48 * uHorizonGlow);
    sky += uIris * exp(-length(p - vec2(0.22, hy + 0.28)) * 5.5) * 0.12;

    float below = smoothstep(hy + 0.012, hy - 0.02, uv.y);
    float grit = fbm(p * 5.5 + vec2(0.0, 0.4));
    vec3 soil = mix(uVoid, mix(uTide, uIris, 0.18), 0.28 + 0.32 * grit);
    float puddle = smoothstep(0.44, 0.74, fbm(vec2(p.x * 2.8, p.y * 4.2)));
    float rip = 0.014 * sin(p.x * 36.0 - t * 5.5) * puddle;
    vec3 refl = mix(uVoid, dust, smoothstep(hy, 0.95, (hy * 2.0 - uv.y) + rip) * 0.55);
    soil = mix(soil, refl, puddle * uReflection * below);

    vec3 col = mix(sky, soil, below);

    float rain = 0.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      vec2 g = vec2(p.x * (16.0 + fi * 24.0), uv.y * (3.6 + fi * 3.2) - t * (1.7 + fi * 1.5));
      vec2 id = floor(g);
      float n = hash21(id + fi * 19.0);
      vec2 f = fract(g);
      float w = 0.016 + 0.022 * n;
      rain += smoothstep(w, 0.0, abs(f.x - 0.5)) * step(0.52, n) * (0.3 + 0.7 * n)
            * (0.4 + 0.6 * (1.0 - fi * 0.35));
    }
    col += mix(uFrost, uTide, 0.35) * rain * 0.58 * uIntensity;

    float mist = fbm(vec2(p.x * 1.4, uv.y * 2.2 - t * 0.08));
    col = mix(col, mix(uTide, uFrost, 0.2), mist * 0.12 * (1.0 - below) * uHeight);

    float flash = pow(max(sin(t * 0.19 + 0.4) * 0.5 + 0.5, 0.0), 42.0) * uTwinkle;
    col += uFrost * flash * 0.38;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const KELP = COMMON + /* glsl */ `
  // Underwater forest: depth gradient, light shafts, caustics, swaying fronds.
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.14 + uSpeed * 1.3);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

    vec3 deep = mix(uVoid, uTide, 0.22 + 0.42 * uv.y);
    float shaft = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float x = (hash21(vec2(fi, 2.2)) - 0.5) * aspect * 1.45;
      x += 0.07 * sin(t * 0.37 + fi * 1.7);
      shaft += exp(-pow((p.x - x) / (0.07 + 0.14 * uv.y), 2.0)) * (0.12 + 0.28 * uv.y);
    }
    vec3 col = deep + mix(uTide, uFrost, 0.45) * shaft * 0.5 * uHorizonGlow;

    vec2 q = p * vec2(4.0, 2.8) + vec2(t * 0.32, -t * 0.21);
    float cau = sin(q.x + sin(q.y * 1.25 + t)) * sin(q.y * 0.92 - t * 0.68);
    col += mix(uVerdant, uFrost, 0.35) * pow(abs(cau), 2.6) * 0.2 * uv.y * uIntensity;

    float fronds = 0.0;
    float leaf = 0.0;
    for (int i = 0; i < 13; i++) {
      float fi = float(i);
      float seed = hash21(vec2(fi, 9.1));
      float near = step(0.78, seed);
      float base = (seed - 0.5) * aspect * 1.85;
      float sway = 0.12 * sin(uv.y * 3.1 + t * 1.05 + seed * 6.0)
                 + 0.05 * sin(uv.y * 7.0 - t * 0.72 + fi);
      float x = base + sway * (0.22 + uv.y * (0.8 + near));
      float thick = (0.014 + 0.028 * seed) * (1.2 - uv.y * 0.7) * (0.7 + 0.3 * uHeight);
      thick *= 1.0 + near * 2.1;
      float body = smoothstep(thick, 0.0, abs(p.x - x));
      fronds = max(fronds, body * (0.35 + 0.65 * uv.y));
      float nubs = 0.5 + 0.5 * sin((uv.y + seed) * 24.0 + t * 0.8);
      leaf = max(leaf, body * nubs * smoothstep(thick * 2.4, 0.0, abs(p.x - x) - thick * 0.9));
    }
    col = mix(col, mix(uTide, uVerdant, 0.58), fronds * 0.82);
    col = mix(col, uVerdant, leaf * 0.34);

    vec2 g = p * vec2(26.0, 17.0) + vec2(t * 0.35, t * 0.12);
    vec2 gf = fract(g) - 0.5;
    float spark = smoothstep(0.2, 0.0, length(gf))
                * step(0.965 - uStars * 0.02, hash21(floor(g)))
                * (0.35 + 0.65 * uTwinkle);
    col += uFrost * spark * 0.7;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const MURMUR = COMMON + /* glsl */ `
  // Starling murmuration: two orbiting density ribbons, hash specks for birds.
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.16 + uSpeed * 1.5);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.44);

    vec3 col = mix(uVoid, uTide, 0.22 + 0.38 * smoothstep(-0.45, 0.62, p.y));
    col = mix(col, mix(uIris, uTide, 0.5), exp(-abs(p.y + 0.06) * 3.8) * 0.38 * uHorizonGlow);
    col = mix(col, mix(uVoid, uTide, 0.35), smoothstep(0.1, 0.0, uv.y) * 0.65);

    vec2 c0 = vec2(sin(t * 0.31) * 0.40, 0.12 + cos(t * 0.23) * 0.16);
    vec2 c1 = vec2(cos(t * 0.27) * 0.34, -0.02 + sin(t * 0.19) * 0.14);

    float dens = 0.0;
    for (int i = 0; i < 2; i++) {
      vec2 c = (i == 0) ? c0 : c1;
      vec2 q = p - c;
      q += 0.20 * vec2(
        fbm(q * 1.5 + vec2(t * 0.4, float(i) * 2.1)) - 0.5,
        fbm(q * 1.5 + vec2(4.4, -t * 0.33)) - 0.5
      );
      float r = length(q * vec2(1.0, 1.35));
      float a = atan(q.y, q.x);
      float body = smoothstep(0.38 + 0.08 * uHeight, 0.06, r);
      float grain = 0.35 + 0.65 * fbm(vec2(a * 1.4 + t * 0.6, r * 3.4 - t * 0.5) + float(i));
      dens += body * grain;
    }
    dens *= uIntensity;

    vec2 g = p * 52.0 + vec2(t * 1.6, -t * 0.4);
    vec2 f = fract(g) - 0.5;
    float n = hash21(floor(g));
    float bird = smoothstep(0.22, 0.0, length(f)) * step(0.62, n) * dens;

    col = mix(col, mix(uTide, uIris, 0.38), clamp(dens * 0.55, 0.0, 1.0));
    col += mix(uVoid, uFrost, 0.9) * bird * 1.2;
    col += uFrost * dens * 0.08;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const CICADA = COMMON + /* glsl */ `
  // Dusk grassland: heat shimmer, layered blades, a chorus pulse in the colour.
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.10 + uSpeed * 1.1);
    float shim = 0.0055 * sin(uv.y * 46.0 + t * 3.8) * uv.y;
    vec2 p = vec2((uv.x - 0.5 + shim) * aspect, uv.y);
    float hy = uHorizonY * 0.82 + 0.14;

    vec3 warm = mix(uIris, uFrost, 0.45);
    vec3 sky = mix(mix(uTide, uIris, 0.4), warm, smoothstep(hy, 1.0, uv.y));
    sky = mix(sky, uVoid, pow(1.0 - uv.y, 2.2) * 0.22);
    sky += mix(uIris, uFrost, 0.55) * exp(-length(p - vec2(0.22, 0.28 + hy * 0.4)) * 6.2) * 0.5 * uHorizonGlow;

    vec3 col = sky;

    for (int layer = 0; layer < 3; layer++) {
      float fl = float(layer);
      float dens = 26.0 + fl * 16.0;
      float base = hy - 0.03 - fl * 0.09;
      float id = floor(p.x * dens);
      float n = hash21(vec2(id, fl + 1.7));
      float local = fract(p.x * dens) - 0.5;
      float bladeY = uv.y - base;
      float h = (0.15 + 0.30 * n) * (0.72 + 0.28 * uHeight);
      float lean = 0.22 * sin(t * 1.25 + id * 0.37 + fl) * clamp(bladeY / max(h, 0.001), 0.0, 1.0);
      float shaft = smoothstep(h, h - 0.025, bladeY) * smoothstep(-0.012, 0.02, bladeY);
      float w = mix(0.22, 0.03, clamp(bladeY / max(h, 0.001), 0.0, 1.0));
      float body = smoothstep(w, 0.0, abs(local - lean));
      vec3 bladeCol = mix(mix(uTide, uVoid, 0.35), mix(uVerdant, uIris, 0.28), n);
      col = mix(col, bladeCol, body * shaft * (0.5 + 0.16 * fl));
    }

    float pulse = pow(0.5 + 0.5 * sin(t * 6.5), 4.0);
    col += mix(uVerdant, uIris, 0.45) * pulse * 0.07 * uIntensity;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const RIME = COMMON + /* glsl */ `
  // Hoarfrost on dark twigs: sine trunks, fbm bloom, crystal specks, slow flakes.
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.08 + uSpeed * 0.9);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);

    vec3 col = mix(uVoid, uTide, 0.18 + 0.22 * uv.y);
    col += mix(uIris, uFrost, 0.55) * exp(-length(p - vec2(-0.15, 0.78)) * 2.6) * 0.14 * uHorizonGlow;

    float twigs = 0.0;
    float frost = 0.0;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float seed = hash21(vec2(fi, 4.4));
      float x0 = (seed - 0.5) * aspect * 1.7;
      float curve = 0.075 * sin(uv.y * 2.5 + seed * 5.2)
                  + 0.028 * sin(uv.y * 6.8 + seed * 2.4);
      float d = abs(p.x - x0 - curve);
      float taper = mix(0.032, 0.004, clamp(uv.y, 0.0, 1.0));
      float along = smoothstep(-0.02, 0.05, uv.y) * smoothstep(1.05, 0.20 + seed * 0.5, uv.y);
      float trunk = smoothstep(taper, 0.0, d) * along;
      twigs = max(twigs, trunk);
      float rim = smoothstep(taper * 3.4, taper * 0.85, d) * (1.0 - trunk) * along;
      frost = max(frost, rim * (0.45 + 0.4 * uHeight));

      float node = 0.18 + hash21(vec2(fi, 8.8)) * 0.58;
      float side = mix(-1.0, 1.0, step(0.5, seed)) * (0.045 + 0.03 * seed);
      vec2 spurP = vec2(p.x - x0 - curve, uv.y - node);
      float spur = smoothstep(0.012, 0.0, abs(spurP.y)) * smoothstep(abs(side), 0.0, abs(spurP.x - side * 0.5));
      spur *= step(0.0, spurP.x * sign(side) + 0.002);
      twigs = max(twigs, spur * 0.65);
      frost = max(frost, spur * 0.8);
    }

    float grow = 0.7 + 0.3 * sin(t * 0.28);
    frost *= grow * uIntensity;

    vec2 cg = p * 24.0;
    float crystal = step(0.86, hash21(floor(cg))) * frost
                  * exp(-length(fract(cg) - 0.5) * 8.0);

    col = mix(col, mix(uVoid, uTide, 0.25), twigs * 0.95);
    col = mix(col, mix(uTide, uFrost, 0.55), clamp(frost * 0.9, 0.0, 1.0));
    col += uFrost * frost * 0.22;
    col += uFrost * crystal * 1.2;

    vec2 fg = vec2(p.x * 18.0, uv.y * 12.0 - t * 0.32);
    vec2 ff = fract(fg) - 0.5;
    float flake = smoothstep(0.18, 0.0, length(ff))
                * step(0.945 - uStars * 0.02, hash21(floor(fg)))
                * (0.25 + 0.75 * uTwinkle);
    col += uFrost * flake * 0.55;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const FRAGMENTS = {
  terrascii: TERRASCII,
  hexascii: HEXASCII,
  starwell: STARWELL,
  warpscii: WARPSCII,
  ion: ION,
  wave: WAVE,
  blobscii: BLOBSCII,
  ember: EMBER,
  bloom: BLOOM,
  petrichor: PETRICHOR,
  kelp: KELP,
  murmur: MURMUR,
  cicada: CICADA,
  rime: RIME,
};

function createShaderBackdrop(fragment, config) {
  const { palette, aurora, horizon, stars, finish, render } = config;

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uVoid: { value: new THREE.Vector3(...hexToRgb(palette.void)) },
    uTide: { value: new THREE.Vector3(...hexToRgb(palette.tide)) },
    uVerdant: { value: new THREE.Vector3(...hexToRgb(palette.verdant)) },
    uIris: { value: new THREE.Vector3(...hexToRgb(palette.iris)) },
    uFrost: { value: new THREE.Vector3(...hexToRgb(palette.frost)) },
    uIntensity: { value: aurora.intensity },
    uSpeed: { value: aurora.speed },
    uHeight: { value: aurora.height },
    uHorizonY: { value: horizon.y },
    uHorizonGlow: { value: horizon.glow },
    uReflection: { value: horizon.reflection },
    uStars: { value: stars.density },
    uTwinkle: { value: stars.twinkle },
    uGrain: { value: finish.grain },
    uVignette: { value: finish.vignette },
    uOctaves: { value: Math.min(Math.max(render.octaves | 0, 1), 8) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: fragment,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.Camera();

  return {
    scene,
    camera,
    setSize(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    setOctaves(count) {
      uniforms.uOctaves.value = Math.min(Math.max(count | 0, 1), 8);
    },
    apply(cfg) {
      const p = cfg.palette;
      if (p) {
        if (p.void) uniforms.uVoid.value.set(...hexToRgb(p.void));
        if (p.tide) uniforms.uTide.value.set(...hexToRgb(p.tide));
        if (p.verdant) uniforms.uVerdant.value.set(...hexToRgb(p.verdant));
        if (p.iris) uniforms.uIris.value.set(...hexToRgb(p.iris));
        if (p.frost) uniforms.uFrost.value.set(...hexToRgb(p.frost));
      }
      const a = cfg.aurora;
      if (a) {
        if (a.intensity != null) uniforms.uIntensity.value = a.intensity;
        if (a.speed != null) uniforms.uSpeed.value = a.speed;
        if (a.height != null) uniforms.uHeight.value = a.height;
      }
      const h = cfg.horizon;
      if (h) {
        if (h.y != null) uniforms.uHorizonY.value = h.y;
        if (h.glow != null) uniforms.uHorizonGlow.value = h.glow;
        if (h.reflection != null) uniforms.uReflection.value = h.reflection;
      }
      const s = cfg.stars;
      if (s) {
        if (s.density != null) uniforms.uStars.value = s.density;
        if (s.twinkle != null) uniforms.uTwinkle.value = s.twinkle;
      }
      const f = cfg.finish;
      if (f) {
        if (f.grain != null) uniforms.uGrain.value = f.grain;
        if (f.vignette != null) uniforms.uVignette.value = f.vignette;
      }
    },
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    dispose() {
      material.dispose();
    },
  };
}

export function createScene(name, config) {
  const id = SCENE_IDS.includes(name) ? name : 'aurora';
  if (id === 'aurora') return createSky(config);
  if (id === 'pulse') return null;
  if (ASCII_SCENE_IDS.has(id)) return createAsciiBackdrop(FRAGMENTS[id], config, id);
  return createShaderBackdrop(FRAGMENTS[id], config);
}

export function nextSceneId(current, delta = 1) {
  const index = Math.max(0, SCENE_IDS.indexOf(current));
  return SCENE_IDS[(index + delta + SCENE_IDS.length) % SCENE_IDS.length];
}
