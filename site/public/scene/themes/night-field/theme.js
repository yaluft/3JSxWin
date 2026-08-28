export const id = 'night-field';
export const meta = {
  label: 'Night Field',
  blurb: 'A dark sky of sharp stars, distant nebulae and planets — sprinkling, no glow',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // Hard pinpricks only — no halo, no bloom.
  float starSheet(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 3.7));
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 7.1);
        mag *= mag;
        float tw = 0.62 + 0.38 * sin(t * (0.7 + mag * 2.4) + mag * 31.0);
        float d = length(f - pos);
        float core = smoothstep(0.032 + mag * 0.05, 0.0, d);
        acc += present * (0.35 + mag * 1.05) * tw * core;
      }
    }
    return acc;
  }

  float sprinkle(vec2 p, float t) {
    vec2 q = p * 62.0 + vec2(t * 0.04, t * 1.15);
    vec2 i = floor(q);
    vec2 f = fract(q);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float id = hash21(cell + 19.4);
        float present = step(0.948, id);
        vec2 pos = o + hash22(cell + 4.2);
        float d = length(f - pos);
        float life = 0.40 + 0.60 * sin(t * (2.1 + id * 1.6) + id * 40.0);
        acc += present * life * smoothstep(0.038, 0.0, d);
      }
    }
    return acc;
  }

  vec4 planet(vec2 p, vec2 c, float r, vec3 baseCol, vec3 bandCol, float bands, vec3 light) {
    vec2 off = p - c;
    float d = length(off);
    float mask = 1.0 - smoothstep(r - 0.0012, r + 0.0012, d);
    vec2 n2 = off / max(r, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vec3(n2, z);
    vec2 surfUv = rot2(n2, 0.35);
    float noise = fbm(surfUv * 4.2);
    float band = sin((n2.y + noise * 0.12) * bands * 10.0) * 0.5 + 0.5;
    vec3 surface = mix(baseCol, bandCol, band * step(0.4, bands));
    surface = mix(surface, surface * (0.82 + 0.28 * noise), 0.55);
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.9);
    vec3 lit = surface * (0.06 + 0.94 * diff);
    return vec4(lit, mask);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 sp = vec2(uv.x * aspect, uv.y);
    float t = uTime * (0.18 + uSpeed * 1.4);

    float iconZone = 1.0 - smoothstep(0.14, 0.40, uv.x);
    float quiet = mix(1.0, 0.72, iconZone);

    vec3 col = mix(uVoid, uTide * 0.40, smoothstep(-0.08, 1.10, uv.y));

    vec2 q = sp * 1.45 + vec2(t * 0.012, t * 0.004);
    vec2 w = vec2(fbm(q + vec2(2.1, 7.4)), fbm(q + vec2(6.8, 1.9)));
    float n = fbm(q + 1.8 * w) * 0.72 + fbm(q * 2.4 + 3.1 * w) * 0.28;
    float lobe = smoothstep(0.08, 1.12, uv.x * 0.55 + uv.y * 0.62)
               * (0.45 + 0.55 * smoothstep(0.08, 0.82, uv.y));
    float dens = pow(clamp(n * 1.62 - 0.38, 0.0, 1.0), 1.55) * uIntensity * 0.52 * lobe * quiet;
    vec3 neb = mix(uTide * 0.85, mix(uIris, uVerdant, 0.42), smoothstep(0.06, 0.58, n));
    col += neb * dens;

    float st =
          starSheet(sp * 28.0  + vec2(t * 0.03,  0.0), t, 1.0, 0.46) * 0.85
        + starSheet(sp * 48.0  + vec2(t * 0.06, -t * 0.01), t, 2.2, 0.40) * 0.58
        + starSheet(sp * 76.0  + vec2(t * 0.10,  0.0), t, 3.1, 0.36) * 0.40
        + starSheet(sp * 118.0 + vec2(t * 0.16,  0.0), t, 4.4, 0.32) * 0.24;
    col += uFrost * st * uStars * mix(0.70, 1.0, 1.0 - iconZone);

    col += uFrost * sprinkle(sp, t) * 0.85 * quiet * (0.40 + uTwinkle * 0.60);

    vec3 light = normalize(vec3(-0.55, 0.25, 0.78));
    vec2 c0 = vec2(aspect * 0.78 + 0.012 * sin(t * 0.07), 0.68 + 0.018 * sin(t * 0.05));
    vec2 c1 = vec2(aspect * 0.58 + 0.010 * sin(t * 0.04 + 1.7), 0.22 + 0.012 * cos(t * 0.06));
    vec2 c2 = vec2(aspect * 0.88 + 0.008 * cos(t * 0.05 + 0.8), 0.36 + 0.010 * sin(t * 0.08 + 2.2));

    vec4 p0 = planet(sp, c0, 0.038 + uHeight * 0.008, vec3(0.42, 0.46, 0.52), vec3(0.28, 0.32, 0.40), 2.2, light);
    vec4 p1 = planet(sp, c1, 0.022, vec3(0.50, 0.32, 0.22), vec3(0.38, 0.22, 0.14), 1.4, light);
    vec4 p2 = planet(sp, c2, 0.014, vec3(0.55, 0.58, 0.62), vec3(0.40, 0.42, 0.48), 0.0, light);

    col = mix(col, p0.rgb, p0.a * quiet);
    col = mix(col, p1.rgb, p1.a * quiet);
    col = mix(col, p2.rgb, p2.a * quiet);

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const bed = api.osc('sine', 36);
  const g = api.gain(0.035);
  bed.connect(g);
  g.connect(api.master);

  const wash = api.noise('brown');
  const lp = api.filter('lowpass', 110, 0.7);
  const wg = api.gain(0.10);
  wash.connect(lp);
  lp.connect(wg);
  wg.connect(api.master);
  api.lfo(0.04, 18, lp.frequency);

  api.startTracked();

  api.everyRandom(2400, 5600, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const o = api.ctx.createOscillator();
    const gg = api.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(720 + Math.random() * 640, now);
    o.frequency.exponentialRampToValueAtTime(180 + Math.random() * 90, now + 0.42);
    gg.gain.setValueAtTime(0.018, now);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    o.connect(gg);
    gg.connect(api.master);
    o.start(now);
    o.stop(now + 0.5);
  });
}
