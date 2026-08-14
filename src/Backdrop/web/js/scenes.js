// Wallpaper scenes plus the original aurora.
// Each is one full-screen quad, same five-color palette, one draw.

import * as THREE from 'three';
import { hexToRgb } from './config.js';
import { createSky } from './sky.js';
import { ASCII_GBUFFER, ASCII_SCENE_IDS, createAsciiBackdrop } from './ascii.js?v=3';
export { SCENE_IDS, SCENE_META } from './scenes-meta.js';
import { SCENE_IDS } from './scenes-meta.js';
import { VERTEX, COMMON } from './shader-lib.js';

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

const FRAGMENTS = {
  terrascii: TERRASCII,
  starwell: STARWELL,
  warpscii: WARPSCII,
  ion: ION,
  blobscii: BLOBSCII,
  ember: EMBER,
  kelp: KELP,
  murmur: MURMUR,
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

export function createScene(name, config, themeMod = null) {
  if (themeMod?.fragment) return createShaderBackdrop(COMMON + themeMod.fragment, config);
  const id = SCENE_IDS.includes(name) ? name : 'aurora';
  if (id === 'aurora') return createSky(config);
  if (ASCII_SCENE_IDS.has(id) && FRAGMENTS[id]) return createAsciiBackdrop(FRAGMENTS[id], config, id);
  if (FRAGMENTS[id]) return createShaderBackdrop(FRAGMENTS[id], config);
  return createSky(config);
}

export function nextSceneId(current, delta = 1) {
  const index = Math.max(0, SCENE_IDS.indexOf(current));
  return SCENE_IDS[(index + delta + SCENE_IDS.length) % SCENE_IDS.length];
}
