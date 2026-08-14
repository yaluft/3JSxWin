export const id = 'shoal';
export const meta = {
  label: 'Shoal',
  blurb: 'Tropical shallows and sandbars under a hard noon sun',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.07 + uSpeed * 0.5);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float hor = 0.42;

    vec3 sky = mix(mix(uFrost, uTide, 0.35), mix(uIris, uTide, 0.2), clamp((uv.y - hor) * 2.2, 0.0, 1.0));
    vec2 sunP = vec2(-0.22, hor + 0.22);
    float sd = length(p - sunP);
    sky += uFrost * exp(-sd * 22.0) * 1.2;
    sky += mix(uIris, uFrost, 0.4) * exp(-sd * 4.0) * 0.35;

    float depth = fbm(vec2(p.x * 2.2, uv.y * 3.0 + t * 0.08));
    float bars = smoothstep(0.42, 0.62, fbm(vec2(p.x * 1.6 + 0.3, uv.y * 1.1)));
    vec3 deep = mix(uTide, uIris, 0.4);
    vec3 sand = mix(uFrost, uVerdant, 0.15);
    vec3 water = mix(deep, sand, bars * (1.0 - uv.y * 0.5));
    water = mix(water, deep, depth * 0.25);
    float chop = pow(max(fbm(vec2(p.x * 7.0, uv.y * 10.0 - t * 0.5)), 0.0), 7.0);
    water += uFrost * chop * 0.35 * (1.0 - uv.y);

    float above = smoothstep(hor - 0.008, hor + 0.008, uv.y);
    vec3 col = mix(water, sky, above) * uIntensity;
    col += mix(uTide, uFrost, 0.5) * exp(-abs(uv.y - hor) * 50.0) * 0.14;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(40, 60, 0.045);
  api.tide(0.1);
  api.startTracked();
}
