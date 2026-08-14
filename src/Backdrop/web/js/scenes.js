// Five extra wallpaper scenes plus the original aurora.
// Each is one full-screen quad, same five-color palette, one draw.

import * as THREE from 'three';
import { hexToRgb } from './config.js';
import { createSky } from './sky.js';
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

  // A 10-level ASCII luminance ramp baked as 5x7 bitmaps: " .:-=+*#%@".
  // Level 0 is blank (dark/background), level 9 is a solid block (bright/foreground).
  float asciiRow(int level, int y) {
    if (level == 0) {
      return 0.0;
    } else if (level == 1) {
      if (y==5 || y==6) return 12.0; return 0.0;
    } else if (level == 2) {
      if (y==1 || y==2 || y==4 || y==5) return 12.0; return 0.0;
    } else if (level == 3) {
      if (y==3) return 31.0; return 0.0;
    } else if (level == 4) {
      if (y==2 || y==4) return 31.0; return 0.0;
    } else if (level == 5) {
      if (y==3) return 31.0; if (y==1 || y==2 || y==4 || y==5) return 4.0; return 0.0;
    } else if (level == 6) {
      if (y==0 || y==6) return 17.0; if (y==1 || y==5) return 10.0; if (y==3) return 31.0; return 4.0;
    } else if (level == 7) {
      if (y==0 || y==1 || y==5 || y==6) return 10.0; if (y==2 || y==4) return 31.0; return 10.0;
    } else if (level == 8) {
      if (y==0) return 25.0; if (y==1) return 26.0; if (y==2) return 4.0; if (y==3) return 8.0; if (y==4) return 19.0; return 0.0;
    }
    return 31.0;
  }

  float asciiBit(int level, int x, int y) {
    float row = asciiRow(level, y);
    float place = pow(2.0, float(4 - x));
    return floor(mod(floor(row / place), 2.0));
  }

  float asciiGlyph(int level, vec2 uv) {
    vec2 g = uv * vec2(5.0, 7.0);
    int x = int(floor(g.x));
    int y = int(floor(6.999 - g.y));
    if (x < 0 || x > 4 || y < 0 || y > 6) return 0.0;
    return asciiBit(level, x, y);
  }
`;

const TERRASCII = COMMON + /* glsl */ `
  // Raymarched dune field, flown over at low altitude, shaded as ASCII glyphs.
  float terrainH(vec2 p, float t) {
    float h = fbm(p * 0.6 + vec2(0.0, t * 0.5));
    h += fbm(p * 1.7 - vec2(t * 0.3, 0.0)) * 0.35;
    return h;
  }

  float mapTerrain(vec3 p, float t) {
    return p.y - (terrainH(p.xz, t) * 0.9 - 0.55);
  }

  vec3 terrainNormal(vec3 p, float t) {
    vec2 e = vec2(0.035, 0.0);
    float h = mapTerrain(p, t);
    return normalize(vec3(
      mapTerrain(p + e.xyy, t) - h,
      e.x,
      mapTerrain(p + e.yyx, t) - h
    ));
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.25 + uSpeed * 2.0);

    float cols = floor(clamp(uResolution.x / 13.0, 44.0, 100.0));
    float rows = floor(cols * (uResolution.y / max(uResolution.x, 1.0)) * 0.72);
    vec2 grid = vec2(cols, max(rows, 18.0));
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid);
    vec2 mid = (cell + 0.5) / grid;
    vec2 p = vec2((mid.x - 0.5) * aspect, mid.y - 0.42);

    vec3 ro = vec3(0.0, 0.55, t * 1.1);
    vec3 rd = normalize(vec3(p.x, p.y - 0.08, -1.0));
    float dAcc = 0.1;
    float hit = -1.0;
    for (int i = 0; i < 40; i++) {
      vec3 pos = ro + rd * dAcc;
      float d = mapTerrain(pos, t);
      if (d < 0.01) { hit = dAcc; break; }
      dAcc += clamp(d, 0.02, 0.35);
      if (dAcc > 24.0) break;
    }

    vec3 sunDir = normalize(vec3(0.4, 0.55, 0.3));
    vec3 sky = mix(uVoid, uTide, smoothstep(-0.1, 0.9, uv.y));
    vec3 col = sky;
    float level0 = 0.0;

    if (hit > 0.0) {
      vec3 pos = ro + rd * hit;
      vec3 nrm = terrainNormal(pos, t);
      float diff = clamp(dot(nrm, sunDir), 0.0, 1.0);
      float fog = exp(-hit * 0.045);
      float lum = clamp(diff * 0.85 + 0.15, 0.0, 1.0) * fog * uIntensity;
      level0 = floor(clamp(lum, 0.0, 0.999) * 10.0);
      vec3 inkCol = mix(uVerdant, uIris, clamp(pos.y * 0.6 + 0.5, 0.0, 1.0));
      inkCol = mix(inkCol, uFrost, smoothstep(0.7, 0.95, diff));
      float ink = asciiGlyph(int(level0), local);
      col = mix(mix(sky, uVoid, 1.0 - fog), inkCol, ink * clamp(lum + 0.25, 0.0, 1.0));
    } else {
      vec2 g = uv * uResolution / 5.0;
      float seed = hash21(floor(g));
      float star = step(1.0 - uStars * 0.012, seed) * smoothstep(0.32, 0.0, length(fract(g) - 0.5));
      col += uFrost * star * smoothstep(0.25, 0.75, uv.y) * 0.8;
    }

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

