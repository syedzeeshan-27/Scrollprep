# ScrollPrep

In-browser tool that turns a video into scroll-scrub-ready files. Plan: `docs/plan.md`.

- `npm run dev` / `npm test` / `npm run build` / `npm run e2e` (needs Chrome + ffmpeg/ffprobe on PATH)
- Pure logic lives in `src/core` (unit tested). Browser media code in `src/engine`. The shipped
  player is `src/runtime/scrollscrub.js` and is the single source for both the zip and the preview.

## Lessons learned (do not repeat)

- 2026-10-16: One big Bash heredoc writing many source files failed to parse in Git Bash
  ("unexpected EOF"), so nothing got written. Write source files with the Write tool, one per file.
  This also hit a long `node - <<EOF` edit script: put edit scripts in a file with Write, then run it.
- 2026-10-16: Rendering the sample with ffmpeg's mandelbrot source at 720p and maxiter=1500 ran over 5 minutes without finishing. Time a 1-second test render before a full one.
- 2026-10-16: The mandelbrot sample at low maxiter rendered as a flat green screen. Always look at a few stills from a generated clip before using it.
- 2026-10-16: README GIFs showed ghost text while scrolling because ffmpeg's `hqdn3d=4:4:0:0` treats a 0 temporal strength as "use the default", so it still blended frames. Use `hqdn3d=4:4:0.01:0.01` (or no denoise) and look at frames from the finished GIF, not just the raw shots.
- 2026-10-19: Blamed the landing demo video for a slow 4K e2e run after one timing each way (43 s vs
  160 s). A rerun flipped it (293 s vs 55 s): 4K encode time swings a lot on this machine, likely when
  the browser pane is also playing video. Time each case at least twice, with the pane cleared, before blaming a change.
- 2026-10-19: The keyframe strip's playhead cell never lit up because its 0.2 s colour fade was longer than
  the 120 ms tick. Flashing states that change faster than their transition need `transition: none`.
- 2026-10-19: `ffmpeg ... -vsync vfr` failed: this ffmpeg (8.x) removed `-vsync`. Use `-fps_mode vfr`.
- 2026-10-19: A test imported `node:fs` to read the runtime source and `tsc` failed (no node types, and
  we don't want them). Import it as text with `?raw` instead, as `main.ts` already does.
- 2026-10-19: A `::after` reset for the typewriter cursor in the split and static layouts did nothing because
  it had lower specificity than the `.is-active::after` rule that creates it. Reset rules must match or beat
  the specificity of the rule they undo (here, include `.is-active`).
- 2026-10-19: Adding a third row to the effects tile grid cut it off in the GIF: the screenshot clip grew with the
  grid but the browser viewport stayed at 800px. `record.mjs` now sets the viewport to the grid height first.
- 2026-10-19: Colour in and Highlight effects were built and then dropped: Zeeshan wants scroll-experience effects
  (how the video lives on the page), not picture or text decoration, and nothing that turns the app into a video
  editor. Check new effect ideas against that before building.
- 2026-10-19: The glow sampler eased a colour towards its target and only wrote the CSS variable when something
  moved, so the first sample (current = target) never got written and the preview showed no glow. Anything that
  eases towards a value must also write the first value.
- 2026-10-16: Scripts that clear `.showcase/*` failed with EBUSY three times because the shell's working directory was left inside that folder (Windows locks it). Never `cd` into generated output folders; read them with absolute paths.
