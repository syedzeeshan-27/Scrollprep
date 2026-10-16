# ScrollPrep

**Make any video scroll-smooth.** Drop in a video and get back files that scrub perfectly as
visitors scroll your site, plus the code to paste in. It runs entirely in your browser, so your
video is never uploaded anywhere.

## The problem

Apple-style product pages play a video forward and backward as you scroll. Try that with a normal
video and it stutters. To save space, videos only store a full picture (a *keyframe*) every few
seconds. Every frame in between holds only the changes. When scrolling jumps to a random moment,
the browser has to rebuild that frame from the last keyframe, so it lags.

The fix is to re-save the video with every frame as a keyframe, at a sensible size, without
audio, in a format Safari accepts. Until now that meant typing ffmpeg commands like this:

```bash
ffmpeg -i in.mov -vf "scale=1920:1080,fps=30" -c:v libx264 -crf 20 -g 1 -pix_fmt yuv420p -movflags +faststart -an video.mp4
```

ScrollPrep does it with a drag and drop, shows you a live before/after preview, and warns you
when the files are too heavy for phones.

## What you get

| File | What it is |
|---|---|
| `scrollprep/video.mp4` | H.264, every frame a keyframe, no audio, up to 1080p. Plays everywhere. |
| `scrollprep/video-mobile.mp4` | Lighter 720p copy, picked automatically on small screens. |
| `scrollprep/video.webm` | Optional VP9 copy, smaller, for Chrome and Firefox. |
| `scrollprep/frames/*.webp` | Optional image sequence for a canvas player. The smoothest option on iPhones. |
| `scrollprep/poster.jpg` | First frame, shown while loading and to visitors who prefer reduced motion. |
| `scrollprep/scrollscrub.js` | A tiny, dependency-free player (about 7 KB). |
| `demo.html` | A working page you can open straight away. |
| `README.txt` | Embed code and the equivalent ffmpeg commands. |

The video files work with any scroll-scrub player, such as
[scrolly-video](https://github.com/dkaoster/scrolly-video), GSAP ScrollTrigger, or the bundled
`scrollscrub.js`.

## Embedding

Copy the `scrollprep` folder next to your page and paste:

```html
<section class="scrollscrub" data-scrollscrub style="--scrollscrub-length:300vh">
  <div class="scrollscrub__stage">
    <video class="scrollscrub__media" muted playsinline preload="auto"
           poster="scrollprep/poster.jpg" data-src-mobile="scrollprep/video-mobile.mp4">
      <source src="scrollprep/video.mp4" type="video/mp4">
    </video>
  </div>
</section>
<script src="scrollprep/scrollscrub.js" defer></script>
```

The section's height sets how long the effect lasts. `300vh` means three screens of scrolling.

### Effects and text

Pick an effect in the app, or set it by hand:

- **Full screen** (default): the video fills the screen and scrubs.
- **Card grows** (`data-layout="card"`): the video starts as a rounded card and grows to fill the
  screen over the first 40% of the scroll.
- **Split** (`data-layout="split"`): a text column beside the video on wide screens. Phones fall
  back to text over the video.

Text over the video appears at chosen points and stays until the next line starts. In the app you
place it on a timeline of stills from your video: drag a label (or use the arrow keys, Shift for
bigger steps) and the preview jumps to where it appears. By hand it looks like this:

```html
<div class="scrollscrub__captions">
  <div class="scrollscrub__caption" data-at="0.1">Built to last.</div>
  <div class="scrollscrub__caption" data-at="0.55">Every detail, considered.</div>
</div>
```

The section also gets `--scrollscrub-progress` and `--scrollscrub-grow` CSS variables (0 to 1), so
you can drive your own styles from the scroll. Visitors who turn on reduced motion get the poster
with all the text listed underneath.

## How it works

- **Video engine:** [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API), the
  browser's built-in and usually hardware-accelerated encoder, through
  [Mediabunny](https://mediabunny.dev). No 30 MB ffmpeg download and no special server headers,
  so the site stays a small static page.
- **Preview:** the preview is the exact demo page from the zip, rendered in an iframe with the
  files swapped for in-memory URLs. What you see is what you ship.
- **Browser support:** current Chrome, Edge and Safari, and desktop Firefox. If a browser can't
  read or encode a file, ScrollPrep says so and shows the ffmpeg commands to run instead.

## Development

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
npm run e2e
```

The end-to-end run builds the app, drives headless Chrome through real conversions (a sample, a 4K
clip with sound, a trimmed portrait clip and a broken file), downloads each zip and checks with
ffprobe that every frame is a keyframe, sizes are capped and audio is gone. It needs Chrome or Edge
plus ffmpeg and ffprobe on your PATH.

Code layout:

- `src/core`: pure logic (sizes, bitrates, size budgets, snippet and ffmpeg generation), unit tested
- `src/engine`: media work in the browser (probe, encode, frames, pipeline, zip)
- `src/runtime/scrollscrub.js`: the player that ships in every zip
- `src/main.ts`, `src/styles.css`, `index.html`: the interface

## Deploying

It is a static site. On Vercel, import the repo and keep the defaults (framework: Vite, output:
`dist`). Any static host works the same way.

## License

MIT
