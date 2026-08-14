export const id = 'foldwell';
export const meta = { label: 'Foldwell', blurb: 'Rooms stacked inside rooms; doorways with the wrong gravity', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  float box(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.06 + uSpeed * 0.5);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    vec3 col = mix(uVoid, uTide, 0.18);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float s = 0.42 - fi * 0.07;
      vec2 c = vec2(0.04 * sin(t + fi), 0.05 * cos(t * 0.7 + fi * 0.6));
      if (i == 2) c = vec2(c.y, -c.x);
      float wall = box(p - c, vec2(s * 1.15, s));
      float room = 1.0 - smoothstep(0.0, 0.01, wall);
      float frame = 1.0 - smoothstep(0.0, 0.012, abs(wall));
      vec2 lp = (p - c) / max(s, 0.05);
      float door = box(lp - vec2(0.0, -0.25), vec2(0.12, 0.28));
      float doorw = 1.0 - smoothstep(0.0, 0.02, door);
      float chair = box(vec2(lp.y, lp.x) - vec2(0.15, 0.2), vec2(0.06, 0.1));
      float furn = 1.0 - smoothstep(0.0, 0.02, chair);
      col = mix(col, mix(uTide, uVoid, fi * 0.12), room * 0.55);
      col += uIris * frame * 0.35 * uIntensity;
      col += uVerdant * doorw * 0.25;
      col += uFrost * furn * 0.2 * uHeight;
    }
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const hall = api.noise('brown');
  const lp = api.filter('lowpass', 140, 0.8);
  const g = api.gain(0.12);
  hall.connect(lp);
  lp.connect(g);
  g.connect(api.master);
  const tone = api.osc('sine', 73);
  const tg = api.gain(0.03);
  tone.connect(tg);
  tg.connect(api.master);
  api.startTracked();
}
