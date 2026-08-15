export const id = 'orbis';
export const meta = {
  label: 'Orbis',
  blurb: 'A displaced world turning in vacuum — sky-to-ground scale, no mesh',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  float height(vec3 n) {
    vec2 q = n.xz * 2.4 + n.y * 0.7;
    return fbm(q) * 0.72 + fbm(q * 2.3 + 1.7) * 0.28;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.06 + uSpeed * 0.45);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    vec3 ro = vec3(0.0, 0.12, 2.55);
    vec3 rd = normalize(vec3(p, -1.55));
    float rad = 1.0;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rad * rad;
    float h = b * b - c;

    vec3 col = mix(uVoid, uTide, 0.12 + 0.08 * uv.y);
    vec2 star = floor(p * 90.0);
    float sn = hash21(star);
    col += uFrost * step(0.992, sn) * (0.35 + 0.65 * uTwinkle);

    if (h > 0.0) {
      float hit = -b - sqrt(h);
      if (hit > 0.0) {
        vec3 pos = ro + rd * hit;
        vec3 n = normalize(pos);
        vec3 nr = n;
        nr.xz = rot2(nr.xz, t * 0.35);
        nr.xy = rot2(nr.xy, 0.18);

        float hg = height(nr);
        float shore = 0.46 + 0.04 * uHeight;
        float land = smoothstep(shore - 0.03, shore + 0.04, hg);
        float ice = smoothstep(0.72, 0.88, abs(nr.y));
        float cloud = fbm(nr.xz * 3.2 + vec2(t * 0.08, 0.0));
        cloud = smoothstep(0.52, 0.78, cloud);

        vec3 ocean = mix(uTide, uIris, 0.25 + 0.2 * hg);
        vec3 ground = mix(uVerdant, uTide, 0.35 * (1.0 - hg));
        vec3 surf = mix(ocean, ground, land);
        surf = mix(surf, uFrost, ice * 0.85);

        vec3 sunDir = normalize(vec3(0.45, 0.35, 0.75));
        float diff = pow(clamp(dot(n, sunDir), 0.0, 1.0), 0.85);
        float spec = pow(clamp(dot(reflect(-sunDir, n), -rd), 0.0, 1.0), 28.0);
        spec *= (1.0 - land) * 0.65;
        float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.6);

        col = surf * (0.18 + 0.82 * diff) * uIntensity;
        col += uFrost * spec;
        col = mix(col, uFrost, cloud * 0.28 * (1.0 - ice));
        col += mix(uIris, uFrost, 0.4) * fres * 0.55;
      }
    }

    float limb = exp(-abs(length(p) - 0.39) * 18.0);
    col += mix(uIris, uFrost, 0.5) * limb * 0.22 * uHorizonGlow;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(33, 49, 0.055);
  api.tide(0.06);
  api.startTracked();
}