const HEXASCII = COMMON + /* glsl */ `
  float sdOcta(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735;
  }

  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  float mapModel(vec3 p, float t) {
    p.yz *= rot2(t * 0.41);
    p.xy *= rot2(t * 0.27 + 0.4);
    p.xz *= rot2(t * 0.19);
    float warp = 0.12 * sin(p.x * 3.1 + t) * sin(p.y * 2.7 - t * 0.7);
    p += warp;
    float crystal = sdOcta(p, 0.62 + 0.06 * sin(t * 0.8));
    float ring = sdTorus(p.xzy, vec2(0.78, 0.09));
    return min(crystal, ring);
  }

  float digitRow(int d, int y) {
    // 5-bit rows for 0-F. No bitwise ops — WebGL1 GLSL.
    if (d == 0) {
      if (y==0) return 14.0; if (y==1) return 17.0; if (y==2) return 19.0; if (y==3) return 21.0; if (y==4) return 25.0; if (y==5) return 17.0; return 14.0;
    }
    if (d == 1) {
      if (y==0) return 4.0; if (y==1) return 12.0; return (y==6) ? 14.0 : 4.0;
    }
    if (d == 2) {
      if (y==0) return 14.0; if (y==1) return 17.0; if (y==2) return 1.0; if (y==3) return 2.0; if (y==4) return 4.0; if (y==5) return 8.0; return 31.0;
    }
    if (d == 3) {
      if (y==0) return 14.0; if (y==1) return 17.0; if (y==2) return 1.0; if (y==3) return 6.0; if (y==4) return 1.0; if (y==5) return 17.0; return 14.0;
    }
    if (d == 4) {
      if (y==0) return 2.0; if (y==1) return 6.0; if (y==2) return 10.0; if (y==3) return 18.0; if (y==4) return 31.0; return 2.0;
    }
    if (d == 5) {
      if (y==0) return 31.0; if (y==1) return 16.0; if (y==2) return 30.0; if (y==3) return 1.0; if (y==4) return 1.0; if (y==5) return 17.0; return 14.0;
    }
    if (d == 6) {
      if (y==0) return 14.0; if (y==1) return 16.0; if (y==2) return 16.0; if (y==3) return 30.0; if (y==6) return 14.0; return 17.0;
    }
    if (d == 7) {
      if (y==0) return 31.0; if (y==1) return 1.0; if (y==2) return 2.0; if (y==3) return 4.0; return 8.0;
    }
    if (d == 8) {
      if (y==0 || y==6) return 14.0; if (y==3) return 14.0; return 17.0;
    }
    if (d == 9) {
      if (y==0 || y==6) return 14.0; if (y==3) return 15.0; if (y==4 || y==5) return 1.0; return 17.0;
    }
    if (d == 10) {
      if (y==0) return 4.0; if (y==1) return 10.0; if (y==4) return 31.0; return 17.0;
    }
    if (d == 11) {
      if (y==0 || y==3 || y==6) return 30.0; return 17.0;
    }
    if (d == 12) {
      if (y==0 || y==6) return 14.0; if (y==1 || y==5) return 17.0; return 16.0;
    }
    if (d == 13) {
      if (y==0 || y==6) return 30.0; return 17.0;
    }
    if (d == 14) {
      if (y==0 || y==6) return 31.0; if (y==3) return 30.0; return 16.0;
    }
    if (y==0) return 31.0; if (y==3) return 30.0; if (y==1 || y==2 || y==4 || y==5) return 16.0; return 16.0;
  }

  float digitBit(int d, int x, int y) {
    float row = digitRow(d, y);
    float place = pow(2.0, float(4 - x));
    return floor(mod(floor(row / place), 2.0));
  }

  float hexGlyph(int d, vec2 uv) {
    vec2 g = uv * vec2(5.0, 7.0);
    int x = int(floor(g.x));
    int y = int(floor(6.999 - g.y));
    if (x < 0 || x > 4 || y < 0 || y > 6) return 0.0;
    return digitBit(d, x, y);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.35 + uSpeed * 2.2);

    float cols = floor(clamp(uResolution.x / 14.0, 48.0, 96.0));
    float rows = floor(cols * (uResolution.y / max(uResolution.x, 1.0)) * 0.72);
    vec2 grid = vec2(cols, max(rows, 18.0));
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid);
    vec2 mid = (cell + 0.5) / grid;
    vec2 p = vec2((mid.x - 0.5) * aspect, mid.y - 0.5);

    vec3 ro = vec3(0.0, 0.0, 2.35);
    vec3 rd = normalize(vec3(p, -1.35));
    float hit = -1.0;
    float dAcc = 0.0;
    for (int i = 0; i < 20; i++) {
      float d = mapModel(ro + rd * dAcc, t);
      if (d < 0.012) { hit = dAcc; break; }
      dAcc += d;
      if (dAcc > 6.0) break;
    }

    vec3 bg = mix(uVoid, uTide, uv.y);
    bg += 0.04 * uIris * sin(uv.y * 18.0 + t * 2.0);
    vec3 col = bg;

    if (hit > 0.0) {
      vec3 pos = ro + rd * hit;
      float n = hash21(cell + floor(t * 3.0));
      int digit = int(mod(floor(hit * 11.0 + n * 16.0 + t * 4.0), 16.0));
      float ink = hexGlyph(digit, local);
      vec3 inkCol = mix(uVerdant, uIris, fract(hit * 0.7 + t * 0.15));
      inkCol = mix(inkCol, uFrost, smoothstep(1.6, 0.9, hit));
      // RGB split on the glyph for the trip.
      float inkR = hexGlyph(digit, local + vec2(0.06, 0.0));
      float inkB = hexGlyph(digit, local - vec2(0.05, 0.0));
      col = mix(bg, vec3(inkR, ink, inkB) * inkCol * (1.1 * uIntensity), max(ink, max(inkR, inkB) * 0.65));
    } else {
      int rain = int(mod(cell.x * 3.0 + cell.y * 7.0 + floor(t * 6.0), 16.0));
      float faint = hexGlyph(rain, local) * 0.08 * uStars;
      col += uFrost * faint;
    }

    gl_FragColor = vec4(finish(col, uv), 1.0);
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

const WARPSCII = COMMON + /* glsl */ `
  // Raymarched wormhole tunnel of pulsing rings, shaded as ASCII glyphs.
  float mapTunnel(vec3 p, float t) {
    float ang = atan(p.y, p.x);
    float radius = length(p.xy);
    float ripple = 0.12 * sin(ang * 6.0 + p.z * 2.0 - t * 2.4);
    float tube = radius - (1.0 + ripple);
    float rings = sin(p.z * 3.0 - t * 5.0) * 0.06;
    return abs(tube + rings) - 0.03;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.4 + uSpeed * 2.6);

    float cols = floor(clamp(uResolution.x / 13.0, 44.0, 100.0));
    float rows = floor(cols * (uResolution.y / max(uResolution.x, 1.0)) * 0.72);
    vec2 grid = vec2(cols, max(rows, 18.0));
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid);
    vec2 mid = (cell + 0.5) / grid;
    vec2 p2 = vec2((mid.x - 0.5) * aspect, mid.y - 0.5);

    vec3 ro = vec3(0.0, 0.0, t * 2.2);
    vec3 rd = normalize(vec3(p2, -1.15));
    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 48; i++) {
      vec3 pos = ro + rd * dAcc;
      float d = mapTunnel(pos, t);
      if (d < 0.008) { hit = dAcc; break; }
      dAcc += clamp(d, 0.01, 0.4);
      if (dAcc > 14.0) break;
    }

    vec3 col = uVoid * 0.6;
    if (hit > 0.0) {
      vec3 pos = ro + rd * hit;
      float ang = atan(pos.y, pos.x);
      float bands = 0.5 + 0.5 * sin(pos.z * 3.0 - t * 5.0);
      float spokes = 0.5 + 0.5 * sin(ang * 10.0 - t * 1.5);
      float fog = exp(-hit * 0.09);
      float lum = clamp(bands * 0.6 + spokes * 0.4, 0.0, 1.0) * fog * uIntensity;
      float level = floor(clamp(lum, 0.0, 0.999) * 10.0);
      vec3 inkCol = mix(uVerdant, uIris, bands);
      inkCol = mix(inkCol, uFrost, smoothstep(0.75, 1.0, spokes));
      float ink = asciiGlyph(int(level), local);
      col = mix(uVoid * (1.0 - fog * 0.5), inkCol, ink * clamp(lum + 0.2, 0.0, 1.0));
    }

    // Streaking particles flying past the camera.
    float streak = hash21(vec2(floor(atan(p2.y, p2.x) * 20.0), floor(t * 3.0 + length(p2) * 4.0)));
    float fly = step(1.0 - uStars * 0.15, streak) * smoothstep(0.9, 0.0, length(p2));
    col += uFrost * fly * uTwinkle * 0.6;

    gl_FragColor = vec4(finish(col, uv), 1.0);
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

