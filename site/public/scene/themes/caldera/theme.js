export const id = 'caldera';
export const meta = {
  label: 'Caldera',
  blurb: 'A volcanic isle — crater glow over dark water',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.07 + uSpeed * 0.45);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
    float hor = 0.34;

    vec3 sky = mix(uVoid, uIris, 0.22 + 0.35 * clamp((uv.y - hor) * 1.6, 0.0, 1.0));
    sky = mix(sky, uTide, 0.15);
    vec2 sunP = vec2(0.32, hor + 0.08);
    sky += mix(uIris, uFrost, 0.2) * exp(-length(p - sunP) * 10.0) * 0.45;

    float wave = fbm(vec2(p.x * 3.0, uv.y * 7.0 - t * 0.25));
    vec3 water = mix(uVoid, uTide, 0.45 + 0.2 * wave);
    water += uIris * pow(max(wave, 0.0), 6.0) * 0.12;

    float ix = p.x + 0.02;
    float base = exp(-ix * ix * 4.4) * (0.2 + 0.1 * uHeight);
    float crater = exp(-pow((ix) * 6.0, 2.0)) * 0.06;
    float isleH = base - crater + fbm(vec2(ix * 3.0, 0.2)) * 0.03;
    float cap = hor + isleH;
    float island = smoothstep(hor - 0.006, hor + 0.004, uv.y) * smoothstep(cap + 0.012, cap - 0.003, uv.y);
    island *= smoothstep(0.52, 0.12, abs(ix));
    float glow = exp(-length(vec2(ix, uv.y - (hor + base * 0.55))) * 14.0);
    glow *= 0.6 + 0.4 * sin(t * 3.0);
    vec3 land = mix(uTide, uVoid, 0.45);
    land = mix(land, uVerdant, 0.12);
    land = mix(land, uIris, glow * 1.3);

    float smoke = fbm(vec2(ix * 2.0, (uv.y - cap) * 4.0 - t * 0.12));
    smoke *= smoothstep(cap, cap + 0.22, uv.y) * exp(-ix * ix * 8.0) * 0.35;

    float above = smoothstep(hor - 0.008, hor + 0.008, uv.y);
    vec3 col = mix(water, sky, above);
    col = mix(col, land, island * uIntensity);
    col = mix(col, mix(uTide, uVoid, 0.4), smoke);
    col += uIris * glow * 0.25;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(32, 48, 0.05);
  api.tide(0.07);
  api.startTracked();
}
