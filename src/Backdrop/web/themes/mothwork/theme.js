export const id = 'mothwork';
export const meta = { label: 'Mothwork', blurb: 'A turbine of moth wings shedding iridescent scale dust', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  float wing(vec2 p, float a, float s) {
    float c = cos(a), si = sin(a);
    vec2 q = vec2(c * p.x + si * p.y, -si * p.x + c * p.y);
    q.x /= s;
    q.y *= 1.8;
    float body = length(q * vec2(1.0, 1.6)) - 0.22;
    float scallop = 0.04 * sin(atan(q.y, q.x) * 6.0);
    return body + scallop;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.08 + uSpeed * 0.7);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    float blades = 1.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float a = t * 0.35 + fi * 1.047;
      blades = min(blades, wing(p, a, 0.85 + 0.08 * sin(t + fi)));
    }
    float moth = 1.0 - smoothstep(0.0, 0.08, blades);
    moth *= uIntensity;

    vec2 dust = p * 14.0;
    dust.y += t * 0.6;
    vec2 idn = floor(dust);
    float n = hash21(idn);
    vec2 f = fract(dust) - 0.5;
    float scale = smoothstep(0.22, 0.0, length(f)) * step(0.78, n);

    vec3 irid = mix(uVerdant, uIris, 0.5 + 0.5 * sin(atan(p.y, p.x) * 3.0 + t));
    vec3 col = mix(uVoid, uTide, 0.25 + 0.2 * length(p));
    col = mix(col, irid, moth * 0.85);
    col += uFrost * moth * (0.15 + 0.2 * uHeight);
    col += mix(uIris, uFrost, n) * scale * 0.9;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const air = api.noise('pink');
  const lp = api.filter('lowpass', 420, 0.7);
  const g = api.gain(0.16);
  air.connect(lp);
  lp.connect(g);
  g.connect(api.master);
  api.lfo(0.18, 0.04, g.gain);
  const beat = api.osc('sine', 48);
  const bg = api.gain(0.04);
  beat.connect(bg);
  bg.connect(api.master);
  api.startTracked();
}
