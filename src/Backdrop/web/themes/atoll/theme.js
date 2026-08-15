export const id = 'atoll';
export const meta = {
  label: 'Atoll',
  blurb: 'Summer water, a lone island, a low sun and a thin rainbow',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.08 + uSpeed * 0.55);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float hor = 0.36 + 0.02 * uHeight;
    float above = smoothstep(hor - 0.01, hor + 0.01, uv.y);

    vec2 sunP = vec2(0.28, hor + 0.16);
    float sunD = length(p - sunP);
    float sun = exp(-sunD * 28.0);
    float haze = exp(-sunD * 4.5);

    vec3 skyHi = mix(uTide, uIris, 0.35);
    vec3 skyLo = mix(uFrost, uTide, 0.45);
    vec3 sky = mix(skyLo, skyHi, clamp((uv.y - hor) * 1.8, 0.0, 1.0));
    sky += mix(uIris, uFrost, 0.5) * haze * 0.45;
    sky += uFrost * sun * 1.4;

    float wave = fbm(vec2(p.x * 3.2, t * 0.35));
    float near = pow(clamp((hor - uv.y) / max(hor, 0.05), 0.0, 1.0), 1.15);
    vec2 wp = vec2(p.x * (2.4 + near * 6.0), uv.y * 8.0 - t * 0.4);
    float chop = fbm(wp);
    float glitter = pow(max(chop, 0.0), 8.0) * near;
    vec3 water = mix(uTide, uIris, 0.2 + 0.25 * wave);
    water = mix(water, uVoid, near * 0.12);
    water += uFrost * glitter * 0.85;
    water += uFrost * exp(-abs(p.x - sunP.x) * 8.0) * near * 0.18;

    float ix = p.x + 0.08;
    float isleH = exp(-ix * ix * 5.2) * (0.16 + 0.12 * uHeight);
    isleH += fbm(vec2(ix * 3.4, 0.4)) * 0.045;
    float cap = hor + isleH;
    float island = smoothstep(hor - 0.006, hor + 0.004, uv.y) * smoothstep(cap + 0.014, cap - 0.004, uv.y);
    island *= smoothstep(0.48, 0.1, abs(ix));
    float beach = smoothstep(0.018, 0.0, abs(uv.y - hor)) * step(abs(ix), 0.36) * island;
    vec3 land = mix(uVerdant, uTide, 0.25 + 0.4 * (uv.y));
    land = mix(land, mix(uFrost, uIris, 0.2), beach * 0.55);

    vec2 rc = vec2(p.x + 0.05, uv.y - hor - 0.18);
    float rr = length(rc);
    float arc = abs(rr - 0.42);
    float rainbow = (1.0 - smoothstep(0.0, 0.018, arc)) * smoothstep(0.0, 0.2, rc.y) * above;
    vec3 bow = mix(uVerdant, uIris, clamp(rc.x * 1.4 + 0.5, 0.0, 1.0));

    vec3 col = mix(water, sky, above);
    col = mix(col, land, island * uIntensity);
    col += bow * rainbow * 0.35;
    col += mix(uTide, uFrost, 0.4) * exp(-abs(uv.y - hor) * 40.0) * 0.12;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(38, 57, 0.05);
  api.tide(0.09);
  api.startTracked();
}
