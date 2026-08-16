export const id = 'bayline';
export const meta = {
  label: 'Bayline',
  blurb: 'Voxel Tokyo — dense ASCII towers, Rainbow Bridge, ticking glass, neon halos',
  silent: true,
};
// kind 'ascii' routes through createAsciiBackdrop, giving a 64-glyph density ramp
// (ASCII + block elements + box-drawing via JetBrainsMonoNLNerdFont).
// The cell grid is configured in ascii.js ASCII_DEFAULTS['bayline']:
//   cellPx: 4, minCols: 140, maxCols: 720
export const kind = 'ascii';
export const paletteLabel = 'Tokyo night';
export const palette = {
  void: '#16161e',
  tide: '#1a1b26',
  verdant: '#7aa2f7',
  iris: '#f7768e',
  frost: '#c0caf5',
};

// ── G-buffer fragment shader ──────────────────────────────────────────────────
// Outputs asciiCell(col, lum) so the composite pass can map luminance onto
// the 64-glyph ramp.  Higher city density (320 cols base) than the old shader
// pass gives roughly 2-3× more glyph variety across the skyline.
export const fragment = /* glsl */ `
  float winOn(vec2 id, float t) {
    float n  = hash21(id);
    float n2 = hash21(id + vec2(3.7, 9.1));
    // Multi-rate blink: slow civic cycle + fast flicker for a busy office look.
    float slow  = step(0.50, n)  * step(0.08, 0.5 + 0.5 * sin(t * (1.2 + n  * 3.2) + n  * 14.0));
    float fast  = step(0.82, n2) * step(0.20, 0.5 + 0.5 * sin(t * (5.5 + n2 * 8.0) + n2 * 27.0));
    return max(slow, fast);
  }

  // Returns the luminance contribution for a single building layer.
  // diff  = diffuse lighting term from face normal vs. key light
  // spec  = specular term
  // emissive = window / neon glow
  // Returns a packed asciiCell vec4.
  vec4 buildingCell(vec3 faceCol, float diff, float spec, float emissive) {
    float lum = clamp(diff * 0.82 + spec * 0.45 + emissive * 0.9 + 0.08, 0.0, 1.0);
    vec3  col = mix(faceCol, uVerdant, clamp(emissive * 0.7, 0.0, 1.0));
    col       = mix(col,     uIris,   clamp(spec    * 0.5,  0.0, 1.0));
    col       = mix(col,     uFrost,  clamp(spec    * 0.9,  0.0, 1.0));
    return asciiCell(col, lum);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float t = uTime * (0.10 + uSpeed * 0.95);

    // Coarser cell resolution is now handled by the ASCII composite grid;
    // here we work at full G-buffer resolution.
    float cols   = 320.0 + floor(uHeight * 120.0);
    float rows   = cols * 0.56;
    vec2  cell   = floor(vec2(uv.x * cols, uv.y * rows));
    vec2  su     = (cell + 0.5) / vec2(cols, rows);
    vec2  q      = vec2((su.x - 0.5) * aspect, su.y);

    float hor = 0.30;

    // ── Sky background ─────────────────────────────────────────────────────
    float skyLum = 0.12 + su.y * 0.18;
    vec3  skyCol = mix(uVoid, uTide, 0.18 + su.y * 0.30);
    // Stars.
    skyCol += uFrost * step(0.997, hash21(cell)) * (0.25 + 0.5 * uTwinkle) * step(hor + 0.18, su.y);
    // Moon.
    float moon    = step(length(q - vec2(0.34, 0.80)), 0.025);
    float moonCut = step(length(q - vec2(0.352, 0.81)), 0.014);
    skyCol = mix(skyCol, uFrost * 0.72, moon * (1.0 - moonCut));

    // ── Building layers (back → front) ─────────────────────────────────────
    // Eight depth layers (zi 7→0), each with its own column density and shear.
    bool  hit    = false;
    vec4  result = vec4(0.0);

    for (int zi = 7; zi >= 0; zi--) {
      float z      = float(zi);
      float shear  = z * 0.019;
      float lx     = su.x - shear * 0.88;
      float ly     = su.y - shear * 0.38;
      float density = 70.0 + z * 6.0;   // more cols per layer → finer glyph detail
      float gid    = floor(lx * density);
      float fx     = fract(lx * density);

      // Gap for the Rainbow Bridge span (z ≤ 2).
      float bayGap = step(0.400, lx) * (1.0 - step(0.600, lx)) * step(z, 2.1);
      if (bayGap > 0.5) continue;

      float n  = hash21(vec2(gid, z + 3.1));
      float n2 = hash21(vec2(gid, z + 9.4));
      float n3 = hash21(vec2(gid, z + 21.7));

      // Building height: base + skyscraper bonus + penthouse bonus.
      float hgt = 0.09 + 0.20 * n + 0.16 * n2 * step(0.55, n);
      hgt += 0.14 * step(0.88, n2) * step(z, 4.5);   // tall towers only in mid-ground
      hgt += 0.06 * step(0.94, n3) * step(z, 2.5);   // antenna spires
      hgt *= 0.70 + 0.30 * (1.0 - z / 7.0);

      float base  = hor + z * 0.010;
      float top   = base + hgt;
      float sideW = 0.28 - z * 0.018;

      float inFront = step(0.0, fx) * (1.0 - step(1.0 - sideW, fx));
      float inSide  = step(1.0 - sideW, fx) * (1.0 - step(1.0, fx));
      float inY     = step(base, ly) * (1.0 - step(top, ly));
      float inRoof  = step(top, ly)
                    * (1.0 - step(top + shear * 0.50 + 0.007, ly))
                    * step(fx, 1.0 - (ly - top) * 9.0);

      float body = (inFront + inSide) * inY;
      if (body + inRoof < 0.5) continue;

      hit = true;

      // Face / side normals → simple diffuse + spec.
      vec3 nFront = vec3(0.0,  0.0, 1.0);
      vec3 nSide  = vec3(1.0,  0.0, 0.0);
      vec3 nRoof  = vec3(0.0,  1.0, 0.0);
      vec3 light  = normalize(vec3(0.55, 0.65, 0.75));
      float dF    = clamp(dot(nFront, light), 0.0, 1.0);
      float dS    = clamp(dot(nSide,  light) * 0.55, 0.0, 1.0);
      float dR    = clamp(dot(nRoof,  light) * 0.80, 0.0, 1.0);
      float spec  = pow(clamp(dF, 0.0, 1.0), 28.0) * step(0.92, n2) * 0.6;

      // Windows.
      // Fine-grained window grid: more cols → more glyph variety per building.
      vec2  win   = floor(vec2((lx * density + z) * 3.2, (ly - base) * 60.0));
      float pane  = step(0.28, fract(lx * density * 3.2))
                  * step(0.22, fract((ly - base) * 60.0));
      float glass = inFront * pane * winOn(win + vec2(z * 5.3, gid * 1.1), t);

      // Neon sign stripe on front face.
      float neon  = inFront * step(0.88, hash21(vec2(gid, z + 14.0)))
                  * step(0.012, 0.024 - abs((ly - base) - (0.06 + 0.12 * n2)));

      // Antenna light (top of tall spires).
      float spireTop = step(0.94, n3) * step(z, 2.5)
                     * (1.0 - step(0.004, abs(ly - (top - 0.005))));

      // Per-pixel emissive.
      float emissive = glass * uIntensity + neon * 0.9 + spireTop * 0.5;

      // Face colour.
      vec3  wallF  = mix(uTide, uVoid, 0.22 + 0.08 * n);
      vec3  wallS  = mix(uVoid, uTide, 0.10);
      vec3  roofC  = mix(uTide, uFrost, 0.14 + 0.06 * n2);
      vec3  faceC  = inFront * wallF + inSide * wallS;
      faceC        = mix(faceC, uIris * 0.55, neon);

      float diff   = inFront * dF + inSide * dS;
      float lumR   = inRoof > 0.5 ? clamp(dR + 0.1, 0.0, 1.0) : 0.0;

      if (inRoof > 0.5) {
        result = asciiCell(roofC, lumR);
      } else {
        result = buildingCell(faceC, diff, spec, emissive);
      }
    }

    // ── Rainbow Bridge structure ────────────────────────────────────────────
    float onSpan   = step(0.394, su.x) * (1.0 - step(0.606, su.x));
    float deckY    = hor + 0.065;
    float towerH   = 0.245;
    float tL       = abs(su.x - 0.430);
    float tR       = abs(su.x - 0.570);

    // Pylons.
    float twFront  = (1.0 - step(0.009, min(tL, tR)))
                   * step(hor, su.y) * (1.0 - step(hor + towerH, su.y));
    float cap      = (1.0 - step(0.016, min(tL, tR)))
                   * (1.0 - step(0.008, abs(su.y - (hor + towerH))));

    // Suspension cables and hangers.
    float nx    = (su.x - 0.5) / 0.07;
    float sag   = hor + towerH - 0.145 * nx * nx;
    float cable = onSpan * (1.0 - step(0.006, abs(su.y - sag))) * step(abs(nx), 1.08);
    float hang  = onSpan * step(deckY, su.y) * (1.0 - step(sag, su.y))
                * (1.0 - step(0.004, abs(fract(su.x * 40.0) - 0.5)));

    // Deck and rail.
    float deck    = onSpan * (1.0 - step(0.009, abs(su.y - deckY)));
    float deckSide= onSpan * (1.0 - step(0.007, abs(su.y - (deckY - 0.011))));
    float rail    = onSpan * (1.0 - step(0.005, abs(su.y - (deckY + 0.014))));

    // Animated elements.
    float chase   = deck * step(0.38, sin(su.x * 150.0 - t * 14.0));
    float twBlink = twFront * step(hor + 0.20, su.y) * step(0.0, sin(t * 6.5 + su.x * 55.0));
    float car     = onSpan * (1.0 - step(0.005, abs(su.y - (deckY + 0.007))))
                  * step(0.88, fract(su.x * 9.0 - t * 0.60));

    // Accumulate bridge into result.
    float bridgeMask = max(max(twFront, cap), max(cable, max(hang, max(deck, rail))));
    if (bridgeMask > 0.0 && !hit) hit = true;

    if (twFront + cap > 0.0) {
      float tw_lum = 0.45 + twBlink * 0.35;
      result = asciiCell(mix(uTide, uFrost, 0.25 + twBlink * 0.15), tw_lum);
    } else if (cable > 0.0) {
      result = asciiCell(uFrost * 0.55, 0.35 + chase * 0.3);
    } else if (hang > 0.0) {
      result = asciiCell(mix(uTide, uFrost, 0.28), 0.22);
    } else if (deck > 0.0) {
      float dLum = 0.38 + chase * 0.4;
      vec3  dCol = mix(uFrost, uIris, chase);
      result = asciiCell(dCol, dLum);
      result = mix(result, asciiCell(mix(uIris, uVerdant, step(0.5, fract(t * 0.7))), 0.85), car);
    } else if (deckSide > 0.0) {
      result = asciiCell(mix(uVoid, uTide, 0.45), 0.18);
    } else if (rail > 0.0) {
      result = asciiCell(uFrost * 0.4, 0.2);
    }

    // ── Water reflection ───────────────────────────────────────────────────
    bool inWater = su.y < hor;
    if (inWater) {
      float ry    = 2.0 * hor - su.y;
      vec2  rcell = floor(vec2(su.x * cols, ry * rows));
      float rip   = hash21(rcell + floor(t * 2.5));
      vec3  wcol  = mix(uVoid, uTide, 0.38 + 0.14 * rip);
      float rglass = 0.0;
      for (int zi = 3; zi >= 0; zi--) {
        float z    = float(zi);
        float lx   = su.x - z * 0.015;
        float ly   = ry   - z * 0.013;
        float dens = 72.0;
        float gid  = floor(lx * dens);
        float n    = hash21(vec2(gid, z + 3.1));
        float hgt  = 0.11 + 0.26 * n;
        float base = hor + z * 0.009;
        float inY  = step(base, ly) * (1.0 - step(base + hgt, ly));
        float bay  = step(0.400, lx) * (1.0 - step(0.600, lx));
        vec2  win  = floor(vec2(lx * 100.0, (ly - base) * 44.0));
        rglass     = max(rglass, (1.0 - bay) * inY * winOn(win, t) * 0.42);
      }
      wcol  = mix(wcol, uVerdant * 0.38, rglass);
      wcol += uIris * onSpan * (1.0 - step(0.010, abs(su.y - (2.0 * hor - deckY)))) * 0.20;
      float wlum = 0.08 + rglass * 0.5 + 0.06 * rip;
      gl_FragColor = asciiCell(wcol, wlum);
      return;
    }

    // Horizon line.
    float hline = (1.0 - step(0.005, abs(su.y - hor))) * 0.35;

    if (!hit) {
      // Sky pixel.
      gl_FragColor = asciiCell(skyCol, skyLum + hline);
    } else {
      // Blend horizon shimmer onto topmost building hit.
      result.a = clamp(result.a + hline, 0.0, 1.0);
      gl_FragColor = result;
    }
  }
`;

export function buildAudio(api) {
  api.bed(49, 73.4, 0.05);
  api.tide(0.045);
  api.startTracked();
}

