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
- 2026-10-16: Scripts that clear `.showcase/*` failed with EBUSY three times because the shell's working directory was left inside that folder (Windows locks it). Never `cd` into generated output folders; read them with absolute paths.