const BLOBSCII = COMMON + /* glsl */ `
  // Raymarched metaball cluster, merging and separating, shaded as ASCII glyphs.
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  float mapBlobs(vec3 p, float t) {
    vec3 c1 = vec3(sin(t * 0.7) * 0.5, cos(t * 0.5) * 0.3, 0.0);
    vec3 c2 = vec3(cos(t * 0.6) * 0.45, sin(t * 0.8) * 0.4, sin(t * 0.4) * 0.2);
    vec3 c3 = vec3(sin(t * 0.4 + 2.1) * 0.4, cos(t * 0.9) * 0.35, cos(t * 0.5) * 0.25);
    float d1 = length(p - c1) - 0.42;
    float d2 = length(p - c2) - 0.36;
    float d3 = length(p - c3) - 0.3;
    return smin(smin(d1, d2, 0.35), d3, 0.35);
  }

  vec3 blobNormal(vec3 p, float t) {
    vec2 e = vec2(0.025, 0.0);
    float h = mapBlobs(p, t);
    return normalize(vec3(
      mapBlobs(p + e.xyy, t) - h,
      mapBlobs(p + e.yxy, t) - h,
      mapBlobs(p + e.yyx, t) - h
    ));
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.2 + uSpeed * 1.6);

    float cols = floor(clamp(uResolution.x / 13.0, 44.0, 100.0));
    float rows = floor(cols * (uResolution.y / max(uResolution.x, 1.0)) * 0.72);
    vec2 grid = vec2(cols, max(rows, 18.0));
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid);
    vec2 mid = (cell + 0.5) / grid;
    vec2 p2 = vec2((mid.x - 0.5) * aspect, mid.y - 0.5);

    vec3 ro = vec3(0.0, 0.0, 2.4);
    vec3 rd = normalize(vec3(p2, -1.3));
    float dAcc = 0.0;
    float hit = -1.0;
    for (int i = 0; i < 32; i++) {
      vec3 pos = ro + rd * dAcc;
      float d = mapBlobs(pos, t);
      if (d < 0.008) { hit = dAcc; break; }
      dAcc += d;
      if (dAcc > 6.0) break;
    }

    vec3 sunDir = normalize(vec3(0.5, 0.6, 0.4));
    vec3 col = mix(uVoid, uTide, uv.y);

    if (hit > 0.0) {
      vec3 pos = ro + rd * hit;
      vec3 nrm = blobNormal(pos, t);
      float diff = clamp(dot(nrm, sunDir), 0.0, 1.0);
      float rim = pow(1.0 - clamp(dot(nrm, -rd), 0.0, 1.0), 3.0);
      float lum = clamp(diff * 0.75 + 0.25 + rim * 0.3, 0.0, 1.0) * uIntensity;
      float level = floor(clamp(lum, 0.0, 0.999) * 10.0);
      vec3 inkCol = mix(uVerdant, uIris, clamp(pos.x * 0.7 + 0.5, 0.0, 1.0));
      inkCol = mix(inkCol, uFrost, rim * 0.6);
      float ink = asciiGlyph(int(level), local);
      col = mix(col, inkCol, ink * clamp(lum + 0.2, 0.0, 1.0));
    }

    gl_FragColor = vec4(finish(col, uv), 1.0);
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
  return createShaderBackdrop(FRAGMENTS[id], config);
}

export function nextSceneId(current, delta = 1) {
  const index = Math.max(0, SCENE_IDS.indexOf(current));
  return SCENE_IDS[(index + delta + SCENE_IDS.length) % SCENE_IDS.length];
}
