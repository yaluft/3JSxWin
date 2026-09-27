// theme.js (pillars) - an OPTIONAL scene, lazy-loaded by theme-catalog.js the
// first time it is picked. A per-image replica of NASA Webb's NIRCam Pillars
// of Creation in M16 (Eagle Nebula): three rusty-gold spires rising out of a
// dusty base toward the upper right, semi-opaque so the packed starfield shows
// through, lava-red ejections along the rims, and a few newborn red orbs at
// the tips. Nothing from the PNG is loaded at runtime - visual reference only.
// See CREDITS.md.

export const id = 'pillars';

export const meta = {
  label: 'Pillars of Creation',
  blurb: 'M16 Eagle - three rusty spires in a packed starfield, red-tipped ejections, NIRCam spikes',
  silent: true,
};

export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 17.13));
  }

  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  vec2 camP(vec2 p, float depth, float t) {
    vec2 sway = vec2(sin(t * 0.17) * 0.036, cos(t * 0.13) * 0.022);
    float roll = sin(t * 0.10) * 0.010;
    vec2 q = rot2(p, roll);
    q -= sway * (0.20 + 0.80 * depth);
    q *= 1.0 + 0.010 * sin(t * 0.08) * depth;
    return q;
  }

  vec3 webbStar(vec2 p, vec2 pos, float mag, float t) {
    vec2 q = p - pos;
    float r = length(q);
    float coreR = 0.0028 + mag * 0.0065;
    float pulse = 0.90 + 0.10 * sin(t * 1.20 + mag * 21.0);
    vec3 acc = vec3(0.95, 0.96, 1.00)
             * exp(-r * r / (coreR * coreR)) * (0.38 + mag * 1.10) * pulse;
    acc += vec3(0.55, 0.62, 0.95) * exp(-r * 40.0) * mag * 0.20;
    if (mag > 0.50) {
      float spikeGain = (mag - 0.50) * 0.65;
      for (int k = 0; k < 4; k++) {
        float ang = k < 3 ? 0.5235988 + float(k) * 1.0471976 : 0.0;
        vec2 d = vec2(cos(ang), sin(ang));
        float along = abs(dot(q, d));
        float perp  = abs(dot(q, vec2(-d.y, d.x)));
        float thin  = k < 3 ? 220.0 - mag * 36.0 : 270.0;
        float reach = k < 3 ? mix(13.0, 5.5, mag) : mix(15.0, 6.8, mag);
        float ray = exp(-perp * thin) * exp(-along * reach);
        ray *= 0.88 + 0.12 * sin(t * 1.35 + float(k) * 2.0 + mag * 17.0);
        acc += vec3(0.95, 0.92, 1.00) * ray * spikeGain * (k < 3 ? 1.0 : 0.48);
      }
    }
    return acc;
  }

  float pinSheet(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 3.7));
        if (present <= 0.0) continue;
        vec2 pos = o + hash22(cell + seed);
        float mag = hash21(cell + seed * 7.1);
        float d = length(f - pos);
        float tw = 0.55 + 0.45 * sin(t * (0.9 + mag * 2.4) + mag * 31.0);
        acc += present * (0.40 + mag * 0.80) * tw * smoothstep(0.038 + mag * 0.04, 0.0, d);
      }
    }
    return acc;
  }

  vec3 starSheet(vec2 p, float t, float seed, float density) {
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
        mag *= mag;
        acc += webbStar(f, pos, mag, t) * present;
      }
    }
    return acc;
  }

  // capSDF: tapered capsule from a->b, radius ra at a and rb at b. The pillars
  // are these, then fbm-displaced so the rims look like eroded dust, not tubes.
  float capSDF(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float r = mix(ra, rb, h);
    return length(pa - ba * h) - r;
  }

  vec2 capNormal(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return normalize(pa - ba * h + vec2(1e-4));
  }

  // onePillar: returns rgb of one 3D dusty column. Fake volume from the SDF:
  // reconstruct a hemisphere normal, Lambert from upper-right (the cluster),
  // and a backlit rim so the silhouette glows the way the NIRCam rims do.
  vec4 onePillar(vec2 p, vec2 a, vec2 b, float ra, float rb, float t, float seed) {
    // Domain-warp the sample so the capsule never reads as a drawn tube.
    vec2 pw = p + vec2(
      fbm(p * 3.1 + vec2(seed, t * 0.03)) - 0.5,
      fbm(p * 3.1 + vec2(seed + 8.4, -t * 0.02)) - 0.5
    ) * 0.085;
    float d0 = capSDF(pw, a, b, ra, rb);
    float disp = (fbm(pw * 4.6 + vec2(seed, t * 0.028)) - 0.46) * 0.085;
    disp += (fbm(pw * 9.5 + 4.2) - 0.5) * 0.028;
    float d = d0 - disp;
    if (d > 0.14) return vec4(0.0);
    vec2 n2 = capNormal(pw, a, b);
    float z = sqrt(max(0.0, 1.0 - clamp((-d) / max(rb, 0.02), 0.0, 1.0)));
    vec3 n = normalize(vec3(n2 * 0.80, 0.42 + z * 0.50));
    vec3 light = normalize(vec3(0.55, 0.65, 0.40));
    float diff = pow(clamp(dot(n, light), 0.0, 1.0), 0.90);

    float surf = fbm(pw * 6.8 + vec2(seed * 2.1, t * 0.02));
    vec3 dark  = vec3(0.20, 0.09, 0.04);
    vec3 rust  = vec3(0.66, 0.32, 0.12);
    vec3 gold  = vec3(0.92, 0.60, 0.28);
    vec3 albedo = mix(dark, rust, smoothstep(0.22, 0.55, surf));
    albedo = mix(albedo, gold, smoothstep(0.52, 0.82, surf));

    float along = clamp(dot(pw - a, b - a) / max(dot(b - a, b - a), 1e-4), 0.0, 1.0);
    float rim = exp(-abs(d) * 22.0);
    vec3 lit = albedo * (0.14 + 0.86 * diff);
    lit += vec3(0.95, 0.55, 0.22) * rim * 0.50 * (0.4 + 0.6 * diff);
    float lava = rim * smoothstep(0.52, 0.94, along)
               * (0.40 + 0.60 * sin(along * 16.0 - t * 0.80 + seed));
    lit += vec3(0.95, 0.18, 0.10) * lava * 0.90;

    float body = 1.0 - smoothstep(-0.01, 0.080, d);
    body *= 0.70 + 0.30 * surf;
    float alpha = body * mix(0.48, 0.90, smoothstep(0.06, -0.03, d));
    return vec4(lit, alpha);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p0 = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.08 + uSpeed * 0.48);

    float iconZone = 1.0 - smoothstep(0.12, 0.38, uv.x);
    float quiet = mix(1.0, 0.62, iconZone);

    vec2 pFar  = camP(p0, 0.10, t);
    vec2 pMid  = camP(p0, 0.55, t);
    vec2 pNear = camP(p0, 1.00, t);

    // Packed blue-violet starfield - the NIRCam view is "practically pulsing"
    // with stars, so this layer is dense on purpose.
    vec3 col = mix(vec3(0.010, 0.018, 0.055), vec3(0.04, 0.08, 0.20),
                   smoothstep(-0.4, 0.6, pFar.y));
    col += vec3(0.82, 0.86, 1.00) * pinSheet(pFar * 48.0 + vec2(t * 0.012, 0.0), t, 1.1, 0.90) * 0.95 * uStars * quiet;
    col += vec3(0.90, 0.88, 0.78) * pinSheet(pFar * 78.0 + vec2(t * 0.018, -t * 0.006), t, 4.4, 0.92) * 0.55 * uStars * quiet;
    col += starSheet(pFar * 20.0 + vec2(t * 0.010, 0.0), t, 1.7, 0.55) * 0.28 * uStars * quiet;

    // Soft dusty veil behind the columns so they sit in a volume, not on a void.
    vec2 w = vec2(fbm(pMid * 1.6 + vec2(t * 0.03, 0.0)),
                  fbm(pMid * 1.6 + vec2(3.3, -t * 0.02)));
    float veil = fbm(pMid * 2.2 + (w - 0.5) * 1.0);
    veil = smoothstep(0.38, 0.68, veil);
    float veilWin = smoothstep(0.55, -0.15, pMid.x * 0.4 + pMid.y);
    col += vec3(0.28, 0.12, 0.22) * veil * veilWin * 0.22 * quiet;

    // Three pillars, far to near. A tiny tip pulse so the columns never read
    // as a frozen extrusion.
    float breath = 1.0 + 0.030 * sin(t * 0.55);
    vec2 a3 = vec2( 0.04, -0.10); vec2 b3 = a3 + (vec2( 0.40,  0.24) - a3) * breath;
    vec2 a2 = vec2(-0.08, -0.16); vec2 b2 = a2 + (vec2( 0.20,  0.36) - a2) * breath;
    vec2 a1 = vec2(-0.55, -0.62); vec2 b1 = vec2(-0.16,  0.08);
    vec2 aBase = vec2(-0.72, -0.70); vec2 bBase = vec2(-0.38, -0.22);
    vec4 p3 = onePillar(pMid,  a3, b3, 0.078, 0.030, t, 3.1);
    vec4 p2 = onePillar(pMid,  a2, b2, 0.100, 0.036, t, 5.7);
    vec4 p1 = onePillar(pNear, a1, b1, 0.185, 0.058, t, 1.4);
    vec4 pBase = onePillar(pNear, aBase, bBase, 0.160, 0.080, t, 8.2);

    col = col * (1.0 - p3.a * 0.72 * quiet) + p3.rgb * p3.a * quiet;
    col = col * (1.0 - p2.a * 0.72 * quiet) + p2.rgb * p2.a * quiet;
    col = col * (1.0 - p1.a * 0.78 * quiet) + p1.rgb * p1.a * quiet;
    col = col * (1.0 - pBase.a * 0.70 * quiet) + pBase.rgb * pBase.a * quiet;

    // Newborn red orbs at the tips - the scene-stealers in the NASA release.
    col += vec3(0.95, 0.22, 0.12) * exp(-length(pMid - vec2(0.18, 0.30)) * 42.0) * 1.15 * quiet;
    col += vec3(0.95, 0.28, 0.14) * exp(-length(pMid - vec2(0.36, 0.18)) * 48.0) * 0.90 * quiet;
    col += vec3(0.90, 0.20, 0.10) * exp(-length(pNear - vec2(-0.22, 0.02)) * 36.0) * 0.70 * quiet;

    vec3 heroes =
        webbStar(pFar,  vec2( 0.08,  0.38), 0.70, t)
      + webbStar(pFar,  vec2( 0.42,  0.12), 0.52, t)
      + webbStar(pFar,  vec2(-0.22,  0.30), 0.48, t)
      + webbStar(pNear, vec2(-0.48, -0.38), 0.42, t);
    col += heroes * uIntensity * quiet;

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  return api.interstellar({
    root: 65.41,
    scale: [130.81, 155.56, 196.00, 220.00, 261.63, 311.13],
    color: 'warm',
    density: 0.28,
    sparkle: 0.52,
    wind: 0.38,
  });
}
