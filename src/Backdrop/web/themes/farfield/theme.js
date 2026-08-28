export const id = 'farfield';
export const meta = {
  label: 'Farfield',
  blurb: 'A quiet star field — small worlds adrift, no nebula, no glow',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // Same multi-layer twinkling star sheet Deep Field uses — it's the one thing this
  // theme keeps, since it was already exactly "twinkle, don't glow".
  float starSheet(vec2 p, float t, float seed) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(0.74, hash21(cell + seed * 3.7));
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;
        float tw = 0.62 + 0.38 * sin(t * (0.9 + mag * 2.2) + mag * 31.0);
        float d = length(f - pos);
        float core = smoothstep(0.028 + mag * 0.05, 0.0, d);
        float halo = smoothstep(0.09 + mag * 0.20, 0.0, d) * 0.10 * mag;
        acc += present * (0.30 + mag * 0.90) * tw * (core + halo);
      }
    }
    return acc;
  }

  // A small, flat, soft-edged disc — brightness twinkles slowly, position never
  // moves. No exponential limb glow: that's the "less glowy" part of the ask.
  float distantPlanet(vec2 p, vec2 c, float r, float t, float seed) {
    float d = length(p - c);
    float disc = 1.0 - smoothstep(r * 0.82, r, d);
    float tw = 0.78 + 0.22 * sin(t * (0.12 + seed * 0.05) + seed * 22.0);
    return disc * tw;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 sp = vec2(uv.x * aspect, uv.y);
    float t = uTime * (0.10 + uSpeed * 0.6);

    float iconZone = 1.0 - smoothstep(0.16, 0.44, uv.x);
    float quiet = mix(1.0, 0.55, iconZone);

    vec3 col = mix(uVoid, uTide, smoothstep(-0.10, 1.05, uv.y) * 0.5);

    float st =
          starSheet(sp * 30.0  + vec2(t * 0.02,  0.0), t, 1.0) * 0.60
        + starSheet(sp * 52.0  + vec2(t * 0.035, -t * 0.01), t, 2.2) * 0.42
        + starSheet(sp * 80.0  + vec2(t * 0.05,  0.0), t, 3.1) * 0.30
        + starSheet(sp * 120.0 + vec2(t * 0.07,  0.0), t, 4.4) * 0.18;
    col += uFrost * st * uStars * mix(0.45, 1.0, 1.0 - iconZone);

    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 c = vec2(
        hash21(vec2(fi, 4.1)) * aspect * 1.15 - aspect * 0.03,
        0.08 + hash21(vec2(fi, 9.7)) * 0.8
      );
      float r = 0.010 + hash21(vec2(fi, 15.3)) * 0.022 * (0.7 + uHeight * 0.6);
      float body = distantPlanet(sp, c, r, t, fi);
      col += mix(uIris, uFrost, hash21(vec2(fi, 27.4))) * body * uIntensity * 0.7 * quiet;
    }

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(41, 61.5, 0.05);

  const air = api.noise('pink');
  const hp = api.filter('highpass', 1200, 0.6);
  const g = api.gain(0.02);
  air.connect(hp);
  hp.connect(g);
  g.connect(api.master);

  api.startTracked();

  api.everyRandom(5000, 11000, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const o = api.ctx.createOscillator();
    const gg = api.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400 + Math.random() * 900, now);
    gg.gain.setValueAtTime(0.0001, now);
    gg.gain.exponentialRampToValueAtTime(0.018, now + 0.4);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    o.connect(gg);
    gg.connect(api.master);
    o.start(now);
    o.stop(now + 2.4);
  });
}
