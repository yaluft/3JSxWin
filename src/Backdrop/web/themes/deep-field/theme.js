export const id = 'deep-field';
export const meta = {
  label: 'Deep Field',
  blurb: 'Nebula, debris, meteor storms and bodies too large to name',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

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

  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  float streak(vec2 p, vec2 head, vec2 dir, float len, float thick) {
    vec2 tail = head - dir * len;
    vec2 pa = p - head;
    vec2 ba = tail - head;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    float d = length(pa - ba * h);
    float taper = mix(thick, thick * 0.08, h);
    return smoothstep(taper, 0.0, d) * (1.0 - h * 0.88);
  }

  float meteorAt(vec2 p, float t, float cycle, float delay, float seed, vec2 dir, float len) {
    float tt = t + delay;
    float idx = floor(tt / cycle);
    float lt = fract(tt / cycle);
    if (lt > 0.24) return 0.0;
    vec2 s = vec2(idx * 1.37 + seed, idx * 2.71 + seed * 0.3);
    vec2 start = vec2(0.05 + hash21(s) * 1.55, 0.42 + hash21(s + 3.1) * 0.85);
    vec2 head = start + dir * smoothstep(0.0, 0.24, lt) * len;
    float life = smoothstep(0.0, 0.03, lt) * smoothstep(0.24, 0.10, lt);
    float thick = 0.0032 + hash21(s + 9.0) * 0.004;
    return streak(p, head, dir, 0.14 + hash21(s + 4.4) * 0.16, thick) * life;
  }

  float meteorStorm(vec2 p, float t) {
    float m = 0.0;
    m += meteorAt(p, t, 3.1, 0.00, 1.1, normalize(vec2(-0.84, -0.54)), 2.15);
    m += meteorAt(p, t, 4.4, 1.10, 2.6, normalize(vec2(-0.62, -0.78)), 1.85);
    m += meteorAt(p, t, 2.5, 0.55, 4.2, normalize(vec2(-0.93, -0.36)), 2.40) * 0.75;
    m += meteorAt(p, t, 5.7, 2.20, 6.0, normalize(vec2(-0.48, -0.88)), 1.60);
    m += meteorAt(p, t, 3.8, 0.90, 8.4, normalize(vec2(0.72, -0.69)), 1.95) * 0.55;
    m += meteorAt(p, t, 7.2, 3.10, 9.7, normalize(vec2(-0.75, -0.66)), 2.20) * 0.9;
    return m;
  }

  float debris(vec2 p, float t) {
    vec2 q = p * 22.0 + vec2(t * 0.42, -t * 0.13);
    vec2 i = floor(q);
    vec2 f = fract(q);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float id = hash21(cell + 11.7);
        float present = step(0.78, id);
        vec2 pos = o + hash22(cell);
        vec2 d = f - pos;
        d = rot2(d, t * (0.5 + id) + id * 17.0);
        float shard = smoothstep(0.055, 0.0, abs(d.x) * (6.0 + id * 10.0) + abs(d.y) * 1.6);
        shard *= smoothstep(0.14, 0.0, length(d));
        acc += present * shard * (0.25 + id * 0.8);
      }
    }
    return acc;
  }

  float supernova(vec2 p, float t) {
    float cycle = 16.5;
    float idx = floor(t / cycle);
    float lt = fract(t / cycle);
    vec2 c = vec2(
      0.42 + hash21(vec2(idx, 2.2)) * 0.72,
      0.28 + hash21(vec2(idx, 8.1)) * 0.58
    );
    float life = smoothstep(0.0, 0.05, lt) * smoothstep(0.62, 0.14, lt);
    float rad = mix(0.008, 0.48, pow(clamp(lt * 1.15, 0.0, 1.0), 0.42));
    float d = length(p - c);
    float ring = exp(-abs(d - rad) * 42.0);
    float shock = exp(-abs(d - rad * 1.18) * 18.0) * 0.45;
    float core = exp(-d * mix(22.0, 3.2, lt)) * (1.0 - smoothstep(0.0, 0.22, lt));
    float wash = exp(-d * 2.4) * (1.0 - lt) * 0.22;
    return (core * 2.4 + ring * 1.55 + shock + wash) * life;
  }

  float comet(vec2 p, float t) {
    float cycle = 21.0;
    float lt = fract(t / cycle + 0.33);
    vec2 dir = normalize(vec2(-0.94, -0.22));
    vec2 head = vec2(1.45, 0.78) + dir * lt * 2.7;
    float d = length(p - head);
    float nucleus = exp(-d * 70.0);
    vec2 along = p - head;
    float axis = clamp(dot(along, dir), 0.0, 0.62);
    float side = abs(dot(along, vec2(-dir.y, dir.x)));
    float tail = exp(-side * mix(55.0, 18.0, axis / 0.62)) * smoothstep(0.62, 0.0, axis);
    return nucleus * 1.8 + tail * 0.55;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 sp = vec2(uv.x * aspect, uv.y);
    float t = uTime * (0.55 + uSpeed * 2.8);

    float iconZone = 1.0 - smoothstep(0.16, 0.44, uv.x);
    float quiet = mix(1.0, 0.42, iconZone);

    vec2 q = sp * 2.6 + vec2(t * 0.045, t * 0.011);
    vec2 w = vec2(fbm(q + vec2(1.7, 9.2)), fbm(q + vec2(5.2, 1.3)));
    float base = fbm(q + 2.4 * w);
    float detail = fbm(q * 3.1 + 4.0 * w);
    float n = base * 0.76 + detail * 0.34;

    float lobeA = smoothstep(0.48, 1.30, uv.x * 0.95 + uv.y * 0.55);
    float lobeB = smoothstep(0.30, -0.15, uv.x * 0.95 + uv.y * 0.45) * 0.45;
    float place = clamp(lobeA + lobeB, 0.0, 1.0);

    float shaped = clamp(n * 1.68 - 0.44, 0.0, 1.0);
    float dens = pow(shaped, 1.55) * uIntensity * 0.65 * place * quiet;

    vec3 col = mix(uVoid, uTide, smoothstep(-0.20, 1.10, uv.y));
    vec3 warm = vec3(uIris.r * 1.35 + 0.12, uIris.g * 0.62, uIris.b * 0.55);
    vec3 neb = mix(uVerdant, uIris, smoothstep(0.03, 0.42, shaped));
    neb = mix(neb, warm, smoothstep(0.58, 0.92, shaped) * 0.55);
    col += neb * dens * 1.05;

    float st =
          starSheet(sp * 36.0  + vec2(t * 0.07,  0.0), t, 1.0) * 0.62
        + starSheet(sp * 58.0  + vec2(t * 0.13, -t * 0.02), t, 2.2) * 0.40
        + starSheet(sp * 84.0  + vec2(t * 0.21,  0.0), t, 3.1) * 0.28
        + starSheet(sp * 128.0 + vec2(t * 0.33,  0.0), t, 4.4) * 0.16;
    col += uFrost * st * uStars * mix(0.38, 1.0, 1.0 - iconZone);

    float bits = debris(sp, t);
    col += mix(uTide, uFrost, 0.45) * bits * 0.55 * quiet;

    if (uTwinkle > 0.08) {
      float storm = meteorStorm(sp, t);
      col += uFrost * storm * (0.85 + uTwinkle * 0.5) * quiet;
      col += mix(uIris, uFrost, 0.4) * comet(sp, t) * 0.9 * quiet;
    }

    float nova = supernova(sp, t) * (0.55 + uHeight * 0.7);
    col += mix(uIris, uFrost, 0.35) * nova * quiet;
    col += warm * nova * 0.35 * quiet;

    float passT = fract(t * 0.018 + 0.12);
    vec2 body = vec2(mix(-1.85, 2.35, passT), 0.22 + 0.10 * sin(t * 0.07));
    float rad = 1.42;
    float sd = length(sp - body) - rad;
    float disc = smoothstep(0.05, -0.02, sd);
    float limb = exp(-abs(sd) * 26.0);
    col *= mix(1.0, 0.18, disc * 0.82 * (1.0 - iconZone * 0.35));
    col += mix(uIris, uFrost, 0.55) * limb * 0.62 * uHorizonGlow;
    col += uFrost * exp(-abs(sd + 0.08) * 9.0) * 0.08 * disc;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const bed = api.osc('sine', 38);
  const g = api.gain(0.045);
  bed.connect(g);
  g.connect(api.master);

  const wash = api.noise('brown');
  const lp = api.filter('lowpass', 130, 0.7);
  const wg = api.gain(0.14);
  wash.connect(lp);
  lp.connect(wg);
  wg.connect(api.master);
  api.lfo(0.05, 28, lp.frequency);

  api.startTracked();

  api.everyRandom(1800, 4200, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const o = api.ctx.createOscillator();
    const gg = api.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(980 + Math.random() * 900, now);
    o.frequency.exponentialRampToValueAtTime(220 + Math.random() * 180, now + 0.28);
    gg.gain.setValueAtTime(0.028, now);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    o.connect(gg);
    gg.connect(api.master);
    o.start(now);
    o.stop(now + 0.35);
  });

  api.everyRandom(14000, 20000, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const o = api.ctx.createOscillator();
    const gg = api.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(42, now);
    o.frequency.exponentialRampToValueAtTime(18, now + 1.6);
    gg.gain.setValueAtTime(0.06, now);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    o.connect(gg);
    gg.connect(api.master);
    o.start(now);
    o.stop(now + 1.9);
  });
}
