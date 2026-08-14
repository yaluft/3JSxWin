export const id = 'lungclock';
export const meta = { label: 'Lungclock', blurb: 'A ribcage of bellows and valves that breathes light', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.12 + uSpeed * 0.8);
    float breath = 0.5 + 0.5 * sin(t * 1.4);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    p.x *= 1.0 / (0.85 + 0.18 * breath * uHeight);

    float ribs = 0.0;
    for (int i = 0; i < 8; i++) {
      float fy = (float(i) - 3.5) * 0.11;
      float arch = abs(p.y - fy) - 0.012;
      float span = abs(abs(p.x) - (0.18 + 0.16 * (1.0 - abs(fy) * 2.2) * (0.7 + 0.3 * breath)));
      float rib = 1.0 - smoothstep(0.0, 0.018, max(arch, span - 0.22));
      ribs += rib;
    }
    float sternum = 1.0 - smoothstep(0.0, 0.02, abs(p.x) - 0.02);
    sternum *= 1.0 - smoothstep(0.42, 0.48, abs(p.y));
    float valve = exp(-length(p - vec2(0.0, 0.02)) * 14.0) * (0.4 + 0.6 * breath);

    vec3 col = mix(uVoid, uTide, 0.3 + breath * 0.1);
    col += uIris * ribs * 0.45 * uIntensity;
    col += uVerdant * sternum * 0.25;
    col += uFrost * valve * 1.1;
    col += uFrost * exp(-abs(p.y + 0.35) * 8.0) * 0.08;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const wind = api.noise('pink');
  const lp = api.filter('lowpass', 180, 0.9);
  const g = api.gain(0.14);
  wind.connect(lp);
  lp.connect(g);
  g.connect(api.master);
  api.lfo(0.12, 0.06, g.gain);
  const pulse = api.osc('sine', 42);
  const pg = api.gain(0.05);
  pulse.connect(pg);
  pg.connect(api.master);
  api.lfo(0.12, 8, pulse.frequency);
  api.startTracked();
}
