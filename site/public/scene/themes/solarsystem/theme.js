export const id = 'solarsystem';
export const meta = {
  label: 'Solar System',
  blurb: 'A glowing central star with orbiting worlds, planetary rings, and asteroid belt',
  silent: true,
};
export const kind = 'shader';

export const fragment = /* glsl */ `
  vec2 rot2(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // Multi-scale twinkling starfield
  float starLayer(vec2 p, float t, float seed, float density) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float acc = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 cell = i + o;
        float present = step(1.0 - density, hash21(cell + seed * 5.17));
        float mag = hash21(cell + seed * 9.31);
        vec2 pos = o + vec2(hash21(cell + seed), hash21(cell + seed * 2.7));
        float tw = 0.6 + 0.4 * sin(t * (1.2 + mag * 3.0) + mag * 6.28);
        float d = length(f - pos);
        float core = smoothstep(0.04 + mag * 0.03, 0.0, d);
        float halo = smoothstep(0.18 + mag * 0.15, 0.0, d) * 0.15;
        acc += present * mag * tw * (core + halo);
      }
    }
    return acc;
  }

  // Draw a 3D lit sphere representing a planet
  // returns vec4(col.rgb, alpha)
  vec4 renderBody(vec2 p, vec2 center, float radius, vec2 sunPos, vec3 baseCol, vec3 bandCol, float bands, float atmosphere, float t) {
    vec2 offset = p - center;
    float d = length(offset);
    if (d > radius * 1.5) return vec4(0.0);

    float bodyMask = 1.0 - smoothstep(radius - 0.0015, radius + 0.0015, d);
    if (bodyMask <= 0.0) return vec4(0.0);

    // Spherical normal
    vec2 norm2 = offset / max(radius, 1e-4);
    float z = sqrt(max(0.0, 1.0 - dot(norm2, norm2)));
    vec3 normal = vec3(norm2, z);

    // Light direction from Sun
    vec2 toSun = sunPos - center;
    vec3 lightDir = normalize(vec3(toSun, 0.25));

    // Surface details (rotation + optional banding)
    vec2 rotCoord = rot2(norm2, t * 0.8);
    float surfNoise = fbm(rotCoord * 5.0);
    float bandPattern = sin((norm2.y + surfNoise * 0.15) * bands * 12.0) * 0.5 + 0.5;
    vec3 surface = mix(baseCol, bandCol, bandPattern * step(0.5, bands));
    surface = mix(surface, surface * (0.8 + 0.4 * surfNoise), 0.6);

    // Diffuse lighting + Day/Night terminator
    float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
    diff = pow(diff, 0.85);

    // Ambient night glow / shadow
    vec3 litColor = surface * (0.04 + 0.96 * diff);

    // Atmospheric Rayleigh rim glow (fresnel)
    float fresnel = pow(1.0 - normal.z, 2.5) * atmosphere;
    vec3 atmoCol = mix(surface, uFrost, 0.5);
    litColor += atmoCol * fresnel * (0.2 + 0.8 * diff);

    return vec4(litColor, bodyMask);
  }

  float orbitR(int i) {
    if (i == 0) return 0.12;
    if (i == 1) return 0.18;
    if (i == 2) return 0.26;
    if (i == 3) return 0.34;
    if (i == 4) return 0.52;
    if (i == 5) return 0.68;
    if (i == 6) return 0.82;
    return 0.95;
  }
  float bodyR(int i) {
    if (i == 0) return 0.009;
    if (i == 1) return 0.015;
    if (i == 2) return 0.017;
    if (i == 3) return 0.012;
    if (i == 4) return 0.038;
    if (i == 5) return 0.030;
    if (i == 6) return 0.022;
    return 0.021;
  }
  float bodySpeed(int i) {
    if (i == 0) return 1.60;
    if (i == 1) return 1.18;
    if (i == 2) return 1.00;
    if (i == 3) return 0.80;
    if (i == 4) return 0.44;
    if (i == 5) return 0.32;
    if (i == 6) return 0.23;
    return 0.18;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float t = uTime * (0.08 + uSpeed * 0.6);

    // 1. Cosmic Deep Space & Nebula Background
    vec3 col = mix(uVoid, uTide, smoothstep(-0.6, 0.6, p.y * 1.5)) * 0.4;

    // Nebula dust wisps
    vec2 q = p * 2.2 + vec2(t * 0.02, -t * 0.01);
    float nebNoise = fbm(q + fbm(q * 1.8 + vec2(1.7, 3.4)));
    vec3 nebulaCol = mix(uIris, uVerdant, nebNoise);
    col += nebulaCol * pow(nebNoise, 2.2) * 0.35 * uIntensity;

    // Multi-tier Starfield
    float stars = starLayer(p * 28.0 + vec2(t * 0.01, 0.0), t, 1.3, 0.22) * 0.65
                + starLayer(p * 55.0 - vec2(t * 0.02, 0.0), t, 4.7, 0.28) * 0.45
                + starLayer(p * 95.0, t, 8.2, 0.35) * 0.3;
    col += uFrost * stars * uStars;

    // Perspective / Orbital Tilt Transformation
    // Tilt the plane slightly for an aesthetic isometric 3D view
    float tilt = 0.55;
    vec2 pt = vec2(p.x, p.y / tilt);

    // 2. Central Sun
    vec2 sunPos = vec2(0.0, 0.0);
    float sunDist = length(p - sunPos);
    float sunRad = 0.065 + uHeight * 0.015;

    // Solar Corona & Radiant Flares
    float angle = atan(p.y, p.x);
    float rays = sin(angle * 14.0 + t * 2.5) * 0.25 + sin(angle * 7.0 - t * 1.8) * 0.2;
    float corona = exp(-sunDist * 16.0) * 1.8 + exp(-sunDist * 5.5) * (0.6 + rays * 0.2);

    // Sun Surface Convection
    vec2 sunUV = rot2(p - sunPos, t * 0.3) * 18.0;
    float sunNoise = fbm(sunUV + vec2(t * 0.4, -t * 0.2));
    vec3 sunCoreCol = mix(vec3(1.0, 0.65, 0.15), vec3(1.0, 0.95, 0.75), sunNoise);
    float sunDisc = 1.0 - smoothstep(sunRad - 0.004, sunRad + 0.004, sunDist);

    // 3. Orbits & Planet Definitions
    // Define 8 planets with Keplerian relative speeds and radii
    for (int i = 0; i < 8; i++) {
      float r = orbitR(i);
      float dOrbit = abs(length(pt) - r);
      float orbitLine = smoothstep(0.0035, 0.0, dOrbit) * 0.25;
      col += mix(uIris, uFrost, 0.4) * orbitLine * uIntensity;
    }

    // Asteroid Belt (Between Mars & Jupiter)
    float rBelt = length(pt);
    if (rBelt > 0.38 && rBelt < 0.46) {
      float beltNoise = hash21(floor(vec2(atan(pt.y, pt.x) * 120.0, rBelt * 250.0)));
      float asteroid = step(0.92, beltNoise) * smoothstep(0.46, 0.42, rBelt) * smoothstep(0.38, 0.42, rBelt);
      col += uFrost * asteroid * 0.45;
    }

    // 4. Render Planets
    vec3 planetLayer = vec3(0.0);
    float planetAlpha = 0.0;

    // Earth's position placeholder for Moon
    vec2 earthPos = vec2(0.0);

    for (int i = 0; i < 8; i++) {
      float rad = orbitR(i);
      float a = t * bodySpeed(i) + float(i) * 1.73;
      vec2 center = vec2(cos(a) * rad, sin(a) * rad * tilt);

      if (i == 2) earthPos = center;

      vec3 bCol = vec3(0.5);
      vec3 bandCol = vec3(0.5);
      float bands = 0.0;
      float atmo = 0.2;

      if (i == 0) { // Mercury
        bCol = vec3(0.68, 0.65, 0.62);
        bandCol = vec3(0.45, 0.42, 0.40);
      } else if (i == 1) { // Venus
        bCol = vec3(0.92, 0.78, 0.45);
        bandCol = vec3(0.85, 0.60, 0.28);
        atmo = 0.7;
      } else if (i == 2) { // Earth
        bCol = vec3(0.12, 0.38, 0.78);
        bandCol = vec3(0.18, 0.58, 0.32);
        bands = 1.0;
        atmo = 0.85;
      } else if (i == 3) { // Mars
        bCol = vec3(0.82, 0.35, 0.15);
        bandCol = vec3(0.55, 0.20, 0.08);
        atmo = 0.3;
      } else if (i == 4) { // Jupiter
        bCol = vec3(0.82, 0.65, 0.48);
        bandCol = vec3(0.62, 0.38, 0.22);
        bands = 4.0;
        atmo = 0.4;
      } else if (i == 5) { // Saturn
        bCol = vec3(0.88, 0.76, 0.52);
        bandCol = vec3(0.72, 0.58, 0.38);
        bands = 3.0;
        atmo = 0.4;
      } else if (i == 6) { // Uranus
        bCol = vec3(0.42, 0.75, 0.85);
        bandCol = vec3(0.30, 0.60, 0.72);
        atmo = 0.6;
      } else if (i == 7) { // Neptune
        bCol = vec3(0.20, 0.35, 0.85);
        bandCol = vec3(0.12, 0.22, 0.65);
        atmo = 0.65;
      }

      // Saturn's Rings (Back Half)
      if (i == 5) {
        vec2 ringOff = (p - center);
        float ringDist = length(vec2(ringOff.x, ringOff.y / 0.38));
        float ring = smoothstep(0.042, 0.046, ringDist) * (1.0 - smoothstep(0.070, 0.075, ringDist));
        float cassini = 1.0 - smoothstep(0.057, 0.060, ringDist) * (1.0 - smoothstep(0.060, 0.063, ringDist));
        ring *= cassini;
        if (ringOff.y < 0.0) { // behind planet
          col += vec3(0.78, 0.70, 0.52) * ring * 0.7;
        }
      }

      vec4 planet = renderBody(p, center, bodyR(i), sunPos, bCol, bandCol, bands, atmo, t);
      col = mix(col, planet.rgb, planet.a);

      // Saturn's Rings (Front Half)
      if (i == 5) {
        vec2 ringOff = (p - center);
        float ringDist = length(vec2(ringOff.x, ringOff.y / 0.38));
        float ring = smoothstep(0.042, 0.046, ringDist) * (1.0 - smoothstep(0.070, 0.075, ringDist));
        float cassini = 1.0 - smoothstep(0.057, 0.060, ringDist) * (1.0 - smoothstep(0.060, 0.063, ringDist));
        ring *= cassini;
        if (ringOff.y >= 0.0) { // in front of planet
          col = mix(col, vec3(0.78, 0.70, 0.52), ring * 0.85);
        }
      }
    }

    // Earth's Moon
    float moonA = t * 6.0;
    vec2 moonPos = earthPos + vec2(cos(moonA) * 0.032, sin(moonA) * 0.032 * tilt);
    vec4 moon = renderBody(p, moonPos, 0.0045, sunPos, vec3(0.75), vec3(0.55), 0.0, 0.0, t);
    col = mix(col, moon.rgb, moon.a);

    // Apply Sun Disk and Corona on top
    col += (vec3(1.0, 0.55, 0.1) * corona + vec3(1.0, 0.85, 0.4) * exp(-sunDist * 28.0)) * uIntensity;
    col = mix(col, sunCoreCol, sunDisc);

    gl_FragColor = vec4(finish(col, uv), 1.0);
  }
`;

