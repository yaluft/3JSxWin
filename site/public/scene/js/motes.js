// motes.js — the drifting-dust overlay (createMotes). main.js draws this as the SECOND
// pass every frame, on top of whatever scene (sky.js, an ASCII scene, ...) rendered
// first. It is its own tiny three.js world — one Scene, one PerspectiveCamera, one
// Points object — so main.js can render it with a plain renderer.render(scene, camera)
// and nothing here needs to know which backdrop is underneath.
//
// Ice motes drifting in front of the sky. One Points object, animated entirely in the
// vertex shader, so the CPU touches nothing per frame.

import * as THREE from 'three';
// hexToRgb: the one shared "#rrggbb" -> [r,g,b] in 0..1 linear. Every shader module
// uses it so the palette means the same thing everywhere — see config.js for why we
// deliberately avoid THREE.Color here.
import { hexToRgb } from './config.js';

// The mote cloud is a box in world units centred on the origin. These spans are much
// WIDER than the camera ever sees (the camera sits at z=22 with a 55-deg FOV) on
// purpose: motes that sway or wrap near the edges do so well outside the frame, so you
// never catch one popping in or out. X is widest because a wide monitor / multi-monitor
// span shows the most horizontal field.
const SPAN_X = 90;
const SPAN_Y = 60;
const SPAN_Z = 40;

// The whole animation lives here. Each mote's home position never changes on the CPU
// after creation; the vertex shader takes that static position plus uTime and works
// out where the mote is THIS frame. That is why the render loop only has to bump one
// uniform (uTime) — no buffer re-upload, no per-particle JS.
const VERTEX = /* glsl */ `
  // Per-mote constants, uploaded once as BufferAttributes (see createMotes):
  //   aSize  — this mote's base pixel size, already randomised per mote
  //   aPhase — a random 0..2pi offset so every mote sways / twinkles out of step
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;        // seconds since scene start; the only thing that changes per frame
  uniform float uDrift;       // vertical speed in world units/sec — the "drift" panel slider
  uniform float uPixelRatio;  // device pixel ratio, so point size is constant in CSS pixels
  uniform float uOpacity;     // master fade for the whole field — the "opacity" panel slider

  // Passed to the fragment shader: this mote's final alpha for the frame.
  varying float vAlpha;

  void main() {
    vec3 p = position;

    // Rise and wrap, with a slow lateral sway so the field never reads as a grid.
    // mod(..., SPAN_Y) makes the motes loop: a mote that drifts off the top
    // instantly reappears at the bottom, so a finite set of points looks like an
    // endless fall. The + SPAN_Y/2 / - SPAN_Y/2 keeps the wrapped range centred on
    // the origin. SPAN_Y is baked in as a GLSL literal (template string) because
    // GLSL ES 2.0 has no way to pass it as a compile-time constant.
    p.y = mod(p.y + uTime * uDrift + ${SPAN_Y / 2}.0, ${SPAN_Y}.0) - ${SPAN_Y / 2}.0;
    // Lateral sway: a slow sine (period ~37s) nudged by aPhase so no two motes move
    // together. 0.9 world units of travel — enough to break up any lattice, small
    // enough that motes don't visibly slide sideways.
    p.x += sin(uTime * 0.17 + aPhase) * 0.9;

    // Standard model-view then projection. mv.z is the mote's distance in front of
    // the camera (negative = in front), which we reuse below for perspective sizing
    // and depth fade.
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective point sizing: gl_PointSize is in pixels and WebGL will NOT scale it
    // with distance for us, so we do it by hand — 26/(-mv.z) shrinks far motes. The
    // max(..., 1.0) stops a divide-by-zero (and a giant point) if a mote lands on the
    // camera plane. uPixelRatio keeps the on-screen size the same on a HiDPI panel.
    gl_PointSize = aSize * uPixelRatio * (26.0 / max(-mv.z, 1.0));

    // Depth fade: motes right at the back of the box (mv.z near -SPAN_Z) fade to 0,
    // motes near the camera are full strength. Hides the hard far edge of the cloud.
    float depth   = smoothstep(-${SPAN_Z}.0, -4.0, mv.z);
    // Twinkle: each mote breathes between 0.45x and 1.0x brightness on its own phase,
    // so the field shimmers instead of sitting still. aPhase * 6.28 spreads the start
    // times across a full cycle.
    float twinkle = 0.45 + 0.55 * sin(uTime * 0.6 + aPhase * 6.28);
    vAlpha = uOpacity * depth * twinkle;
  }
`;

// Turns each square point sprite into a soft round dot. mediump is plenty here —
// a small blurred blob has no gradient worth the cost of highp.
const FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform vec3 uColor;     // mote colour, kept in sync with the palette's "frost" slot
  varying float vAlpha;    // per-mote alpha the vertex shader computed

  void main() {
    // gl_PointCoord is 0..1 across the point sprite; distance from its centre (0.5)
    // gives us a radial falloff. smoothstep(0.5, 0.05, d) is 1 in the core and eases
    // to 0 at the rim — a fuzzy circle with no hard edge (and no texture needed).
    float d = length(gl_PointCoord - 0.5);
    float mask = smoothstep(0.5, 0.05, d);
    // Discard the fully-transparent corners outright. With depthWrite off it wouldn't
    // corrupt anything, but skipping the blend is a small win over a whole field.
    if (mask <= 0.002) discard;
    gl_FragColor = vec4(uColor, mask * vAlpha);
  }
