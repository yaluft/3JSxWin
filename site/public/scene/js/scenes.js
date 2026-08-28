// Wallpaper scenes plus the original aurora.
// Each is one full-screen quad, same five-color palette, one draw.

import * as THREE from 'three';
import { hexToRgb } from './config.js';
import { createSky } from './sky.js';
import { ASCII_GBUFFER, ASCII_SCENE_IDS, createAsciiBackdrop } from './ascii.js?v=4';
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

const GLYPHFALL = ASCII_GBUFFER + /* glsl */ `
  // Falling-glyph cascade. The G-buffer is already one cell per fragment,
  // so each pixel is one rain drop / trail sample — no raymarch, no tubes.
  void main() {
    vec2 uv = vUv;
    float t = uTime * (0.32 + uSpeed * 2.0);
    float col = floor(gl_FragCoord.x);
    float row = floor(gl_FragCoord.y);

    float lum = 0.0;
    float head = 0.0;
    for (int layer = 0; layer < 2; layer++) {
      float lf = float(layer);
      float seed = hash21(vec2(col + lf * 17.0, 3.1 + lf));
      float spd = 0.55 + seed * 1.35 + lf * 0.28;
      float cells = 9.0 + seed * 12.0;
      float y = fract((row / max(cells, 1.0)) - t * spd + seed * 6.0);
      float trail = pow(1.0 - y, 1.65 + lf * 0.4);
      float h = exp(-y * (16.0 + lf * 8.0));
      float live = step(0.16 - lf * 0.04, seed);
      float tick = 0.5 + 0.5 * hash21(vec2(col, floor(row + t * spd * cells)));
      lum += trail * live * tick * (0.62 - lf * 0.18);
      head = max(head, h * live);
    }

    lum *= uIntensity;
    // Quiet the usual desktop-icon column so labels stay readable.
    lum *= mix(0.07, 1.0, smoothstep(0.0, 0.16, uv.x));
    lum *= mix(0.55, 1.0, uv.y);

    if (lum < 0.025) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float diff = clamp(lum, 0.0, 1.0);
    float spec = head * 0.9;
    gl_FragColor = asciiLit(diff, spec, 1.0, head * 0.35);
  }
`;

const FRAGMENTS = {
  terrascii: TERRASCII,
  warpscii: WARPSCII,
  ion: ION,
  blobscii: BLOBSCII,
  glyphfall: GLYPHFALL,
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
  // Optional theme failed to load: do not silently paint Aurora while the UI
  // still says the theme name. Sky only when the id is actually aurora.
  console.warn('createScene: no shader for', name);
  return createSky(config);
}

export function nextSceneId(current, delta = 1) {
  const index = Math.max(0, SCENE_IDS.indexOf(current));
  return SCENE_IDS[(index + delta + SCENE_IDS.length) % SCENE_IDS.length];
}
