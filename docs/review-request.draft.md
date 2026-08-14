# Draft: review + feature request (NOT SENT)

This is a draft for **you** to review and post yourself. Nothing here has been sent.

The three.js project has no email-review channel — the right places are:

- **GitHub Discussions:** <https://github.com/mrdoob/three.js/discussions> (category: "Showcase" to share, or "Ideas" for feature suggestions)
- **Forum:** <https://discourse.threejs.org/> (the "Showcase & Discussion" section)

Cold-emailing the maintainers is discouraged and usually goes unanswered; a Showcase post
is how three.js projects normally get eyes and feedback. Pick one, paste, edit to taste.

---

## Showcase post (suggested)

**Title:** Win11Backdrop — a three.js aurora living behind the Windows 11 desktop icons

Hi all,

I built a small Windows 11 app that renders a live three.js scene as the desktop
wallpaper — behind the icons, on the real `WorkerW` layer, via a WebView2 host. It runs a
full-screen aurora shader plus a GPU-animated points field (the "motes"), spans multiple
monitors as one continuous canvas, and has an on-scene console for tuning the look live.

- Repo: <https://github.com/YOUR_USERNAME/Win11Backdrop>
- three.js r185, vendored (MIT), no CDN — the scene works fully offline.

The visuals lean on patterns straight from the official examples (`webgl_shaders_ocean` for
the shader surface, `webgl_points_sprites` and the custom-attributes particles example for
the motes), which I've credited in `CREDITS.md`.

**I'd love feedback on two things:**

1. **Shader/perf review** — the aurora is one full-screen quad with fbm noise and an
   adaptive quality ladder (it steps down render scale under budget). Any obvious wins for
   a scene that runs for hours in the background? I'm especially unsure about my octave
   counts and whether I should be using a render target instead of two direct passes.

2. **Feature ideas** — what would you most want from a "live three.js wallpaper" host?
   A few I'm weighing: a scene-pack format so people can drop in their own three.js scenes,
   audio-reactive input, and a preset picker seeded from the example gallery.

Happy to answer anything about the `WorkerW` re-parenting side (it's documented in
`Interop/DesktopLayer.cs`) if that's interesting to anyone.

Thanks!

---

## Notes before you post

- Replace `YOUR_USERNAME` with your actual GitHub handle, and make the repo public first.
- If you enabled GitHub Pages (there's now a minimal `_config.yml`), link the Pages URL too.
- Keep it in Showcase unless you have a concrete API request — Ideas is for specific
  three.js feature proposals, not project feedback.