export function buildAudio(api) {
  const sub = api.osc('sine', 55);
  const subGain = api.gain(0.05);
  sub.connect(subGain);
  subGain.connect(api.master);

  const pad1 = api.osc('sawtooth', 110);
  const pad2 = api.osc('sawtooth', 110.5);
  const padF = api.filter('lowpass', 420, 1.1);
  const padG = api.gain(0.03);
  pad1.connect(padF);
  pad2.connect(padF);
  padF.connect(padG);
  padG.connect(api.master);
  api.lfo(0.06, 120, padF.frequency);

  const tape = api.noise('pink');
  const tapeF = api.filter('bandpass', 1400, 0.9);
  const tapeG = api.gain(0.015);
  tape.connect(tapeF);
  tapeF.connect(tapeG);
  tapeG.connect(api.master);

  api.startTracked();

  // Generative Pentatonic Arpeggio Plucks
  const chords = [
    { root: 55, scale: [220, 261.63, 329.63, 392.0, 440, 523.25] },
    { root: 43.65, scale: [174.61, 220, 261.63, 349.23, 440, 523.25] },
    { root: 65.41, scale: [261.63, 293.66, 329.63, 392.0, 523.25, 659.25] },
    { root: 49.0, scale: [196.0, 246.94, 293.66, 392.0, 493.88, 587.33] }
  ];

  let chordIdx = 0;
  let step = 0;

  api.everyRandom(3500, 4500, () => {
    if (!api.ctx) return;
    chordIdx = (chordIdx + 1) % chords.length;
    const now = api.ctx.currentTime;
    sub.frequency.exponentialRampToValueAtTime(chords[chordIdx].root, now + 0.5);
    pad1.frequency.exponentialRampToValueAtTime(chords[chordIdx].root * 2, now + 0.6);
    pad2.frequency.exponentialRampToValueAtTime(chords[chordIdx].root * 2 + 0.5, now + 0.6);
  });

  api.everyRandom(200, 350, () => {
    if (!api.ctx) return;
    step++;
    if (step % 2 === 0 || Math.random() > 0.4) {
      const now = api.ctx.currentTime;
      const notes = chords[chordIdx].scale;
      const freq = notes[Math.floor(Math.random() * notes.length)];
      const osc = api.ctx.createOscillator();
      const g = api.ctx.createGain();
      const f = api.ctx.createBiquadFilter();

      osc.type = (step % 4 === 0) ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);

      f.type = 'lowpass';
      f.frequency.setValueAtTime(2200, now);
      f.frequency.exponentialRampToValueAtTime(350, now + 0.3);

      g.gain.setValueAtTime(0.02, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

      osc.connect(f);
      f.connect(g);
      g.connect(api.master);

      osc.start(now);
      osc.stop(now + 0.35);
      osc.onended = () => {
        try { osc.disconnect(); f.disconnect(); g.disconnect(); } catch { /* */ }
      };
    }
  });
}
