# Draft: Reddit post for v2.0 (NOT SENT)

This is a draft for **you** to review and post yourself. Nothing here has been posted.

Everything under **The post** below is plain Markdown. Paste it straight into Reddit's post editor and it renders as proper headings, bold text, lists, and a code block — new Reddit's Fancy Pants (rich text) editor converts Markdown on paste, and the plain Markdown editor renders the same source identically.

## Where to post it

- **r/windows11** — biggest relevant audience for a Windows 11 tool; check the sidebar rules on self-promotion before posting.
- **r/desktops** — screenshot/video-first crowd, a live wallpaper is a natural fit.
- **r/threejs** — smaller, but the people who'll actually read `SceneHost.cs` are here.
- **r/SideProject** — fine for the "built this, here's v2" framing.

Pick one or two rather than cross-posting everywhere at once — mods notice, and the comments fragment.

---

## The post

**Title:** 3JSxWin v2.0 — a live three.js scene running behind your Windows 11 desktop icons

*(attach `v2.0.gif`, or a fresh recording of Deep Field, as the post image — motion does most of the explaining here)*

[3JSxWin](https://github.com/yaluft/3JSxWin) renders a live three.js scene as your Windows 11 wallpaper — not floating on top of the desktop, but re-parented onto the actual `WorkerW` layer Explorer itself uses. Icons stay clickable, the taskbar stays on top, and it runs fully offline (three.js r185, vendored, no CDN).

v2.0 just shipped. What's new:

### The optional library just grew to 17 scenes

Nine scenes still load by default — Aurora, Tube Dunes, Starwell, Tube Warp, Ion, Tube Loops, Ember, Kelp, Murmur. This update's addition is a run of whole-planet scenes: Orbis, Atoll, Ringfall, Nimbus, Shoal, Caldera, Bayline, and **Deep Field** (nebula, debris, meteor storms) — the one I'd try first. Everything optional ships with the install; nothing loads until you switch it on from the on-scene console, so the base app stays light.

### Harder to knock loose

Desktop mode no longer falls back to a window if the attach hiccups — it retries silently instead. Tray reload now catches a disposed WebView2 instead of throwing.

### The console knows what's actually installed

The theme picker syncs itself against whatever's really in `web/themes/` on load, instead of assuming the full catalog is there.

### Cycling gives you feedback

`Win+]` / `Win+[` switch scenes, `Win+P` shuffles a palette pulled from real Neovim colorschemes (Catppuccin, Tokyo Night, Rosé Pine, Kanagawa...). Whichever you land on now flashes its name on screen for a couple of seconds.

---

Install (Windows 11, or 10 20H1+):

```powershell
irm https://yakupov.xyz/install.ps1 | iex
```

No install needed to look around — <https://yakupov.xyz/scene/> runs the same renderer in a browser tab. Site's at <https://yakupov.xyz/>, source and issues at <https://github.com/yaluft/3JSxWin>.

Built with [three.js](https://threejs.org) and Microsoft WebView2; design and debugging done alongside Claude, credited in `CREDITS.md`.

Open to bug reports, GPUs it chokes on, and votes for which of the 17 optional scenes should graduate to core. Deep Field's my favorite so far — curious what wins for everyone else.

---

## Notes before you post

- Swap the install one-liner or repo link if you're posting from a fork.
- If you post to more than one sub, tweak the opening line each time — identical text across subs reads as spam even where the mods technically allow it.
- r/windows11 in particular tends to want a screenshot or video in the post itself, not just linked — the Fancy Pants editor lets you drop `v2.0.gif` straight into the body.
