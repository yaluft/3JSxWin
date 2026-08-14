export const id = 'inkatrium';
export const meta = { label: 'Inkatrium', blurb: 'A city folded into a hanging droplet; streets follow the meniscus', silent: true };
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.08 + uSpeed * 0.6);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.38);
    float drop = length(p * vec2(1.0, 1.15)) - 0.34;
    float inside = smoothstep(0.01, -0.01, drop);
    vec2 q = p / max(0.34 - length(p) * 0.35, 0.08);
    q.y += 0.08;
    q *= 1.0 + 0.08 * sin(t);

    float streets = abs(sin(q.x * 18.0)) * abs(sin(q.y * 14.0 - t * 0.2));
    float windows = step(0.82, hash21(floor(q * vec2(22.0, 16.0))));
    float rim = pow(1.0 - smoothstep(-0.02, 0.02, drop), 3.0);
    float hang = 1.0 - smoothstep(0.0, 0.012, abs(p.x) - 0.008);
    hang *= smoothstep(0.0, 0.2, -p.y + 0.05) * step(p.y, 0.48);

    vec3 col = mix(uVoid, uTide, 0.22 + uv.y * 0.1);
    col = mix(col, mix(uTide, uVoid, 0.4), inside);
    col += uIris * windows * inside * 0.55 * uIntensity;
    col += uVerdant * (1.0 - streets) * inside * 0.08;
    col += uFrost * rim * 0.7;
    col += uFrost * hang * 0.35;
    col += uFrost * windows * inside * 0.15 * uHeight;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(41, 62, 0.05);
  api.tide(0.06);
  api.startTracked();
}
