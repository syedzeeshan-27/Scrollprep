/**
 * Background loops: short, light, autoplaying videos behind a page header. Pure maths, embed code
 * and readme text. No browser APIs, so it is unit tested.
 */

import type { QualityLevel, Range, Size } from './settings';
import { escapeHtml, type Resolve } from './snippets';

export type Crossfade = 0 | 0.5 | 1;

export interface LoopSettings {
  maxShortSide: 720 | 1080;
  fps: 24 | 30;
  quality: QualityLevel;
  trimStart: number;
  trimEnd: number | null;
  /** Seconds of blend between the end and the start, so the loop has no visible jump. */
  crossfade: Crossfade;
  webm: boolean;
}

export const CROSSFADES: { value: Crossfade; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 0.5, label: '0.5 s' },
  { value: 1, label: '1 s' },
];

export const LOOP_PATHS = {
  mp4: 'background/loop.mp4',
  webm: 'background/loop.webm',
  poster: 'background/poster.jpg',
} as const;

/**
 * Bits per pixel per frame for a normal encode (keyframes every 2 s). Far lower than scroll
 * videos, because frames can borrow detail from their neighbours.
 */
export const LOOP_BITS_PER_PIXEL: Record<QualityLevel, number> = {
  low: 0.025,
  medium: 0.045,
  high: 0.075,
};

export const LOOP_KEYFRAME_SECONDS = 2;

export function loopBitrate(size: Size, fps: number, quality: QualityLevel, codec: 'avc' | 'vp9'): number {
  return Math.round(size.width * size.height * fps * LOOP_BITS_PER_PIXEL[quality] * (codec === 'vp9' ? 0.7 : 1));
}

/** The crossfade can use at most a third of the clip, so most of it stays untouched. */
export function effectiveFade(range: Range, crossfade: number): number {
  const len = range.end - range.start;
  return Math.max(0, Math.min(crossfade, len / 3));
}

/** Length of the finished loop: the clip minus the part folded into the crossfade. */
export function loopDuration(range: Range, fade: number): number {
  return range.end - range.start - fade;
}

export interface LoopFrame {
  /** Output time in seconds. */
  t: number;
  /** Source time for the main picture. */
  main: number;
  /** Source time for the picture blended on top near the end, or null outside the blend. */
  head: number | null;
  /** How much of the `head` picture shows, 0 to 1. */
  weight: number;
}

/**
 * Frame plan for a seamless loop. The output starts `fade` seconds into the clip. In its last
 * `fade` seconds it blends from the clip's end into the clip's opening, which leads exactly into
 * the output's first frame, so the wrap-around is invisible.
 */
export function loopFrames(range: Range, fade: number, fps: number): LoopFrame[] {
  const out = loopDuration(range, fade);
  const count = Math.max(1, Math.round(out * fps));
  const blendStart = out - fade;
  const frames: LoopFrame[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / fps;
    const main = range.start + fade + t;
    if (fade > 0 && t >= blendStart) {
      const into = t - blendStart;
      frames.push({ t, main, head: range.start + into, weight: Math.min(1, (into + 1 / fps) / fade) });
    } else {
      frames.push({ t, main, head: null, weight: 0 });
    }
  }
  return frames;
}

export interface LoopInfo {
  title: string;
  width: number;
  height: number;
  hasWebm: boolean;
}

/** HTML for the background video, with a tiny script that respects reduced motion. */
export function loopEmbed(info: LoopInfo, resolve: Resolve = (p) => p): string {
  const a = (p: string) => escapeHtml(resolve(p));
  return [
    `<div class="bg-video" aria-hidden="true">`,
    `  <video class="bg-video__media" autoplay muted loop playsinline preload="auto" poster="${a(LOOP_PATHS.poster)}">`,
    ...(info.hasWebm ? [`    <source src="${a(LOOP_PATHS.webm)}" type="video/webm">`] : []),
    `    <source src="${a(LOOP_PATHS.mp4)}" type="video/mp4">`,
    `  </video>`,
    `</div>`,
  ].join('\n');
}

export const LOOP_CSS = `/* Put .bg-video inside the element it should fill (that element needs position: relative). */
.bg-video { position: absolute; inset: 0; overflow: hidden; z-index: -1; }
.bg-video__media { width: 100%; height: 100%; object-fit: cover; display: block; }`;

