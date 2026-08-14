export const id = 'ringfall';
export const meta = {
  label: 'Ringfall',
  blurb: 'A ringed world — thin ice band, shadow on the globe',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.05 + uSpeed * 0.4);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.48);

    vec3 col = mix(uVoid, uTide, 0.1);
    col += uFrost * step(0.993, hash21(floor(p * 88.0))) * 0.45;

    vec3 ro = vec3(0.0, 0.18, 2.7);
    vec3 rd = normalize(vec3(p, -1.6));
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - 1.0);
    if (h > 0.0) {
      float hit = -b - sqrt(h);
      if (hit > 0.0) {
        vec3 n = normalize(ro + rd * hit);
        vec3 nr = n;
        nr.xz = rot2(nr.xz, t * 0.28);
        float bands = 0.5 + 0.5 * sin(nr.y * 9.0 + fbm(nr.xz * 2.4) * 2.0);
        vec3 surf = mix(uTide, uIris, bands * 0.55);
        surf = mix(surf, uVerdant, smoothstep(0.35, 0.7, fbm(nr.xz * 3.0)) * 0.35);
        float diff = pow(clamp(dot(n, normalize(vec3(0.5, 0.4, 0.7))), 0.0, 1.0), 0.8);
        float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.8);
        col = surf * (0.2 + 0.8 * diff) * uIntensity;
        col += mix(uIris, uFrost, 0.4) * fres * 0.5;
      }
    }

    vec2 rp = p * vec2(1.0, 3.4);
    rp.y += 0.04;
    float ringR = length(rp);
    float ring = (1.0 - smoothstep(0.0, 0.018, abs(ringR - 0.62)))
               * smoothstep(0.22, 0.32, ringR);
    ring *= (1.0 - smoothstep(0.0, 0.22, abs(p.y + 0.02)));
    float gap = 1.0 - smoothstep(0.0, 0.01, abs(ringR - 0.58));
    ring *= 1.0 - gap * 0.85;
    col += mix(uFrost, uIris, 0.35) * ring * (0.55 + 0.2 * uHeight);

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(31, 47, 0.055);
  api.tide(0.055);
  api.startTracked();
}
