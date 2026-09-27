// hud.js — the optional on-scene clock (big time + date, tucked into one corner).
// main.js calls createHud(config) once at boot and then hud.update() every frame;
// this module reads config.hud, decides whether to show anything, and formats the
// clock to the user's locale. Off by default — see the config.hud note below.

// An optional clock. Off by default: desktop icons already live in this space.
//
// createHud returns an object with a single update() method that the render loop
// pumps once per frame. When the clock is disabled (or its DOM is missing) we
// still return that shape — a no-op update() — so main.js can call it blindly
// without null checks in the hot path.
export function createHud(config) {
  // config.hud is { enabled, corner, clock24h, locale } — merged from FALLBACK
  // and config.json in config.js, and rewritten live by the settings panel
  // (panel.js), which forces a page reload so this function re-runs with the
  // new values. The three DOM nodes are baked into index.html.
  const settings = config.hud;
  const root = document.getElementById('hud');
  const time = document.getElementById('hudTime');
  const date = document.getElementById('hudDate');

  // Bail early if the clock is switched off or index.html didn't give us the
  // elements (e.g. a stripped-down page). Returning a live no-op keeps the
  // caller's `hud.update()` call in frame() harmless.
  if (!settings.enabled || !root || !time || !date) {
    return { update() {} };
  }

  // Reveal the clock and tell CSS which corner to pin it to. The <div id="hud">
  // ships with the `hidden` attribute; clearing it lets style.css lay it out.
  // data-corner drives the `.hud[data-corner="…"]` rules in style.css that set
  // the `inset` and text-align — so "corner" is purely a CSS concern, no JS math.
  root.hidden = false;
  root.dataset.corner = settings.corner;

  // Pre-build the two formatters once instead of per-frame. Intl.DateTimeFormat
  // is the browser's locale engine: it picks the digit style, separators and
  // AM/PM wording for `settings.locale` (e.g. 'en-CA' → "14:05", 'en-US' with
  // 12h → "2:05 PM"). hour12 is the inverse of clock24h — clock24h:true means
  // "no AM/PM", so we pass hour12:false.
  const timeFormat = new Intl.DateTimeFormat(settings.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !settings.clock24h,
  });

  // Date line: weekday + day + month, spelled out in the same locale
  // ("Friday, 28 August" vs "Friday, August 28"). No year — this is ambient
  // wallpaper chrome, not a calendar.
  const dateFormat = new Intl.DateTimeFormat(settings.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // The clock only changes text once a minute, but update() is called every
  // frame (~24fps). lastMinute is the guard: we remember the minute we last
  // painted and skip the DOM writes until it rolls over. -1 guarantees the
  // first call always paints.
  let lastMinute = -1;

  return {
    // Called from main.js frame() on every rendered frame. The getMinutes()
    // check is the real throttle — string formatting and textContent writes
    // only happen ~60 times an hour, not thousands of times a second. There's
    // no setInterval here on purpose: piggy-backing on the render loop means one
    // less timer to start/stop and it naturally pauses with the scene.
    update() {
      const now = new Date();
      if (now.getMinutes() === lastMinute) return;
      lastMinute = now.getMinutes();
      time.textContent = timeFormat.format(now);
      date.textContent = dateFormat.format(now);
    },
  };
}