export const LOOP_SCRIPT = `<script>
  // Visitors who ask for reduced motion get the still poster instead of a moving background.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.bg-video__media').forEach(function (v) { v.removeAttribute('autoplay'); v.pause(); });
  }
</script>`;

export function loopDemoPage(info: LoopInfo, resolve: Resolve, badge?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(info.title)} | background demo</title>
<style>
  html { background: #08080b; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { margin: 0; }
  ${LOOP_CSS.replace(/\n/g, '\n  ')}
  .hero { position: relative; isolation: isolate; min-height: 100vh; min-height: 100svh; display: grid; place-content: center;
          text-align: center; padding: 0 24px; }
  .hero::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.55)); }
  .hero h1 { font-size: clamp(32px, 7vw, 72px); letter-spacing: -0.03em; margin: 0 0 12px; overflow-wrap: anywhere; }
  .hero p { margin: 0; opacity: .85; }
  .rest { padding: 64px 24px; text-align: center; color: #9b9bab; }
  .badge { position: fixed; top: 12px; left: 12px; z-index: 5; padding: 4px 10px; border-radius: 99px;
           background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.15); font-size: 12px; }
</style>
</head>
<body>
${badge ? `<div class="badge">${escapeHtml(badge)}</div>` : ''}
<header class="hero">
  ${loopEmbed(info, resolve).replace(/\n/g, '\n  ')}
  <h1>${escapeHtml(info.title)}</h1>
  <p>Your headline sits on top of the background video.</p>
</header>
<section class="rest"><p>The rest of your page continues here.</p></section>
${LOOP_SCRIPT}
</body>
</html>
`;
}

export function loopReadme(info: LoopInfo, commands: string[]): string {
  return [
    'ScrollPrep background loop',
    '==========================',
    '',
    'Open demo.html in a browser to see it.',
    '',
    'To use it on your site:',
    '1. Copy the "background" folder next to your page.',
    '2. Put this inside the section it should fill (give that section position: relative):',
    '',
    loopEmbed(info),
    '',
    '3. Add this CSS:',
    '',
    LOOP_CSS,
    '',
    '4. Optional, before </body>, so visitors who prefer reduced motion see the still poster:',
    '',
    LOOP_SCRIPT,
    '',
    'Same result with ffmpeg on the command line',
    '-------------------------------------------',
    ...commands,
    '',
  ].join('\n');
}

export interface LoopCommandInput {
  inputName: string;
  range: Range;
  fade: number;
  fps: number;
  size: Size;
  webm: boolean;
}

/** ffmpeg equivalents. The crossfade uses xfade to blend the clip's end into its opening. */
export function loopCommands(c: LoopCommandInput): string[] {
  const t = (s: number) => s.toFixed(3).replace(/\.?0+$/, '') || '0';
  const name = `"${c.inputName.replace(/"/g, '\\"')}"`;
  const head = `ffmpeg -ss ${t(c.range.start)} -to ${t(c.range.end)} -i ${name}`;
  const scale = `scale=${c.size.width}:${c.size.height},fps=${c.fps}`;
  let filter: string;
  if (c.fade > 0) {
    const out = loopDuration(c.range, c.fade);
    filter =
      `-filter_complex "[0:v]split[a][b];[a]trim=start=${t(c.fade)},setpts=PTS-STARTPTS[main];` +
      `[b]trim=duration=${t(c.fade)},setpts=PTS-STARTPTS[head];` +
      `[main][head]xfade=transition=fade:duration=${t(c.fade)}:offset=${t(out - c.fade)},${scale}"`;
  } else {
    filter = `-vf "${scale}"`;
  }
  const g = c.fps * LOOP_KEYFRAME_SECONDS;
  const cmds = [`${head} ${filter} -c:v libx264 -preset slow -crf 26 -g ${g} -pix_fmt yuv420p -movflags +faststart -an ${LOOP_PATHS.mp4}`];
  if (c.webm) cmds.push(`${head} ${filter} -c:v libvpx-vp9 -crf 36 -b:v 0 -g ${g} -row-mt 1 -pix_fmt yuv420p -an ${LOOP_PATHS.webm}`);
  return cmds;
}
