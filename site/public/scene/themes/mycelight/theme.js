export const id = 'mycelight';
export const meta = { label: 'Mycelight', blurb: 'Hyphae as circuit traces; frost-light packets hop node to node', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  float branch(vec2 p, float t) {
    float a = atan(p.y, p.x);
    float r = length(p);
    float veins = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float ang = a + fi * 1.2566 + 0.15 * sin(t * 0.4 + fi);
      float w = abs(sin(ang * (3.0 + fi) + r * 6.0 - t * 0.2));
      float rib = pow(1.0 - w, 18.0) * exp(-r * (0.6 + fi * 0.15));
      veins += rib;
    }
    return veins;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.12 + uSpeed * 1.1);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.55);
    p *= 1.35;

    float soil = fbm(p * 2.4 + vec2(0.0, t * 0.04));
    float hypha = branch(p, t) + branch(p * 1.7 + 0.4, t * 0.8) * 0.55;
    hypha *= uIntensity;

    vec2 g = p * 9.0;
    vec2 idn = floor(g);
    float n = hash21(idn);
    float hop = fract(t * (0.7 + n) + n);
    vec2 q = fract(g) - 0.5;
    q.x += (hop - 0.5) * 0.9;
    float packet = smoothstep(0.16, 0.0, length(q)) * step(0.72, n) * hypha;

    vec3 col = mix(uVoid, uTide, soil * 0.35);
    col += uVerdant * hypha * 0.55;
    col += uIris * hypha * soil * 0.25;
    col += uFrost * packet * 1.6;
    col += uFrost * exp(-length(p) * 3.2) * 0.08 * uHorizonGlow;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(38, 57, 0.05);
  api.tide(0.05);
  api.startTracked();
}
