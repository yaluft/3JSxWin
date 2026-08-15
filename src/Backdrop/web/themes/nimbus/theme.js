export const id = 'nimbus';
export const meta = {
  label: 'Nimbus',
  blurb: 'A world lost in slow cloud belts',
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
    float t = uTime * (0.06 + uSpeed * 0.4);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    vec3 col = mix(uVoid, uTide, 0.14 + 0.1 * uv.y);
    vec3 ro = vec3(0.0, 0.08, 2.45);
    vec3 rd = normalize(vec3(p, -1.5));
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - 1.05 * 1.05);
    if (h > 0.0) {
      float hit = -b - sqrt(max(h, 0.0));
      if (hit > 0.0) {
        vec3 n = normalize(ro + rd * hit);
        vec3 nr = n;
        nr.xz = rot2(nr.xz, t * 0.18);
        float belts = fbm(vec2(nr.x * 1.4 + t * 0.05, nr.y * 3.6));
        float swirl = fbm(nr.xz * 2.8 + vec2(t * 0.07, nr.y));
        vec3 deep = mix(uTide, uVoid, 0.35);
        vec3 cloud = mix(uFrost, uIris, 0.25);
        vec3 surf = mix(deep, cloud, smoothstep(0.38, 0.72, belts));
        surf = mix(surf, uVerdant, swirl * 0.12);
        float diff = pow(clamp(dot(n, normalize(vec3(0.3, 0.55, 0.7))), 0.0, 1.0), 0.75);
        float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.2);
        col = surf * (0.22 + 0.78 * diff) * uIntensity;
        col += mix(uIris, uFrost, 0.6) * rim * 0.7 * uHeight;
      }
    }
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(34, 51, 0.05);
  api.tide(0.07);
  api.startTracked();
}
