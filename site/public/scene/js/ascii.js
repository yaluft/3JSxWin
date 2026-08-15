// Font-atlas ASCII post-process in the style of
// https://offscreencanvas.com/renders/webgl-ascii/
//
// Pass 1 writes lit colour + luminance. Pass 2 maps each cell onto a
// 32-glyph density ramp, tinted with the sampled colour.

import * as THREE from 'three';
import { hexToRgb } from './config.js';

export const ASCII_SETS = 1;
export const ASCII_LEVELS = 32;

const SETS = [
  [
    ' ', '.', '`', '\'', ':', '-', '~', '+',
    '=', '*', 'c', 'o', 'x', 'z', 'n', 'u',
    'v', 'a', 'h', 'k', 'b', 'd', '#', '%',
    '&', '8', '@', 'W', 'M', 'B', '$', '█',
  ],
];

const CELL_W = 64;
const CELL_H = 96;

let sharedAtlas = null;

export function getGlyphAtlas() {
  if (sharedAtlas) return sharedAtlas;

  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * ASCII_LEVELS;
  canvas.height = CELL_H * ASCII_SETS;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.floor(CELL_H * 0.72)}px "Cascadia Mono","Consolas","Courier New",monospace`;

  SETS.forEach((row, y) => {
    row.forEach((ch, x) => {
      const cx = (x + 0.5) * CELL_W;
      const cy = (y + 0.54) * CELL_H;
      if (ch === '█') {
        ctx.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H);
      } else {
        ctx.fillText(ch, cx, cy);
      }
    });
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  sharedAtlas = tex;
  return tex;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const ASCII_VERTEX = VERTEX;

// Shared helpers for G-buffer scene shaders.
export const ASCII_GBUFFER = /* glsl */ `
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
    float c = hash21(i + vec2(1.0, 1.0));
    float d = hash21(i + vec2(0.0, 1.0));
    return mix(mix(a, b, u.x), mix(d, c, u.x), u.y);
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

  mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
  }

  vec4 asciiCell(vec3 col, float lum) {
    return vec4(max(col, 0.0), clamp(lum, 0.02, 1.0));
  }

  vec4 asciiLit(float diff, float spec, float fog, float rim) {
    float lum = clamp(diff * 0.88 + spec * 0.55 + rim * 0.22 + 0.1, 0.0, 1.0) * fog;
    vec3 col = mix(uTide, uVerdant, clamp(diff, 0.0, 1.0));
    col = mix(col, uIris, clamp(spec * 0.55 + rim * 0.4, 0.0, 1.0));
    col = mix(col, uFrost, clamp(spec + rim * 0.25, 0.0, 1.0));
    return asciiCell(col * fog, lum);
  }
