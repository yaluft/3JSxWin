export const id = 'orreryheart';
export const meta = { label: 'Orreryheart', blurb: 'Heart chambers that are planetary gears around a beating core', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.14 + uSpeed * 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float beat = 0.5 + 0.5 * sin(t * 3.2);
    float core = exp(-length(p) * (10.0 - beat * 3.0 * uHeight));

    float rings = 0.0;
    float planets = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i) + 1.0;
      float rad = 0.12 + fi * 0.09;
      float ring = 1.0 - smoothstep(0.0, 0.012, abs(length(p) - rad));
      rings += ring;
      float a = t * (0.4 / fi) + fi * 1.1;
      vec2 pos = vec2(cos(a), sin(a)) * rad;
      planets += exp(-length(p - pos) * (28.0 + fi * 4.0));
    }
    float chamber = 1.0 - smoothstep(0.38, 0.48, length(p * vec2(1.0, 1.15)));
    float septum = 1.0 - smoothstep(0.0, 0.016, abs(p.x));
    septum *= chamber;

    vec3 col = mix(uVoid, uTide, chamber * 0.35);
    col += uIris * rings * 0.55 * uIntensity;
    col += uVerdant * septum * 0.2;
    col += uFrost * planets * 1.2;
    col += mix(uIris, uFrost, beat) * core * 1.4;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(36, 54, 0.055);
  api.tide(0.05);
  api.startTracked();
}
