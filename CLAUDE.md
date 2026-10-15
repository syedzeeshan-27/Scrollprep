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