`;

const COMPOSITE = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uGBuffer;
  uniform sampler2D uAtlas;
  uniform vec2  uResolution;
  uniform vec2  uGrid;
  uniform float uTime;
  uniform vec3  uVoid;
  uniform vec3  uTide;
  uniform vec3  uVerdant;
  uniform vec3  uIris;
  uniform vec3  uFrost;
  uniform float uIntensity;
  uniform float uGrain;
  uniform float uVignette;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    vec2 grid = max(uGrid, vec2(1.0));
    vec2 cell = floor(uv * grid);
    vec2 local = fract(uv * grid);
    vec2 mid = (cell + 0.5) / grid;

    vec4 data = texture2D(uGBuffer, mid);
    vec3 paper = uVoid * 0.12;
    if (data.a < 0.015) {
      vec3 empty = paper;
      empty *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.8), 0.0, 1.0);
      gl_FragColor = vec4(max(empty, 0.0), 1.0);
      return;
    }

    float lum = clamp(data.a, 0.0, 0.999);
    float level = floor(lum * ${ASCII_LEVELS}.0);
    vec2 pad = local * 0.88 + 0.06;
    if (level > ${ASCII_LEVELS - 2}.5) pad = local;
    vec2 atlasUV = vec2(
      (level + pad.x) / ${ASCII_LEVELS}.0,
      1.0 - pad.y
    );
    float ink = texture2D(uAtlas, atlasUV).r;

    vec3 tint = max(data.rgb, vec3(0.04));
    float peak = max(tint.r, max(tint.g, tint.b));
    tint *= (0.55 + 0.7 * uIntensity) / max(peak, 0.08);
    vec3 inkCol = mix(uFrost * 0.35, tint, 0.92);
    vec3 col = mix(paper, inkCol, ink);

    col *= clamp(1.0 - uVignette * pow(clamp(length(uv - 0.5) * 1.42, 0.0, 1.0), 2.8), 0.0, 1.0);
    col += (hash21(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) * (uGrain * 0.45 + 1.0 / 255.0);
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export const ASCII_DEFAULTS = {
  terrascii: { cellPx: 6, minCols: 80, maxCols: 480 },
  warpscii: { cellPx: 6, minCols: 80, maxCols: 480 },
  blobscii: { cellPx: 6, minCols: 80, maxCols: 480 },
};

export const ASCII_SCENE_IDS = new Set(Object.keys(ASCII_DEFAULTS));

function gridFor(width, height, ascii) {
  const cssW = window.innerWidth || width;
  const cols = Math.floor(Math.min(Math.max(cssW / Math.max(ascii.cellPx, 4), ascii.minCols), ascii.maxCols));
  const rows = Math.max(18, Math.floor(cols * (height / Math.max(width, 1)) * 0.55));
  return [Math.max(8, cols), rows];
}

export function createAsciiBackdrop(gbufferFragment, config, sceneId) {
  const { palette, aurora, horizon, stars, finish, render } = config;
  const ascii = { ...ASCII_DEFAULTS[sceneId], ...config.ascii?.[sceneId] };
  const atlas = getGlyphAtlas();

  const gUniforms = {
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

  const gMaterial = new THREE.ShaderMaterial({
    uniforms: gUniforms,
    vertexShader: VERTEX,
    fragmentShader: gbufferFragment,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });

  const gScene = new THREE.Scene();
  gScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), gMaterial));
  const gCamera = new THREE.Camera();

  const target = new THREE.WebGLRenderTarget(64, 36, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;

  const pUniforms = {
    uGBuffer: { value: target.texture },
    uAtlas: { value: atlas },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrid: { value: new THREE.Vector2(64, 36) },
    uTime: { value: 0 },
    uVoid: { value: gUniforms.uVoid.value },
    uTide: { value: gUniforms.uTide.value },
    uVerdant: { value: gUniforms.uVerdant.value },
    uIris: { value: gUniforms.uIris.value },
    uFrost: { value: gUniforms.uFrost.value },
    uIntensity: { value: aurora.intensity },
    uGrain: { value: finish.grain },
    uVignette: { value: finish.vignette },
  };

  const pMaterial = new THREE.ShaderMaterial({
    uniforms: pUniforms,
    vertexShader: VERTEX,
    fragmentShader: COMPOSITE,
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pMaterial));
  const camera = new THREE.Camera();

  let viewW = 1;
  let viewH = 1;
  let liveAscii = { ...ascii };

  function resizeGrid() {
    const [cols, rows] = gridFor(viewW, viewH, liveAscii);
    if (target.width !== cols || target.height !== rows) target.setSize(cols, rows);
    pUniforms.uGrid.value.set(cols, rows);
    gUniforms.uResolution.value.set(viewW, viewH);
    pUniforms.uResolution.value.set(viewW, viewH);
  }

  return {
    scene,
    camera,
    prerender(renderer) {
      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setRenderTarget(target);
      renderer.render(gScene, gCamera);
      renderer.setRenderTarget(prev);
      renderer.autoClear = prevAuto;
    },
    setSize(width, height) {
      viewW = Math.max(1, width);
      viewH = Math.max(1, height);
      resizeGrid();
    },
    setOctaves(count) {
      gUniforms.uOctaves.value = Math.min(Math.max(count | 0, 1), 8);
    },
    apply(cfg) {
      const p = cfg.palette;
      if (p) {
        if (p.void) gUniforms.uVoid.value.set(...hexToRgb(p.void));
        if (p.tide) gUniforms.uTide.value.set(...hexToRgb(p.tide));
        if (p.verdant) gUniforms.uVerdant.value.set(...hexToRgb(p.verdant));
        if (p.iris) gUniforms.uIris.value.set(...hexToRgb(p.iris));
        if (p.frost) gUniforms.uFrost.value.set(...hexToRgb(p.frost));
      }
      const a = cfg.aurora;
      if (a) {
        if (a.intensity != null) {
          gUniforms.uIntensity.value = a.intensity;
          pUniforms.uIntensity.value = a.intensity;
        }
        if (a.speed != null) gUniforms.uSpeed.value = a.speed;
        if (a.height != null) gUniforms.uHeight.value = a.height;
      }
      const h = cfg.horizon;
      if (h) {
        if (h.y != null) gUniforms.uHorizonY.value = h.y;
        if (h.glow != null) gUniforms.uHorizonGlow.value = h.glow;
        if (h.reflection != null) gUniforms.uReflection.value = h.reflection;
      }
      const s = cfg.stars;
      if (s) {
        if (s.density != null) gUniforms.uStars.value = s.density;
        if (s.twinkle != null) gUniforms.uTwinkle.value = s.twinkle;
      }
      const f = cfg.finish;
      if (f) {
        if (f.grain != null) {
          gUniforms.uGrain.value = f.grain;
          pUniforms.uGrain.value = f.grain;
        }
        if (f.vignette != null) {
          gUniforms.uVignette.value = f.vignette;
          pUniforms.uVignette.value = f.vignette;
        }
      }
      const az = cfg.ascii?.[sceneId];
      if (az) {
        if (az.cellPx != null) liveAscii.cellPx = az.cellPx;
        if (az.minCols != null) liveAscii.minCols = az.minCols;
        if (az.maxCols != null) liveAscii.maxCols = az.maxCols;
        resizeGrid();
      }
    },
    update(elapsed) {
      gUniforms.uTime.value = elapsed;
      pUniforms.uTime.value = elapsed;
    },
    dispose() {
      gMaterial.dispose();
      pMaterial.dispose();
      target.dispose();
    },
  };
}
