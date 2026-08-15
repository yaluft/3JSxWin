export const id = 'bayline';
export const meta = {
  label: 'Bayline',
  blurb: 'Voxel Tokyo — dense 3D pixel towers, Rainbow Bridge, ticking glass',
  silent: true,
};
export const kind = 'shader';
export const paletteLabel = 'Tokyo night';
export const palette = {
  void: '#16161e',
  tide: '#1a1b26',
  verdant: '#7aa2f7',
  iris: '#f7768e',
  frost: '#c0caf5',
};

export const fragment = /* glsl */ `
  float winOn(vec2 id, float t) {
    float n = hash21(id);
    float blink = 0.5 + 0.5 * sin(t * (1.6 + n * 4.0) + n * 14.0);
    return step(0.52, n) * step(0.12, blink);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.12 + uSpeed * 1.15);

    float cols = 220.0 + floor(uHeight * 90.0);
    float rows = cols * 0.64;
    vec2 cell = floor(vec2(uv.x * cols, uv.y * rows));
    vec2 su = (cell + 0.5) / vec2(cols, rows);
    vec2 q = vec2((su.x - 0.5) * aspect, su.y);

    float hor = 0.31;
    vec3 col = mix(uVoid, uTide, 0.18 + su.y * 0.28);
    col += uFrost * step(0.996, hash21(cell)) * (0.3 + 0.5 * uTwinkle) * step(hor + 0.18, su.y);

    float moon = step(length(q - vec2(0.36, 0.78)), 0.028);
    float moonCut = step(length(q - vec2(0.372, 0.79)), 0.016);
    col = mix(col, uFrost * 0.75, moon * (1.0 - moonCut));

    float hit = 0.0;
    float face = 0.0;
    float glass = 0.0;
    float neon = 0.0;
    float roof = 0.0;
    float gidOut = 0.0;

    for (int zi = 6; zi >= 0; zi--) {
      float z = float(zi);
      float shear = z * 0.022;
      float lx = su.x - shear * 0.92;
      float ly = su.y - shear * 0.42;
      float density = 62.0 + z * 4.0;
      float gid = floor(lx * density);
      float fx = fract(lx * density);
      float bay = step(0.405, lx) * (1.0 - step(0.595, lx)) * step(z, 2.1);
      if (bay > 0.5) continue;

      float n = hash21(vec2(gid, z + 3.1));
      float n2 = hash21(vec2(gid, z + 9.4));
      float hgt = 0.10 + 0.22 * n + 0.18 * n2 * step(0.55, n);
      hgt += 0.16 * step(0.88, n2) * step(z, 3.5);
      hgt *= 0.72 + 0.28 * (1.0 - z / 6.0);

      float base = hor + z * 0.012;
      float top = base + hgt;
      float sideW = 0.30 - z * 0.02;
      float inFront = step(0.0, fx) * (1.0 - step(1.0 - sideW, fx));
      float inSide = step(1.0 - sideW, fx) * (1.0 - step(1.0, fx));
      float inY = step(base, ly) * (1.0 - step(top, ly));
      float inRoof = step(top, ly) * (1.0 - step(top + shear * 0.55 + 0.008, ly))
                   * step(fx, 1.0 - (ly - top) * 8.0);

      float body = (inFront + inSide) * inY;
      if (body + inRoof < 0.5) continue;

      hit = 1.0;
      gidOut = gid + z * 17.0;
      face = inFront;
      roof = inRoof;

      vec2 win = floor(vec2((lx * density + z) * 2.4, (ly - base) * 46.0));
      float pane = step(0.32, fract(lx * density * 2.4)) * step(0.28, fract((ly - base) * 46.0));
      glass = inFront * pane * winOn(win + vec2(z * 5.0, gid), t);
      neon = inFront * step(0.90, hash21(vec2(gid, z + 14.0)))
           * step(0.016, 0.028 - abs((ly - base) - (0.07 + 0.14 * n2)));
    }

    vec3 wallF = mix(uTide, uVoid, 0.25);
    vec3 wallS = mix(uVoid, uTide, 0.12);
    vec3 roofC = mix(uTide, uFrost, 0.18);
    col = mix(col, mix(wallS, wallF, face), hit * (1.0 - roof));
    col = mix(col, roofC, roof);
    col = mix(col, uVerdant, glass * uIntensity);
    col = mix(col, mix(uIris, uVerdant, hash21(vec2(gidOut, 1.2))), neon);

    float spike = (1.0 - step(0.007, abs(su.x - 0.17))) * step(hor, su.y) * (1.0 - step(hor + 0.52, su.y));
    float spikeSide = (1.0 - step(0.012, abs(su.x - 0.178))) * step(hor + 0.35, su.y) * (1.0 - step(hor + 0.50, su.y));
    col = mix(col, mix(uTide, uFrost, 0.2), max(spike, spikeSide * 0.65));
    col += uIris * spike * step(hor + 0.50, su.y) * step(0.0, sin(t * 6.0));

    float tL = abs(su.x - 0.43);
    float tR = abs(su.x - 0.57);
    float towerH = 0.26;
    float twFront = (1.0 - step(0.010, min(tL, tR))) * step(hor, su.y) * (1.0 - step(hor + towerH, su.y));
    float twSide = (1.0 - step(0.016, min(abs(su.x - 0.438), abs(su.x - 0.578))))
                 * step(hor, su.y) * (1.0 - step(hor + towerH - 0.01, su.y));
    float cap = (1.0 - step(0.018, min(tL, tR))) * (1.0 - step(0.010, abs(su.y - (hor + towerH))));
    col = mix(col, mix(uTide, uFrost, 0.28), max(twFront, cap));
    col = mix(col, uVoid * 1.4 + uTide * 0.4, twSide * (1.0 - twFront));

    float deckY = hor + 0.07;
    float onSpan = step(0.392, su.x) * (1.0 - step(0.608, su.x));
    float deck = onSpan * (1.0 - step(0.010, abs(su.y - deckY)));
    float deckSide = onSpan * (1.0 - step(0.008, abs(su.y - (deckY - 0.012))));
    float rail = onSpan * (1.0 - step(0.006, abs(su.y - (deckY + 0.016))));
    float nx = (su.x - 0.5) / 0.07;
    float sag = hor + towerH - 0.155 * nx * nx;
    float cable = onSpan * (1.0 - step(0.007, abs(su.y - sag))) * step(abs(nx), 1.08);
    float hang = onSpan * step(deckY, su.y) * (1.0 - step(sag, su.y))
               * (1.0 - step(0.0045, abs(fract(su.x * 36.0) - 0.5)));
    float chase = deck * step(0.35, sin(su.x * 140.0 - t * 12.0));
    float twBlink = twFront * step(hor + 0.22, su.y) * step(0.0, sin(t * 6.2 + su.x * 50.0));
    float car = onSpan * (1.0 - step(0.006, abs(su.y - (deckY + 0.008))))
              * step(0.86, fract(su.x * 8.0 - t * 0.55));

    col = mix(col, mix(uFrost, uTide, 0.35), deck);
    col = mix(col, uVoid + uTide * 0.5, deckSide);
    col = mix(col, uFrost * 0.45, rail);
    col += uFrost * cable * 0.7;
    col += uTide * hang * 0.55;
    col += uIris * chase * 1.15;
    col += uFrost * twBlink;
    col += mix(uIris, uVerdant, step(0.5, fract(t * 0.7))) * car;

    float water = 1.0 - step(hor, su.y);
    if (water > 0.5) {
      float ry = 2.0 * hor - su.y;
      vec2 rcell = floor(vec2(su.x * cols, ry * rows));
      float ripple = hash21(rcell + floor(t * 2.0));
      vec3 wcol = mix(uVoid, uTide, 0.42 + 0.12 * ripple);
      float rglass = 0.0;
      for (int zi = 3; zi >= 0; zi--) {
        float z = float(zi);
        float lx = su.x - z * 0.018;
        float ly = ry - z * 0.016;
        float density = 62.0;
        float gid = floor(lx * density);
        float n = hash21(vec2(gid, z + 3.1));
        float hgt = 0.12 + 0.28 * n;
        float base = hor + z * 0.01;
        float inY = step(base, ly) * (1.0 - step(base + hgt, ly));
        float bay = step(0.405, lx) * (1.0 - step(0.595, lx));
        vec2 win = floor(vec2(lx * 90.0, (ly - base) * 40.0));
        rglass = max(rglass, (1.0 - bay) * inY * winOn(win, t) * 0.45);
      }
      wcol = mix(wcol, uVerdant * 0.4, rglass);
      wcol += uIris * onSpan * (1.0 - step(0.012, abs(su.y - (2.0 * hor - deckY)))) * 0.22;
      col = mix(col, wcol, 0.94);
    }

    col += mix(uTide, uFrost, 0.35) * (1.0 - step(0.006, abs(su.y - hor))) * 0.4;
    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  api.bed(49, 73.4, 0.05);
  api.tide(0.045);
  api.startTracked();
}
