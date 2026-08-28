export const id = 'globule';
export const meta = {
  label: 'Globule',
  blurb: 'A globular cluster — twin cores, a halo of worlds, meteors, pulsar sweep',
  silent: true,
};
export const kind = 'shader';
export const galaxyStream = 'https://ice4.somafm.com/spacestation-128-mp3';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  float starSheet(vec2 p, float t, float seed, float density, float size) {
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
        float tw = 0.55 + 0.45 * sin(t * (0.8 + mag * 3.4) + mag * 31.0);
        float d = length(f - pos);
        float core = smoothstep(size * (0.9 + mag * 1.6), 0.0, d);
        float spike = 0.0;
        if (mag > 0.55) {
          vec2 sp = abs(f - pos);
          spike = exp(-sp.x * 90.0) * exp(-sp.y * 14.0) * mag
                + exp(-sp.y * 90.0) * exp(-sp.x * 14.0) * mag;
        }
        acc += present * (0.28 + mag * 1.15) * tw * (core + spike * 0.35);
      }
    }
    return acc;
  }

  vec4 body(vec2 p, vec2 c, float r, vec2 lightXY, vec3 baseCol, vec3 bandCol, float bands, float atmo) {
    vec2 off = p - c;
    float d = length(off);
    if (d > r * 1.65) return vec4(0.0);
    float mask = 1.0 - smoothstep(r - 0.0016, r + 0.0016, d);
    if (mask <= 0.0) return vec4(0.0);
    vec2 n2 = off / max(r, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vec3(n2, z);
    vec3 light = normalize(vec3(lightXY - c, 0.28));
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.82);
    float surf = fbm(n2 * 6.2 + vec2(0.4, 0.1));
    float band = sin((n2.y + surf * 0.12) * bands * 11.0) * 0.5 + 0.5;
    vec3 surface = mix(baseCol, bandCol, band * step(0.4, bands));
    surface = mix(surface, surface * (0.78 + 0.44 * surf), 0.55);
    vec3 lit = surface * (0.05 + 0.95 * diff);
    float fres = pow(1.0 - n.z, 2.4) * atmo;
    lit += mix(surface, uFrost, 0.45) * fres * (0.18 + 0.82 * diff);
    return vec4(lit, mask);
  }

  float meteor(vec2 p, float t, float seed) {
    float cycle = fract(t * 0.17 + seed);
    float life = smoothstep(0.0, 0.08, cycle) * (1.0 - smoothstep(0.22, 0.38, cycle));
    if (life <= 0.0) return 0.0;
    vec2 origin = vec2(-0.95 + hash21(vec2(seed, 1.1)) * 1.9, 0.72 - hash21(vec2(seed, 2.2)) * 0.35);
    vec2 dir = normalize(vec2(0.55 + hash21(vec2(seed, 3.3)) * 0.4, -0.82));
    vec2 head = origin + dir * cycle * 2.4;
    vec2 pa = p - head;
    float along = clamp(dot(pa, -dir), 0.0, 0.22);
    vec2 closest = pa + dir * along;
    float d = length(closest);
    float headGlow = exp(-d * 140.0);
    float tail = exp(-d * 55.0) * exp(-along * 14.0);
    return (headGlow * 1.6 + tail) * life;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.07 + uSpeed * 0.55);

    vec2 cluster = vec2(0.06, 0.04);
    vec2 pc = rot2(p - cluster, t * 0.045);
    float r = length(pc);

    vec3 col = mix(uVoid * 1.15, uTide * 0.35, smoothstep(-0.85, 0.4, p.y));

    vec2 q = pc * 2.05 + vec2(t * 0.025, -t * 0.016);
    float dust = fbm(q + fbm(q * 2.4 + vec2(2.1, 4.7)));
    vec3 haloCol = mix(mix(uIris, vec3(1.0, 0.68, 0.36), 0.35), uVerdant * 0.55, dust);
    float envelope = exp(-pow(r * 1.05, 1.35)) * (0.5 + 0.5 * uHeight);
    col += haloCol * pow(dust, 1.85) * envelope * 0.55 * uIntensity;

    float lane = abs(pc.y * 0.85 + 0.22 * sin(pc.x * 2.8 + t * 0.35));
    col *= 1.0 - smoothstep(0.16, 0.03, lane) * envelope * 0.28;

    // Packed core is stars, not a sun disc.
    float coreGlow = exp(-r * 3.8) * (0.55 + 0.08 * sin(t * 1.4));
    col += vec3(1.0, 0.82, 0.55) * coreGlow * 0.42 * uIntensity;

    float dens = clamp(exp(-r * r * 2.6) * 1.9 + 0.14, 0.14, 1.0);
    float pack = exp(-r * 1.15);
    float stars = starSheet(pc * 16.0, t, 1.2, 0.78 * dens, 0.032) * 1.05
                + starSheet(pc * 32.0 + vec2(t * 0.015, 0.0), t, 4.8, 0.70 * dens, 0.024) * 0.9
                + starSheet(pc * 58.0, t, 9.1, 0.58 * dens, 0.018) * 0.72
                + starSheet(pc * 96.0, t, 11.6, 0.50 * dens, 0.016) * 0.55
                + starSheet(pc * 150.0, t, 17.2, 0.82 * dens, 0.028) * pack * 1.35
                + starSheet(pc * 230.0, t, 21.5, 0.74 * dens, 0.024) * pack * 0.95
                + starSheet(p * 120.0, t, 13.4, 0.20, 0.014) * 0.28;
    col += mix(uFrost, vec3(1.0, 0.9, 0.68), clamp(1.0 - r * 1.1, 0.0, 1.0)) * stars * uStars;

    vec2 a = cluster + vec2(cos(t * 0.55) * 0.045, sin(t * 0.55) * 0.028);
    vec2 b = cluster + vec2(cos(t * 0.55 + 3.14159) * 0.045, sin(t * 0.55 + 3.14159) * 0.028);
    float da = length(p - a);
    float db = length(p - b);
    col += vec3(1.0, 0.88, 0.55) * exp(-da * 90.0) * 0.85 * uIntensity;
    col += vec3(0.7, 0.84, 1.0) * exp(-db * 90.0) * 0.75 * uIntensity;
    vec2 ba = b - a;
    vec2 pa = p - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    float beam = exp(-length(pa - ba * h) * 90.0);
    col += vec3(1.0, 0.9, 0.7) * beam * 0.45 * uIntensity;

    float sweep = fract(atan(pc.y, pc.x) / 6.28318 + t * 0.08);
    float pulsar = smoothstep(0.018, 0.0, abs(sweep - 0.5) - 0.003) * exp(-r * 1.4) * (1.0 - smoothstep(0.04, 0.72, r));
    col += mix(uIris, uFrost, 0.5) * pulsar * 0.38 * uIntensity;

    float nova = pow(max(0.0, sin(t * 0.27)), 64.0);
    col += vec3(1.0, 0.94, 0.82) * nova * exp(-r * 5.5) * 0.35;

    col += uFrost * meteor(p, t, 0.11) * 1.1;
    col += mix(uIris, uFrost, 0.4) * meteor(p, t + 1.7, 0.62) * 0.85;
    col += vec3(1.0, 0.78, 0.45) * meteor(p, t + 3.1, 0.33) * 0.7;

    vec2 light = mix(a, b, 0.5);

    vec2 p0 = cluster + vec2(cos(t * 0.19 + 0.2) * 0.62, sin(t * 0.19 + 0.2) * 0.34);
    vec4 w0 = body(p, p0, 0.048, light, vec3(0.22, 0.42, 0.78), vec3(0.18, 0.62, 0.38), 1.4, 0.9);
    col = mix(col, w0.rgb, w0.a);
    vec2 m0 = p0 + vec2(cos(t * 2.4) * 0.055, sin(t * 2.4) * 0.028);
    vec4 moon0 = body(p, m0, 0.008, light, vec3(0.72, 0.7, 0.66), vec3(0.5), 0.0, 0.05);
    col = mix(col, moon0.rgb, moon0.a);

    vec2 p1 = cluster + vec2(cos(t * 0.13 + 2.1) * 0.78, sin(t * 0.13 + 2.1) * 0.40);
    vec4 w1 = body(p, p1, 0.062, light, vec3(0.82, 0.62, 0.42), vec3(0.62, 0.38, 0.18), 3.5, 0.45);
    float ring1 = 0.0;
    {
      vec2 ro = p - p1;
      float rd = length(vec2(ro.x, ro.y / 0.36));
      ring1 = smoothstep(0.062, 0.068, rd) * (1.0 - smoothstep(0.098, 0.108, rd));
      ring1 *= 1.0 - smoothstep(0.082, 0.086, rd) * (1.0 - smoothstep(0.086, 0.090, rd));
    }
    if (p.y < p1.y) col += vec3(0.86, 0.76, 0.52) * ring1 * 0.65;
    col = mix(col, w1.rgb, w1.a);
    if (p.y >= p1.y) col = mix(col, vec3(0.86, 0.76, 0.52), ring1 * 0.8);

    vec2 p2 = cluster + vec2(cos(t * 0.11 + 4.0) * 0.92, sin(t * 0.11 + 4.0) * 0.42);
    vec4 w2 = body(p, p2, 0.030, light, vec3(0.78, 0.32, 0.18), vec3(0.48, 0.18, 0.1), 0.8, 0.3);
    col = mix(col, w2.rgb, w2.a);

    vec2 p3 = cluster + vec2(cos(t * 0.09 + 5.4) * 1.05, sin(t * 0.09 + 5.4) * 0.48);
    vec4 w3 = body(p, p3, 0.040, light, vec3(0.32, 0.72, 0.82), vec3(0.18, 0.48, 0.7), 1.2, 0.7);
    col = mix(col, w3.rgb, w3.a);
    vec2 m3 = p3 + vec2(cos(-t * 1.8) * 0.048, sin(-t * 1.8) * 0.022);
    vec4 moon3 = body(p, m3, 0.007, light, vec3(0.85, 0.82, 0.7), vec3(0.55), 0.0, 0.0);
    col = mix(col, moon3.rgb, moon3.a);

    vec2 p4 = cluster + vec2(cos(t * 0.16 + 1.3) * 0.70, sin(t * 0.16 + 1.3) * 0.32);
    vec4 w4 = body(p, p4, 0.020, light, vec3(0.62, 0.55, 0.5), vec3(0.4, 0.36, 0.32), 0.0, 0.1);
    col = mix(col, w4.rgb, w4.a);

    vec2 p5 = cluster + vec2(cos(t * 0.07 + 3.6) * 1.18, sin(t * 0.07 + 3.6) * 0.52);
    vec4 w5 = body(p, p5, 0.050, light, vec3(0.18, 0.28, 0.72), vec3(0.12, 0.18, 0.5), 2.2, 0.75);
    col = mix(col, w5.rgb, w5.a);

    vec2 p6 = vec2(-0.72, -0.38) + vec2(cos(t * 0.08) * 0.06, sin(t * 0.08) * 0.03);
    vec4 w6 = body(p, p6, 0.072, light, vec3(0.92, 0.78, 0.42), vec3(0.72, 0.5, 0.22), 0.5, 0.55);
    col = mix(col, w6.rgb, w6.a);

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const sub = api.osc('sine', 36.71);
  const subG = api.gain(0.06);
  sub.connect(subG);
  subG.connect(api.master);

  const pad1 = api.osc('sine', 73.42);
  const pad2 = api.osc('triangle', 110.0);
  const padF = api.filter('lowpass', 380, 0.9);
  const padG = api.gain(0.035);
  pad1.connect(padF);
  pad2.connect(padF);
  padF.connect(padG);
  padG.connect(api.master);
  api.lfo(0.04, 90, padF.frequency);

  const shimmer = api.noise('pink');
  const shF = api.filter('highpass', 1800, 0.7);
  const shG = api.gain(0.012);
  shimmer.connect(shF);
  shF.connect(shG);
  shG.connect(api.master);

  api.bed(48.99, 73.42, 0.03);
  api.startTracked();

  const notes = [196.0, 246.94, 293.66, 329.63, 392.0, 493.88, 587.33];
  api.everyRandom(1400, 2800, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const osc = api.ctx.createOscillator();
    const g = api.ctx.createGain();
    const f = api.ctx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[Math.floor(Math.random() * notes.length)], now);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, now);
    f.frequency.exponentialRampToValueAtTime(280, now + 1.2);
    g.gain.setValueAtTime(0.018, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    osc.connect(f);
    f.connect(g);
    g.connect(api.master);
    osc.start(now);
    osc.stop(now + 1.5);
    osc.onended = () => {
      try { osc.disconnect(); f.disconnect(); g.disconnect(); } catch { /* */ }
    };
  });
}
