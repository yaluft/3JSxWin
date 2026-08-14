// Ice motes drifting in front of the sky. One Points object, animated entirely in the
// vertex shader, so the CPU touches nothing per frame.

import * as THREE from 'three';
import { hexToRgb } from './config.js';

const SPAN_X = 90;
const SPAN_Y = 60;
const SPAN_Z = 40;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;
  uniform float uDrift;
  uniform float uPixelRatio;
  uniform float uOpacity;

  varying float vAlpha;

  void main() {
    vec3 p = position;

    // Rise and wrap, with a slow lateral sway so the field never reads as a grid.
    p.y = mod(p.y + uTime * uDrift + ${SPAN_Y / 2}.0, ${SPAN_Y}.0) - ${SPAN_Y / 2}.0;
    p.x += sin(uTime * 0.17 + aPhase) * 0.9;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (26.0 / max(-mv.z, 1.0));

    float depth   = smoothstep(-${SPAN_Z}.0, -4.0, mv.z);
    float twinkle = 0.45 + 0.55 * sin(uTime * 0.6 + aPhase * 6.28);
    vAlpha = uOpacity * depth * twinkle;
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float mask = smoothstep(0.5, 0.05, d);
    if (mask <= 0.002) discard;
    gl_FragColor = vec4(uColor, mask * vAlpha);
  }
`;

export function createMotes(config) {
  const settings = config.motes;
  const count = Math.max(0, settings.count | 0);

  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SPAN_X;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPAN_Y;
    positions[i * 3 + 2] = -Math.random() * SPAN_Z;
    sizes[i] = settings.size * (0.35 + Math.random() * 0.9);
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SPAN_X);

  const uniforms = {
    uTime: { value: 0 },
    uDrift: { value: settings.drift },
    uPixelRatio: { value: 1 },
    uOpacity: { value: settings.opacity },
    uColor: { value: new THREE.Vector3(...hexToRgb(settings.color)) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Points(geometry, material));

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 22);

  return {
    scene,
    camera,
    setSize(width, height, pixelRatio) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      uniforms.uPixelRatio.value = pixelRatio;
    },
    // Live control from the on-scene panel. Count is fixed at creation (it sizes the
    // buffers), so changing it needs a scene reload; the rest apply instantly.
    apply(cfg) {
      const m = cfg.motes;
      if (!m) return;
      if (m.drift != null) uniforms.uDrift.value = m.drift;
      if (m.opacity != null) uniforms.uOpacity.value = m.opacity;
      if (m.color) uniforms.uColor.value.set(...hexToRgb(m.color));
    },
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
