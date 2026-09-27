// theme.js (orionhall) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of a nightscape photograph
// (assets/images/R3Orion_Hall_2870.jpg, by Chester Hall-Fernandez): snow-streaked
// mountain ridges filling the lower third, and above them the whole Orion region -
// the great crimson arc of Barnard's Loop sweeping over the top of the frame, the
// Orion Nebula burning pink-white at centre, the Flame/Horsehead pocket to its
// right, Orion's Belt, a brilliant blue-white Sirius low left, a comet drawn as a
// long tapering streak upper left, and a very dense field of fine stars throughout.
//
// Added motion beyond the still reference, per request:
//   - shooting stars: occasional fast streaks with a bright head and fading tail
//   - meteors:        smaller, more frequent, more randomly angled
//   - dying stars:    tiny far-off supernova flashes that bloom and fade
//
// Nothing from the JPEG is loaded at runtime - the image was a visual reference
// and every structure below is procedural. See CREDITS.md.

export const id = 'orionhall';

export const meta = {
  label: 'Orion Hall',
  blurb: 'Snow ridges under Orion - a crimson loop, the nebula burning, comets, meteors and distant dying stars',
  silent: true,
};

export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  // ---------------------------------------------------------------------------
  // SKY
  // ---------------------------------------------------------------------------

  // starField: the dense fine star population. Two populations by size, with a
  // few allowed to be much brighter so the field has hierarchy rather than
  // reading as uniform noise.
  vec3 starField(vec2 p, float t, float seed, float density, float life) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec3 acc = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 5.17));
        if (present <= 0.0) continue;
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 7.1);
        mag *= mag * mag;                       // cubed: mostly faint, a few bright
        float d = length(f - pos);
        float size = 0.006 + mag * 0.030;
        // Twinkle rate varies per star so they don't pulse in lockstep.
        float rate = 1.2 + hash21(cell + seed * 2.3) * 3.0;
        float tw = 0.70 + 0.30 * sin(t * rate + mag * 41.0) * life;
        vec3 tint = mix(vec3(0.78, 0.84, 1.00), vec3(1.00, 0.92, 0.80),
                        hash21(cell + seed * 3.3));
        acc += tint * exp(-d * d / (size * size)) * (0.35 + mag * 2.2) * tw;
      }
    }
    return acc;
  }

  // barnardLoop: the great crimson arc over the top of the frame. A thick
  // annulus, windowed in angle to the upper portion, with a very noisy radius so
  // it reads as ragged emission rather than a drawn ring.
  float barnardLoop(vec2 p, float t, float life) {
    vec2 c = vec2(0.02, 0.30);                 // arc centre, above frame middle
    vec2 q = (p - c) * vec2(1.0, 1.35);        // squash vertically
    float r = length(q);
    float ang = atan(q.y, q.x);
    // Ragged radius: two noise octaves around the ring.
    float n1 = vnoise(vec2(ang * 2.2, t * 0.05 * life)) - 0.5;
    float n2 = vnoise(vec2(ang * 6.1 + 3.3, t * 0.08 * life)) - 0.5;
    float rad = 0.52 + n1 * 0.075 + n2 * 0.035;
    float band = exp(-(r - rad) * (r - rad) / 0.0075);
    // Only the upper arc: fade out below the horizon-ish line.
    float win = smoothstep(-0.35, 0.15, q.y);
    // Break the arc up so it is not continuous.
    float breakup = 0.45 + 0.55 * vnoise(vec2(ang * 3.4, t * 0.04 * life));
    return band * win * breakup;
  }

  // nebulaMass: a soft emission cloud - used for the Orion Nebula core and the
  // Flame/Horsehead pocket. Domain-warped fbm inside an elliptical window.
  float nebulaMass(vec2 p, vec2 c, vec2 rad, float t, float seed, float life) {
    vec2 q = (p - c) / rad;
    vec2 w = vec2(vnoise(q * 1.8 + vec2(seed + t * 0.10 * life, 0.0)),
                  vnoise(q * 1.8 + vec2(seed + 3.7, -t * 0.08 * life)));
    float g = fbm(q * 2.2 + (w - 0.5) * 1.3);
    float lo = 0.42 - 0.08 * sin(t * 0.5 + seed) * life;
    g = smoothstep(lo, lo + 0.40, g);
    return g * exp(-dot(q, q));
  }

  // brightStar: a hero star with a soft bloom and a subtle 4-point flare, for
  // Sirius and the Belt stars.
  vec3 brightStar(vec2 p, vec2 pos, float scale, vec3 tint, float t, float phase, float life) {
    vec2 q = p - pos;
    float r = length(q);
    float b = 1.0 + 0.30 * sin(t * 1.1 + phase) * life;
    vec3 acc = vec3(1.0) * exp(-r * r / (0.000040 * scale * b)) * 2.4;
    acc += tint * exp(-r * r / (0.00075 * scale * b)) * 0.85;
    acc += tint * exp(-r * r / (0.0090 * scale)) * 0.22;
    // Four short blades.
    for (int k = 0; k < 2; k++) {
      vec2 d = k == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      float along = abs(dot(q, d));
      float perp  = abs(dot(q, vec2(-d.y, d.x)));
      acc += tint * exp(-perp * (420.0 / scale)) * exp(-along * (22.0 / scale)) * 0.30;
    }
    return acc;
  }

  // ---------------------------------------------------------------------------
  // TRANSIENTS - the requested motion
  // ---------------------------------------------------------------------------

  // streak: one shooting star / meteor. Each has an integer "epoch"; within an
  // epoch it flies once along a randomised path, then the epoch advances and a
  // new random path is drawn. A capsule SDF gives the head + tapering tail.
  //
  //   period : seconds per epoch (how often this lane fires)
  //   len    : trail length
  //   speed  : how much of the period is spent flying (rest is dark)
  vec3 streak(vec2 p, float t, float seed, float period, float len, float thick, vec3 tint) {
    float cycle = t / period + seed;
    float epoch = floor(cycle);
    float ph = fract(cycle);                    // 0..1 within this epoch

    // Randomise this epoch's path.
    vec2 h = hash22(vec2(epoch, seed * 13.7));
    float h2 = hash21(vec2(epoch * 1.7, seed * 5.1));
    // Start point across the upper sky, end point down and to one side.
    vec2 a = vec2(mix(-0.85, 0.85, h.x), mix(0.10, 0.52, h.y));
    float dir = h2 < 0.5 ? -1.0 : 1.0;
    float ang = mix(0.7, 1.35, hash21(vec2(epoch, seed))) * dir;
    vec2 dv = vec2(sin(ang), -cos(ang));        // mostly downward
    vec2 b = a + dv * len;

    // Fly across the first 35% of the epoch, then nothing until it repeats.
    float fly = smoothstep(0.0, 0.35, ph);
    if (ph > 0.42) return vec3(0.0);
    vec2 head = mix(a, b, fly);

    // Distance to the trail segment behind the head.
    vec2 tailEnd = head - dv * len * 0.30 * fly;
    vec2 pa = p - tailEnd, ba = head - tailEnd;
    float hh = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
    float d = length(pa - ba * hh);

    // Tail is thin and fades toward its far end; head is a bright point.
    float trail = exp(-d * d / (thick * thick)) * hh;
    float bright = exp(-length(p - head) * length(p - head) / (thick * thick * 2.2));
    // Fade the whole thing in and out over the flight.
    float env = sin(ph / 0.42 * 3.14159265);
    return tint * (trail * 0.8 + bright * 2.2) * max(env, 0.0);
  }

  // dyingStar: a tiny far-off supernova. Sits at a fixed random point for its
  // epoch, flashes up fast, then decays slowly - deliberately SMALL, so it reads
  // as something very distant rather than a foreground event.
  vec3 dyingStar(vec2 p, float t, float seed, float period) {
    float cycle = t / period + seed;
    float epoch = floor(cycle);
    float ph = fract(cycle);

    vec2 h = hash22(vec2(epoch * 3.1, seed * 7.7));
    vec2 pos = vec2(mix(-0.90, 0.90, h.x), mix(0.02, 0.50, h.y));

    // Fast rise, slow decay.
    float env = ph < 0.06 ? ph / 0.06 : exp(-(ph - 0.06) * 9.0);
    if (ph > 0.55) env = 0.0;

    float r = length(p - pos);
    // Tiny core plus a brief halo that expands slightly as it fades.
    float grow = 1.0 + ph * 2.5;
    vec3 acc = vec3(1.00, 0.95, 0.88) * exp(-r * r / 0.0000075) * 1.6;
    acc += vec3(0.85, 0.90, 1.00) * exp(-r * r / (0.000055 * grow)) * 0.55;
    return acc * env;
  }

  // ---------------------------------------------------------------------------
  // TERRAIN
  // ---------------------------------------------------------------------------

  // ridge: the mountain silhouette height at a given x. Layered noise ridges,
  // with the classic 1-|2n-1| fold to make sharp peaks instead of rolling hills.
  float ridge(float x, float seed, float scale, float amp) {
    float n = fbm(vec2(x * scale + seed, seed * 0.7));
    n = 1.0 - abs(2.0 * n - 1.0);
    return n * amp;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.20 + uSpeed * 6.0);

    // life: master motion amount on the Twinkle slider.
    float life = 0.25 + uTwinkle * 1.55;

    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.6, iconZone);

    // Night sky base: deep blue-black, warming very slightly toward the horizon.
    vec3 col = uVoid * 0.75 + vec3(0.020, 0.014, 0.030) * (1.0 - smoothstep(-0.30, 0.35, p.y));

    // --- Deep sky, painted before the terrain masks it off ------------------

    // Barnard's Loop: the crimson arc.
    float loop = barnardLoop(p, t, life);
    col += vec3(0.80, 0.16, 0.30) * loop * 0.85 * quiet;
    // A dimmer, wider wash inside the arc so the sky is not flat black.
    col += vec3(0.34, 0.10, 0.18) * smoothstep(0.62, 0.10, length((p - vec2(0.02, 0.30)) * vec2(1.0, 1.35))) * 0.30 * quiet;

    // The Orion Nebula: a bright pink-white core with a hot centre.
    float m42 = nebulaMass(p, vec2(-0.055, 0.075), vec2(0.115, 0.100), t, 1.9, life);
    col += vec3(0.95, 0.62, 0.80) * m42 * 0.95 * quiet;
    col += vec3(1.00, 0.90, 0.96) * m42 * m42 * 0.85 * quiet;

    // The Flame / Horsehead pocket, right of and below the nebula.
    float flame = nebulaMass(p, vec2(0.130, -0.010), vec2(0.105, 0.085), t, 6.4, life);
    col += vec3(0.90, 0.42, 0.52) * flame * 0.70 * quiet;

    // A faint dust lane cutting across, cooling part of the emission.
    float dust = nebulaMass(p, vec2(0.055, 0.030), vec2(0.16, 0.05), t, 11.2, life);
    col *= 1.0 - 0.30 * dust;

    // Star fields: two scales for depth.
    col += starField(p * 20.0, t, 4.7, 0.42, life) * 0.55 * uStars * quiet;
    col += starField(p * 38.0, t, 9.3, 0.46, life) * 0.30 * uStars * quiet;

    // Hero stars: Sirius low left (brilliant blue-white), plus Orion's Belt.
    col += brightStar(p, vec2(-aspect * 0.40, -0.055), 1.35, vec3(0.80, 0.88, 1.00), t, 0.0, life) * uIntensity * quiet;
    col += brightStar(p, vec2( 0.085,  0.010), 0.55, vec3(0.86, 0.90, 1.00), t, 1.3, life) * uIntensity * quiet;
    col += brightStar(p, vec2( 0.120, -0.020), 0.50, vec3(0.86, 0.90, 1.00), t, 2.6, life) * uIntensity * quiet;
    col += brightStar(p, vec2( 0.155, -0.048), 0.52, vec3(0.86, 0.90, 1.00), t, 3.9, life) * uIntensity * quiet;

    // --- Transients ---------------------------------------------------------
    // All scaled by life, so the Twinkle slider also governs how busy the sky is.

    // Shooting stars: long, bright, infrequent.
    col += streak(p, t, 0.13, 11.0, 0.85, 0.0075, vec3(0.95, 0.97, 1.00)) * 1.00 * life * quiet;
    col += streak(p, t, 0.61, 17.0, 1.05, 0.0065, vec3(0.90, 0.95, 1.00)) * 0.85 * life * quiet;

    // Meteors: shorter, thinner, more frequent, warmer.
    col += streak(p, t, 0.29, 6.5, 0.42, 0.0042, vec3(1.00, 0.88, 0.68)) * 0.70 * life * quiet;
    col += streak(p, t, 0.77, 5.0, 0.34, 0.0038, vec3(1.00, 0.82, 0.60)) * 0.62 * life * quiet;
    col += streak(p, t, 0.44, 8.0, 0.50, 0.0040, vec3(0.98, 0.90, 0.75)) * 0.58 * life * quiet;

    // Dying stars: tiny distant supernova flashes.
    col += dyingStar(p, t, 0.07, 13.0) * 0.85 * life * quiet;
    col += dyingStar(p, t, 0.51, 19.0) * 0.75 * life * quiet;
    col += dyingStar(p, t, 0.83, 27.0) * 0.70 * life * quiet;

    // --- Terrain ------------------------------------------------------------
    // Three ridge layers, far to near, each darker than the last.

    float xr = p.x * 1.4;
    // Far ridge (right-hand peak in the reference).
    float hFar  = -0.20 + ridge(xr + 2.1, 3.3, 1.1, 0.30);
    // Mid ridge: the main snow-capped massif.
    float hMid  = -0.28 + ridge(xr - 0.6, 7.9, 0.9, 0.34);
    // Near ridge: the dark foreground shoulder.
    float hNear = -0.42 + ridge(xr + 4.4, 1.7, 0.7, 0.26);

    // Snow: brighter where the slope faces up and above a height threshold.
    // Approximate the slope from the ridge derivative via a small offset sample.
    float dFar  = ridge(xr + 2.1 + 0.02, 3.3, 1.1, 0.30) - (hFar + 0.20);
    float dMid  = ridge(xr - 0.6 + 0.02, 7.9, 0.9, 0.34) - (hMid + 0.28);

    // Far ridge body.
    if (p.y < hFar) {
      float depth = smoothstep(hFar, hFar - 0.22, p.y);
      vec3 rock = mix(vec3(0.30, 0.28, 0.27), vec3(0.16, 0.15, 0.17), depth);
      // Snow streaks: patchy, following the slope.
      float snow = smoothstep(0.35, 0.75, fbm(vec2(p.x * 9.0, p.y * 16.0) + 3.1));
      snow *= smoothstep(hFar - 0.16, hFar, p.y) * (0.5 + 0.5 * step(0.0, -dFar));
      rock = mix(rock, vec3(0.72, 0.72, 0.75), snow * 0.75);
      col = mix(col, rock * 0.62, 1.0);
    }
    // Mid ridge body (drawn over the far one).
    if (p.y < hMid) {
      float depth = smoothstep(hMid, hMid - 0.30, p.y);
      vec3 rock = mix(vec3(0.34, 0.31, 0.29), vec3(0.13, 0.12, 0.13), depth);
      float snow = smoothstep(0.32, 0.72, fbm(vec2(p.x * 11.0, p.y * 19.0) + 8.6));
      snow *= smoothstep(hMid - 0.20, hMid, p.y) * (0.5 + 0.5 * step(0.0, -dMid));
      rock = mix(rock, vec3(0.80, 0.80, 0.83), snow * 0.80);
      // The nebula's light spills onto the upper slopes.
      float lit = exp(-length(p - vec2(-0.055, 0.075)) * 2.2);
      rock += vec3(0.55, 0.30, 0.36) * lit * 0.22;
      col = mix(col, rock * 0.70, 1.0);
    }
    // Near ridge: nearly black, just a suggestion of form.
    if (p.y < hNear) {
      float depth = smoothstep(hNear, hNear - 0.35, p.y);
      vec3 rock = mix(vec3(0.13, 0.11, 0.11), vec3(0.045, 0.040, 0.045), depth);
      float snow = smoothstep(0.42, 0.80, fbm(vec2(p.x * 13.0, p.y * 21.0) + 15.2));
      snow *= smoothstep(hNear - 0.12, hNear, p.y);
      rock = mix(rock, vec3(0.42, 0.42, 0.45), snow * 0.40);
      col = mix(col, rock, 1.0);
    }

    // Airglow right along the ridge line: the sky is brightest where it meets
    // the mountains, as in the reference.
    float glowBand = exp(-(p.y - hMid) * (p.y - hMid) / 0.0040) * step(hMid, p.y);
    col += vec3(0.55, 0.42, 0.52) * glowBand * 0.30 * uHorizonGlow * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

// buildAudio(api) - Tone.js space bed. A mountain night: lowest, sparsest
// voice, D-root drone, wind for the ridges, sparkle for meteors.
export function buildAudio(api) {
  return api.interstellar({
    root: 73.42,
    scale: [146.83, 164.81, 196.00, 220.00, 246.94, 293.66],
    color: 'deep',
    density: 0.20,
    sparkle: 0.30,
    wind: 0.50,
  });
}
