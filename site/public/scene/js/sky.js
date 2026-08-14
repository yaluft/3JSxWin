// The aurora curtain: one full-screen quad, one draw call, no post-processing.
// Everything you see above and below the horizon comes out of this fragment shader.

import * as THREE from 'three';
import { hexToRgb } from './config.js';

const VERTEX = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
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

  // One curtain in sky space: p.x is horizontal, p.y is height above the horizon.
  float curtain(vec2 p, float t, float seed) {
    vec2 warp = vec2(
      fbm(p * 1.7 + vec2(t * 0.19, seed * 3.1)),
      fbm(p * 1.3 + vec2(seed * 7.7, t * 0.13))
    );
    vec2 q = p + (warp - 0.5) * 2.2;

    float streak = fbm(vec2(q.x * 1.6 + t * 0.31 + seed * 11.0, q.y * 0.55 - t * 0.07));
    float shape  = smoothstep(0.40, 0.88, streak);

    // Vertical rays are what separates an aurora from a flame.
    float rays = 0.5 + 0.5 * vnoise(vec2(q.x * 12.0 + seed * 5.0, t * 0.4));

    float rise = exp(-max(p.y, 0.0) / max(uHeight, 0.02));
    float foot = smoothstep(0.0, 0.05, p.y);

    return shape * rise * foot * rays;
  }

  vec3 auroraColor(float height, float energy) {
    vec3 c = mix(uVerdant, uIris, smoothstep(0.0, uHeight * 1.05, height));
    return mix(c, uFrost, smoothstep(0.55, 1.05, energy) * 0.4);
  }

  void main() {
    vec2  uv     = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t      = uTime * uSpeed;

    // Sky space keeps x square, so curtains do not smear on an ultrawide.
    vec2 sky = vec2((uv.x - 0.5) * aspect, uv.y - uHorizonY);

    vec3 col = mix(uTide, uVoid, smoothstep(-0.25, 0.95, sky.y));
    col = mix(col, uVoid * 0.75, smoothstep(0.0, -0.5, sky.y));

    // --- stars ------------------------------------------------------------
    vec2  grid = uv * uResolution / 4.0;
    vec2  cell = floor(grid);
    float seed = hash21(cell);
    float lit  = step(1.0 - uStars * 0.010, seed);
    vec2  jit   = vec2(hash21(cell + 3.7), hash21(cell + 9.1));
    float point = smoothstep(0.34, 0.0, length(fract(grid) - jit));
    float flick = 1.0 - uTwinkle * 0.5 * (1.0 + sin(uTime * (1.3 + seed * 3.0) + seed * 40.0));
    col += uFrost * lit * point * max(flick, 0.0) * smoothstep(-0.01, 0.45, sky.y) * 0.85;

    // --- aurora -----------------------------------------------------------
    float energy = curtain(sky, t, 0.0)
                 + curtain(sky * 1.45 + vec2(2.3, 0.0), t * 1.27, 1.0) * 0.62
                 + curtain(sky * 0.78 - vec2(1.7, 0.0), t * 0.71, 0.44) * 0.44
                 + curtain(sky * 0.55 + vec2(5.1, 0.0), t * 0.43, 2.7) * 0.35;
    energy *= uIntensity;
    col += auroraColor(sky.y, energy) * energy;

    // --- the signature: a lit horizon and its damped reflection ------------
    float below = max(-sky.y, 0.0);

    if (uReflection > 0.001) {
      float wobble = sin(uv.x * 26.0 + uTime * 0.55) * 0.012
                   + sin(uv.x * 61.0 - uTime * 0.31) * 0.005;
      vec2  mirror = vec2(sky.x + wobble, below * 1.5) * 0.85;
      float refl = curtain(mirror, t, 0.0) * 0.9
                 + curtain(mirror * 1.45 + vec2(2.3, 0.0), t * 1.27, 1.0) * 0.5;
      refl *= uIntensity * uReflection * exp(-below * 7.5);
      col += auroraColor(below * 0.4, refl) * refl;
    }

    float breath = 0.74 + 0.26 * sin(uTime * 0.27);
    float footGlow = smoothstep(0.32, 0.88, fbm(vec2(sky.x * 3.4 + t * 0.31, -t * 0.07)));
    float edgeFade = smoothstep(0.0, 0.16, uv.x) * smoothstep(1.0, 0.84, uv.x);

    float line = exp(-abs(sky.y) * 460.0) * (0.22 + 0.78 * footGlow) * edgeFade;
    col += mix(uFrost, uVerdant, 0.35) * line * uHorizonGlow * breath * 0.6;
    col += mix(uVerdant, uFrost, 0.4) * exp(-abs(sky.y) * 22.0) * uHorizonGlow * footGlow * 0.2;

    // --- finish -----------------------------------------------------------
    col *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.4), 0.0, 1.0);

    // Dither before the 8-bit write, or a gradient this dark and this wide bands badly.
    col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (uGrain + 1.0 / 255.0);

    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export function createSky(config) {
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
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // An identity camera: the vertex shader already writes clip space.
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
    // Live control from the on-scene panel. Mirrors the config shape; unknown keys
    // are ignored so the panel and the shader can evolve independently.
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
