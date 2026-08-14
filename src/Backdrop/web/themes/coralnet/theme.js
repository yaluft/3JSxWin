export const id = 'coralnet';
export const meta = { label: 'Coralnet', blurb: 'Coral branches as PCB traces; data blooms at the tips', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  float coral(vec2 p, float t) {
    float d = 1.0;
    vec2 q = p;
    for (int i = 0; i < 6; i++) {
      q = abs(q) * 1.18 - vec2(0.18, 0.08);
      float a = 0.7 + 0.12 * sin(t * 0.3 + float(i));
      q = vec2(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a));
      d = min(d, length(q) - 0.035);
    }
    return d;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.1 + uSpeed * 0.9);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.42);
    p *= 1.5;

    float d = coral(p, t);
    float line = pow(1.0 - smoothstep(0.0, 0.05, abs(d)), 2.4) * uIntensity;
    float tip = exp(-abs(d) * 40.0) * (0.5 + 0.5 * sin(t * 4.0 + p.x * 8.0));
    float water = fbm(p * 1.8 + vec2(t * 0.08, 0.0));

    vec3 col = mix(uVoid, uTide, 0.4 + water * 0.25);
    col += uVerdant * line * 0.75;
    col += uIris * tip * 0.9;
    col += uFrost * tip * 0.45 * uHeight;
    col += mix(uTide, uFrost, 0.3) * pow(abs(sin(p.y * 12.0 + t)), 8.0) * 0.04 * uv.y;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(36, 55, 0.05);
  api.tide(0.08);
  api.startTracked();
}
