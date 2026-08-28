export const id = 'starnode';
export const meta = {
  label: 'Star Node',
  blurb: 'A stellar neighborhood — suns as linked nodes, one local system turning among them',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  float starLayer(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 5.17));
        float mag = hash21(cell + seed * 9.31);
        vec2 pos = o + vec2(hash21(cell + seed), hash21(cell + seed * 2.7));
        float tw = 0.6 + 0.4 * sin(t * (1.2 + mag * 3.0) + mag * 6.28);
        float d = length(f - pos);
        float core = smoothstep(0.03 + mag * 0.03, 0.0, d);
        acc += present * mag * tw * core;
      }
    }
    return acc;
  }

  float segment(vec2 p, vec2 a, vec2 b, float thick) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    return smoothstep(thick, 0.0, length(pa - ba * h));
  }

  vec4 nodeBody(vec2 p, vec2 c, float r, vec3 col, vec3 light) {
    vec2 off = p - c;
    float d = length(off);
    float mask = 1.0 - smoothstep(r - 0.0015, r + 0.0015, d);
    vec2 n2 = off / max(r, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(n2, n2)));
    vec3 n = vec3(n2, z);
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.85);
    vec3 lit = col * (0.08 + 0.92 * diff);
    return vec4(lit, mask);
  }

  vec2 nodePos(int i, float t, float tilt) {
    if (i == 0) return vec2(0.0, 0.0);
    if (i == 1) return vec2(0.42 * cos(t * 0.11 + 0.4), 0.42 * sin(t * 0.11 + 0.4) * tilt);
    if (i == 2) return vec2(0.58 * cos(t * 0.07 + 2.1), 0.58 * sin(t * 0.07 + 2.1) * tilt);
    if (i == 3) return vec2(-0.50 * cos(t * 0.09 + 3.6), 0.50 * sin(t * 0.09 + 3.6) * tilt);
    if (i == 4) return vec2(0.72 * cos(t * 0.05 + 5.2), 0.72 * sin(t * 0.05 + 5.2) * tilt);
    return vec2(-0.68 * cos(t * 0.06 + 1.2), -0.62 * sin(t * 0.06 + 1.2) * tilt);
  }

  vec3 nodeCol(int i) {
    if (i == 0) return vec3(1.00, 0.86, 0.52);
    if (i == 1) return vec3(0.72, 0.82, 1.00);
    if (i == 2) return vec3(1.00, 0.62, 0.42);
    if (i == 3) return vec3(0.62, 0.92, 0.78);
    if (i == 4) return vec3(0.82, 0.70, 1.00);
    return vec3(0.95, 0.78, 0.58);
  }

  float nodeRad(int i) {
    if (i == 0) return 0.048;
    if (i == 1) return 0.018;
    if (i == 2) return 0.022;
    if (i == 3) return 0.016;
    if (i == 4) return 0.020;
    return 0.015;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.08 + uSpeed * 0.55);
    float tilt = 0.52;
    vec2 pt = vec2(p.x, p.y / tilt);

    vec3 col = mix(uVoid, uTide, 0.18 + 0.10 * uv.y) * 0.55;

    float stars = starLayer(p * 26.0 + vec2(t * 0.01, 0.0), t, 1.3, 0.28) * 0.55
                + starLayer(p * 52.0 - vec2(t * 0.02, 0.0), t, 4.7, 0.32) * 0.38
                + starLayer(p * 90.0, t, 8.2, 0.36) * 0.22;
    col += uFrost * stars * uStars;

    vec2 n0 = nodePos(0, t, tilt);
    vec2 n1 = nodePos(1, t, tilt);
    vec2 n2 = nodePos(2, t, tilt);
    vec2 n3 = nodePos(3, t, tilt);
    vec2 n4 = nodePos(4, t, tilt);
    vec2 n5 = nodePos(5, t, tilt);

    float link = 0.0;
    link += segment(p, n0, n1, 0.0024);
    link += segment(p, n0, n2, 0.0020);
    link += segment(p, n0, n3, 0.0020);
    link += segment(p, n1, n4, 0.0016);
    link += segment(p, n2, n5, 0.0016);
    link += segment(p, n3, n5, 0.0014);
    col += mix(uIris, uFrost, 0.35) * link * 0.55 * uIntensity;

    for (int i = 0; i < 4; i++) {
      float r = 0.10 + float(i) * 0.045;
      float dOrbit = abs(length(pt) - r);
      col += mix(uIris, uFrost, 0.4) * smoothstep(0.0032, 0.0, dOrbit) * 0.22 * uIntensity;
    }

    vec3 light = normalize(vec3(-0.15, 0.20, 0.70));

    for (int i = 0; i < 6; i++) {
      vec2 c = nodePos(i, t, tilt);
      float rad = nodeRad(i) * (0.85 + 0.15 * uHeight);
      vec3 base = nodeCol(i);
      if (i == 0) {
        float d = length(p - c);
        float disc = 1.0 - smoothstep(rad - 0.003, rad + 0.003, d);
        vec2 suv = rot2(p - c, t * 0.25) * 16.0;
        vec3 coreCol = mix(vec3(1.0, 0.70, 0.28), vec3(1.0, 0.94, 0.72), fbm(suv));
        col = mix(col, coreCol, disc);
      } else {
        vec4 body = nodeBody(p, c, rad, base, light);
        col = mix(col, body.rgb, body.a);
        float pulse = 0.55 + 0.45 * sin(t * (1.4 + float(i) * 0.7) + float(i));
        float packet = fract(t * 0.35 + float(i) * 0.17);
        vec2 from = n0;
        vec2 to = c;
        vec2 along = mix(from, to, packet);
        float bead = smoothstep(0.012, 0.0, length(p - along)) * pulse;
        col += base * bead * 0.65;
      }
    }

    for (int i = 0; i < 4; i++) {
      float r = 0.10 + float(i) * 0.045;
      float spd = 1.35 - float(i) * 0.22;
      float a = t * spd + float(i) * 1.9;
      vec2 c = vec2(cos(a) * r, sin(a) * r * tilt);
      vec3 pc = mix(uTide, uFrost, 0.35 + 0.15 * float(i));
      if (i == 1) pc = mix(uVerdant, uTide, 0.4);
      if (i == 2) pc = mix(uIris, uTide, 0.35);
      if (i == 3) pc = vec3(0.78, 0.48, 0.28);
      vec4 pl = nodeBody(p, c, 0.010 + float(i) * 0.003, pc, light);
      col = mix(col, pl.rgb, pl.a);
    }

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const bed = api.osc('sine', 44);
  const g = api.gain(0.04);
  bed.connect(g);
  g.connect(api.master);

  const pad = api.osc('triangle', 88);
  const pg = api.gain(0.02);
  pad.connect(pg);
  pg.connect(api.master);

  const wash = api.noise('pink');
  const lp = api.filter('lowpass', 240, 0.8);
  const wg = api.gain(0.03);
  wash.connect(lp);
  lp.connect(wg);
  wg.connect(api.master);
  api.lfo(0.05, 40, lp.frequency);

  api.startTracked();

  api.everyRandom(900, 2200, () => {
    if (!api.ctx) return;
    const now = api.ctx.currentTime;
    const o = api.ctx.createOscillator();
    const gg = api.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(520 + Math.random() * 480, now);
    o.frequency.exponentialRampToValueAtTime(160, now + 0.18);
    gg.gain.setValueAtTime(0.022, now);
    gg.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.connect(gg);
    gg.connect(api.master);
    o.start(now);
    o.stop(now + 0.22);
  });
}
