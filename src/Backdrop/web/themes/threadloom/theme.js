export const id = 'threadloom';
export const meta = { label: 'Threadloom', blurb: 'A room that is a loom weaving its own nerves', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.1 + uSpeed * 0.9);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    float warp = 0.0;
    for (int i = 0; i < 14; i++) {
      float x = (float(i) - 6.5) * 0.07;
      float wob = 0.012 * sin(uv.y * 18.0 + t * 2.0 + float(i));
      warp += 1.0 - smoothstep(0.0, 0.007, abs(p.x - x - wob));
    }
    float weft = 0.0;
    for (int j = 0; j < 10; j++) {
      float y = (float(j) - 4.5) * 0.09;
      float shuttle = 0.4 * sin(t * 1.6 + float(j) * 0.5);
      weft += 1.0 - smoothstep(0.0, 0.006, abs(p.y - y));
      weft += exp(-length(p - vec2(shuttle, y)) * 40.0) * 2.0;
    }
    float frame = 1.0 - smoothstep(0.0, 0.02, abs(abs(p.x) - 0.52));
    frame += 1.0 - smoothstep(0.0, 0.02, abs(abs(p.y) - 0.42));
    float nerve = fbm(p * 3.5 + vec2(t * 0.15, 0.0));
    warp *= 0.55 + 0.45 * nerve;

    vec3 col = mix(uVoid, uTide, 0.2);
    col += uVerdant * warp * 0.35 * uIntensity;
    col += uIris * weft * 0.4;
    col += uFrost * frame * 0.25;
    col += uFrost * weft * 0.15 * uHeight;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(44, 66, 0.05);
  api.tide(0.05);
  api.startTracked();
}
