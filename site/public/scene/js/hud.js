// An optional clock. Off by default: desktop icons already live in this space.

export function createHud(config) {
  const settings = config.hud;
  const root = document.getElementById('hud');
  const time = document.getElementById('hudTime');
  const date = document.getElementById('hudDate');

  if (!settings.enabled || !root || !time || !date) {
    return { update() {} };
  }

  root.hidden = false;
  root.dataset.corner = settings.corner;

  const timeFormat = new Intl.DateTimeFormat(settings.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !settings.clock24h,
  });

  const dateFormat = new Intl.DateTimeFormat(settings.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  let lastMinute = -1;

  return {
    update() {
      const now = new Date();
      if (now.getMinutes() === lastMinute) return;
      lastMinute = now.getMinutes();
      time.textContent = timeFormat.format(now);
      date.textContent = dateFormat.format(now);
    },
  };
}