`;

// Builds the mote field from config.motes and returns the { scene, camera, setSize,
// apply, update, dispose } shape main.js expects from every overlay.
export function createMotes(config) {
  const settings = config.motes;
  // count | 0 truncates to an int; Math.max(0, ...) tolerates a negative in config.
  // A count of 0 is legal — every loop and buffer below just ends up empty.
  const count = Math.max(0, settings.count | 0);

  // Three parallel typed arrays, one slot (or three, for position) per mote. Typed
  // arrays because that is what a BufferAttribute uploads straight to the GPU with no
  // copy. We fill them once, here, and never touch them again — all motion is in the
  // shader.
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Scatter the home position uniformly through the box. x and y are centred on 0
    // (hence the -0.5); z is 0..-SPAN_Z, i.e. always in front of the origin and
    // receding away from the camera.
    positions[i * 3] = (Math.random() - 0.5) * SPAN_X;
    positions[i * 3 + 1] = (Math.random() - 0.5) * SPAN_Y;
    positions[i * 3 + 2] = -Math.random() * SPAN_Z;
    // Base size jittered 0.35x..1.25x around the configured size so the field has a
    // mix of near-and-far-looking grains rather than one uniform speck size.
    sizes[i] = settings.size * (0.35 + Math.random() * 0.9);
    // Random phase — feeds both the sway and the twinkle so the whole field is
    // desynchronised from a single random number per mote.
    phases[i] = Math.random() * Math.PI * 2;
  }

  // One BufferGeometry holding the three attributes. 'position' is three floats per
  // vertex, the two custom attributes are one float each — the '1' vs '3' is the
  // itemSize the shader's `attribute float` / `vec3` declarations must match.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  // We set the bounding sphere by hand. three.js would otherwise compute it from the
  // static home positions, but the shader moves motes at runtime (the x-sway pushes
  // them past SPAN_X/2), so an auto sphere would be too small and three.js could
  // frustum-cull the whole cloud when it shouldn't. A generous radius disables that.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SPAN_X);

  // uPixelRatio starts at 1 and is set for real in setSize() once main.js knows the
  // display. Everything else comes straight from config and can be hot-swapped by
  // apply() while the scene runs.
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
    // transparent: the dots are mostly see-through and must blend with the sky behind.
    transparent: true,
    // depthTest off: this pass runs after the backdrop with its own camera and there
    // is nothing in this scene for motes to be occluded by, so a depth compare is
    // wasted work. depthWrite off: motes must never populate the depth buffer, or
    // near motes would punch holes in far ones instead of blending.
    depthTest: false,
    depthWrite: false,
    // Additive: overlapping motes and the bright sky add up toward white, which reads
    // as glowing ice crystals catching light rather than flat opaque paint. It also
    // makes draw order irrelevant — addition is commutative — which is why we can get
    // away with no depth sorting.
    blending: THREE.AdditiveBlending,
  });

  // Self-contained mini-scene: just the one Points object. main.js renders this with
  // its own renderer.render(scene, camera) call, clearing colour but not depth.
  const scene = new THREE.Scene();
  scene.add(new THREE.Points(geometry, material));

  // Perspective camera so motes have real depth (near ones bigger, parallax on the
  // sway). 55-deg FOV, near 0.1 / far 200 comfortably brackets the SPAN_Z-deep box.
  // Pulled back to z=22 so the origin plane sits a little way into the frame.
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 22);

  return {
    scene,
    camera,
    // Called by main.js on start and on every resize. Fix the camera aspect to the
    // real viewport (max(height,1) guards a 0-height frame during layout) and record
    // the device pixel ratio so on-screen dot size stays constant across displays.
    setSize(width, height, pixelRatio) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      uniforms.uPixelRatio.value = pixelRatio;
    },
    // Live control from the on-scene panel. Count is fixed at creation (it sizes the
    // buffers), so changing it needs a scene reload; the rest apply instantly.
    // Mirrors the config shape and null-checks each key, so the panel can send a
    // partial patch ({ motes: { drift } }) without disturbing the other uniforms.
    apply(cfg) {
      const m = cfg.motes;
      if (!m) return;
      if (m.drift != null) uniforms.uDrift.value = m.drift;
      if (m.opacity != null) uniforms.uOpacity.value = m.opacity;
      if (m.color) uniforms.uColor.value.set(...hexToRgb(m.color));
    },
    // Called once per frame from the render loop. The elapsed seconds is the ONLY
    // thing driving the animation — the shader derives every mote's position from it.
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    // main.js calls this when switching scenes. Free the GPU buffers and the compiled
    // shader program now rather than waiting for GC. The geometry attributes go with
    // geometry.dispose(); the shared THREE import and the scene graph are just JS
    // objects and get collected normally.
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
