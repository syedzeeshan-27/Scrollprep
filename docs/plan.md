# ScrollPrep: plan

## What it is

A free, open source web app. You drop in a video (say, a product spinning) and get back files that
scrub smoothly when a visitor scrolls your page, plus the code to paste into your site.
Everything runs in the visitor's own browser. Nothing is uploaded, so hosting (Vercel) only serves a
small static site.

## Why it's needed

Normal videos store a full picture (a "keyframe") only every few seconds. Every other frame is a
diff against the last keyframe. When scroll jumps the video to an arbitrary moment, the browser has
to rebuild that frame from the last keyframe, so scroll-scrubbing stutters. The fix is to re-save
the video with every frame as a keyframe, shrink it to a sensible size, drop audio, and use a pixel
format Safari accepts. People do this today by hand with ffmpeg commands.

Players that consume such videos already exist (scrolly-video, vidscroll, canvas-scroll-clip).
ScrollPrep is the prep step, and its exported files work with any of them or with its own tiny
runtime.

## Decisions

- **Engine: WebCodecs via the Mediabunny library**, not ffmpeg.wasm. WebCodecs is the browser's
  built-in, often hardware-accelerated video encoder. It is far faster for big inputs, needs no
  30 MB download and no special server headers. Supported in current Chrome, Edge, Safari and
  desktop Firefox. If a browser or input codec can't be handled, the app says so and shows the
  exact ffmpeg command to run instead.
- **Output capped at 1080p** (short side), never upscaled. 720p option.
- **Every frame a keyframe**: `keyFrameInterval: 0` in Mediabunny.
- **Vanilla TypeScript + Vite**, no UI framework. Small, fast, easy to read.
- **Preview = the real export.** The preview is an iframe showing the exact demo page that goes in
  the zip, with file paths swapped for in-memory URLs. What you see is what you ship.
- **Before / after toggle** in the preview so you can feel the stutter go away.

## Outputs (in the zip)

| File | Default | Notes |
|---|---|---|
| `scrollprep/video.mp4` | on | H.264, all-intra, no audio, up to 1080p |
| `scrollprep/video-mobile.mp4` | on | Same, 720p short side, picked on small screens |
| `scrollprep/video.webm` | off | VP9, smaller, for Chrome/Firefox |
| `scrollprep/frames/frame-0001.webp` ... | off | Image sequence for a canvas player, most reliable on iOS. JPEG where WebP encoding is missing |
| `scrollprep/poster.jpg` | on | First frame. Shown before load and for reduced-motion users |
| `scrollprep/scrollscrub.js` | on | Tiny dependency-free runtime |
| `demo.html` | on | Working page using all of the above |
| `README.txt` | on | How to embed, plus the ffmpeg equivalents |

## Settings

Max size (720p / 1080p), frame rate (24 / 30), quality (low / medium / high), trim start/end,
which outputs, scroll length for the snippet (how many screen-heights the effect lasts).

## Source layout

```
src/
  core/        pure logic, unit tested (no browser APIs)
    settings.ts     types, defaults, output size, bitrate, frame timestamps
    budget.ts       file-size warnings for desktop and mobile
    snippets.ts     embed HTML, CSS, demo page, README text
    ffmpeg.ts       equivalent ffmpeg commands
  engine/      browser-only media work
    probe.ts        read input: size, duration, fps, codec, keyframe count
    encode.ts       all-intra MP4 / WebM via Mediabunny Conversion
    frames.ts       image sequence + poster via CanvasSink
    pipeline.ts     runs the selected jobs, aggregates progress, supports cancel
    zip.ts          builds the zip with fflate
  runtime/
    scrollscrub.js  shipped to users and used by the preview (single source)
  ui/          DOM code
  main.ts, styles.css
public/sample.mp4  sample clip with sparse keyframes, so the "before" visibly stutters
scripts/e2e.mjs    headless Chrome run of the whole flow, checked with ffprobe
```

## Runtime behaviour (`scrollscrub.js`)

- Finds `[data-scrollscrub]` sections. Each is a tall section with a sticky, full-screen stage.
- Progress = how far the section has scrolled through the viewport, 0 to 1.
- Video mode: eases `currentTime` toward the target each animation frame and never queues a new
  seek while one is in flight.
- Frames mode: preloads the images, draws the nearest frame to a canvas with cover fit.
- Uses the mobile file under 768px wide when present.
- `prefers-reduced-motion`: shows the poster, no scrubbing.

## Error handling

- Not a video, or no video track: clear message.
- Input codec can't be decoded in this browser (e.g. some HEVC/ProRes): message + ffmpeg command.
- Output codec can't be encoded: that output is skipped with a note, the rest still runs.
- Cancel button aborts the running job.
- Long or huge inputs: warning before processing (time + memory), processing still allowed.

## Testing

- Unit (Vitest): output size maths, bitrate, frame timestamps, budget warnings, snippet and ffmpeg
  command generation.
- End to end (`npm run e2e`): builds, serves, drives headless Chrome through the sample, downloads
  the zip, then checks with ffprobe that every frame of each video is a keyframe, sizes are capped,
  there is no audio, and frames/poster/demo exist. Also runs a 4K input and a portrait input.
- Visual check of the UI with screenshots at desktop and phone widths.

## Out of scope for v1

ffmpeg.wasm fallback, audio, cropping UI, hosting the processed files for users, React/Vue
wrappers, publishing the runtime to npm.
