export const id = 'sporehall';
export const meta = { label: 'Sporehall', blurb: 'A nave whose ribs are pipes; spores are packets', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.1 + uSpeed * 0.8);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float z = 0.15 + p.y * 1.4;
    vec2 q = vec2(p.x / max(z, 0.08), 1.0 / max(z, 0.08));

    float arches = 0.0;
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float row = fract(q.y * 0.35 + t * 0.08 + fi * 0.12);
      float arch = abs(abs(q.x) - (0.55 - row * 0.2));
      float pipe = 1.0 - smoothstep(0.0, 0.04, arch);
      pipe *= 1.0 - smoothstep(0.55, 0.0, row);
      arches += pipe;
    }
    float vault = 1.0 - smoothstep(0.0, 0.08, abs(q.x) - 0.08);
    vault *= smoothstep(0.2, 0.9, uv.y);

    vec2 sg = vec2(p.x * 16.0, uv.y * 10.0 - t * 0.25);
    vec2 sid = floor(sg);
    float n = hash21(sid);
    vec2 sf = fract(sg) - 0.5;
    float spore = smoothstep(0.14, 0.0, length(sf)) * step(0.86, n);

    vec3 col = mix(uVoid, uTide, 0.2 + uv.y * 0.15);
    col += uIris * arches * 0.4 * uIntensity;
    col += uVerdant * vault * 0.12;
    col += uFrost * spore * 1.3;
    col += uFrost * exp(-length(p) * 2.0) * 0.06 * uHorizonGlow;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const hiss = api.noise('white');
  const bp = api.filter('bandpass', 900, 0.5);
  const g = api.gain(0.05);
  hiss.connect(bp);
  bp.connect(g);
  g.connect(api.master);
  const drone = api.osc('sine', 49);
  const dg = api.gain(0.05);
  drone.connect(dg);
  dg.connect(api.master);
  api.startTracked();
  api.everyRandom(600, 1800, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const o = api.ctx.createOscillator();
    const gg = api.ctx.createGain();
    o.frequency.value = 2400 + Math.random() * 800;
    gg.gain.setValueAtTime(0.035, now);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    o.connect(gg);
    gg.connect(api.master);
    o.start(now);
    o.stop(now + 0.2);
  });
}
