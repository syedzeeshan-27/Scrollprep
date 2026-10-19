/** Generates the embed code, the demo page and the readme that go in the zip. */

export const PATHS = {
  dir: 'scrollprep/',
  mp4: 'scrollprep/video.mp4',
  mobile: 'scrollprep/video-mobile.mp4',
  webm: 'scrollprep/video.webm',
  poster: 'scrollprep/poster.jpg',
  posterMobile: 'scrollprep/poster-mobile.jpg',
  runtime: 'scrollprep/scrollscrub.js',
  frames: 'scrollprep/frames/',
} as const;

export type FrameExt = 'webp' | 'jpg';
export type Layout = 'full' | 'card' | 'split' | 'reveal' | 'zoom';
export type CaptionStyle = 'rise' | 'words' | 'blur' | 'mask';

export interface Caption {
  text: string;
  /** When it appears, 0 to 1 through the effect. */
  at: number;
}

export const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'full', label: 'Full screen' },
  { id: 'card', label: 'Card grows' },
  { id: 'split', label: 'Split' },
  { id: 'reveal', label: 'Circle reveal' },
  { id: 'zoom', label: 'Zoom out' },
];

export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: 'rise', label: 'Fade up' },
  { id: 'words', label: 'Word by word' },
  { id: 'blur', label: 'Blur in' },
  { id: 'mask', label: 'Slide from mask' },
];

export const MAX_CAPTIONS = 6;

export interface ExportInfo {
  title: string;
  width: number;
  height: number;
  videos: { mp4: boolean; mobile: boolean; webm: boolean };
  frames: { count: number; ext: FrameExt } | null;
  hasPoster: boolean;
  /** A poster cut to the phone framing, swapped in on small screens. */
  hasMobilePoster?: boolean;
  /** Screen heights the effect lasts. */
  scrollLength: number;
  layout: Layout;
  captions: Caption[];
  /** How each line of text comes in. Fade up when left out. */
  captionStyle?: CaptionStyle;
}

/** Drops empty captions, clamps timing to 0..1 and sorts by when they appear. */
export function cleanCaptions(captions: Caption[]): Caption[] {
  return captions
    .map((c) => ({ text: c.text.trim(), at: Math.min(1, Math.max(0, Number.isFinite(c.at) ? c.at : 0)) }))
    .filter((c) => c.text)
    .slice(0, MAX_CAPTIONS)
    .sort((a, b) => a.at - b.at);
}

function sectionOpen(info: ExportInfo, extraAttrs = ''): string {
  const layout = info.layout && info.layout !== 'full' ? ` data-layout="${info.layout}"` : '';
  const style =
    info.captionStyle && info.captionStyle !== 'rise' && cleanCaptions(info.captions ?? []).length
      ? ` data-caption-style="${info.captionStyle}"`
      : '';
  const ratio = info.width > 0 && info.height > 0 ? `;--scrollscrub-ratio:${Number((info.width / info.height).toFixed(4))}` : '';
  return `<section class="scrollscrub" data-scrollscrub${layout}${style}${extraAttrs} style="--scrollscrub-length:${info.scrollLength * 100}vh${ratio}">`;
}

function captionLines(info: ExportInfo): string[] {
  const caps = cleanCaptions(info.captions ?? []);
  if (!caps.length) return [];
  return [
    `    <div class="scrollscrub__captions">`,
    ...caps.map((c) => `      <div class="scrollscrub__caption" data-at="${Number(c.at.toFixed(3))}">${escapeHtml(c.text)}</div>`),
    `    </div>`,
  ];
}

export type Resolve = (path: string) => string;
const same: Resolve = (p) => p;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const attr = (s: string) => escapeHtml(s);

export function framePattern(ext: FrameExt): string {
  return `${PATHS.frames}frame-{i}.${ext}`;
}

export function hasVideo(info: ExportInfo): boolean {
  return info.videos.mp4 || info.videos.webm || info.videos.mobile;
}

/** The `<section>` for the video player. */
export function videoEmbed(info: ExportInfo, resolve: Resolve = same): string {
  const v = info.videos;
  const lines: string[] = [];
  const poster = info.hasPoster ? ` poster="${attr(resolve(PATHS.poster))}"` : '';
  // With only a mobile file, use it everywhere. Otherwise it is the small-screen swap.
  const swap = v.mobile && (v.mp4 || v.webm);
  const mobile =
    (swap ? ` data-src-mobile="${attr(resolve(PATHS.mobile))}"` : '') +
    (info.hasMobilePoster ? ` data-poster-mobile="${attr(resolve(PATHS.posterMobile))}"` : '');
  lines.push(sectionOpen(info));
  lines.push(`  <div class="scrollscrub__stage">`);
  lines.push(`    <div class="scrollscrub__frame">`);
  lines.push(`      <video class="scrollscrub__media" muted playsinline preload="auto"${poster}${mobile}>`);
  if (v.webm) lines.push(`        <source src="${attr(resolve(PATHS.webm))}" type="video/webm">`);
  if (v.mp4) lines.push(`        <source src="${attr(resolve(PATHS.mp4))}" type="video/mp4">`);
  if (!v.mp4 && !v.webm && v.mobile) lines.push(`        <source src="${attr(resolve(PATHS.mobile))}" type="video/mp4">`);
  lines.push(`      </video>`);
  lines.push(`    </div>`);
  lines.push(...captionLines(info));
  lines.push(`  </div>`);
  lines.push(`</section>`);
  return lines.join('\n');
}

/**
 * The `<section>` for the image-sequence player. Pass `frameUrls` to list every frame explicitly
 * (used by the in-app preview, where frames live at in-memory URLs).
 */
export function framesEmbed(info: ExportInfo, frameUrls?: string[]): string {
  if (!info.frames) throw new Error('No frames in this export');
  const source = frameUrls
    ? `data-frame-list="${attr(JSON.stringify(frameUrls))}"`
    : `data-frames="${attr(framePattern(info.frames.ext))}" data-frame-count="${info.frames.count}" data-frame-pad="4"`;
  return [
    sectionOpen(info, ` ${source}`),
    `  <div class="scrollscrub__stage">`,
    `    <div class="scrollscrub__frame">`,
    `      <canvas class="scrollscrub__media" aria-label="${attr(info.title)}"></canvas>`,
    `    </div>`,
    ...captionLines(info),
    `  </div>`,
    `</section>`,
  ].join('\n');
}

export function scriptTag(src: string = PATHS.runtime): string {
  return `<script src="${attr(src)}" defer></script>`;
}

export interface DemoOptions {
  mode: 'video' | 'frames';
  resolve?: Resolve;
  frameUrls?: string[];
  /** Either a script URL or the runtime source to inline. */
  runtime: { src: string } | { inline: string };
  /** Small label in the corner, used by the preview. */
  badge?: string;
}

/** A complete page that shows the effect. Goes in the zip as demo.html and powers the preview. */
export function demoPage(info: ExportInfo, opts: DemoOptions): string {
  const section = opts.mode === 'video' ? videoEmbed(info, opts.resolve) : framesEmbed(info, opts.frameUrls);
  const script =
    'src' in opts.runtime
      ? scriptTag(opts.runtime.src)
      : `<script>${opts.runtime.inline.replace(/<\/script/gi, '<\\/script')}</script>`;
  const badge = opts.badge ? `<div class="badge">${escapeHtml(opts.badge)}</div>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(info.title)} | scroll demo</title>
<style>
  html { background: #08080b; color: #ededf2; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { margin: 0; }
  .intro, .outro { min-height: 70vh; display: grid; place-content: center; text-align: center; padding: 0 20px; }
  .intro h1 { font-size: clamp(28px, 6vw, 56px); margin: 0 0 8px; letter-spacing: -0.02em; overflow-wrap: anywhere; }
  .intro p, .outro p { color: #9b9bab; margin: 0; }
  .badge { position: fixed; top: 12px; left: 12px; z-index: 5; padding: 4px 10px; border-radius: 99px;
           background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.15); font-size: 12px; }
</style>
</head>
<body>
${badge}
<header class="intro">
  <h1>${escapeHtml(info.title)}</h1>
  <p>Scroll down</p>
</header>
${section}
<footer class="outro"><p>Made scroll-ready with ScrollPrep</p></footer>
${script}
</body>
</html>
`;
}

export function readme(info: ExportInfo, ffmpegCommands: string[]): string {
  const parts: string[] = [];
  parts.push('ScrollPrep export');
  parts.push('=================');
  parts.push('');
  parts.push('Open demo.html in a browser to see the effect.');
  parts.push('');
  parts.push('To use it on your site:');
  parts.push('1. Copy the "scrollprep" folder next to your page.');
  parts.push('2. Paste this where the effect should appear:');
  parts.push('');
  parts.push(hasVideo(info) ? videoEmbed(info) : framesEmbed(info));
  parts.push('');
  parts.push('3. Add this once, before </body>:');
  parts.push('');
  parts.push(scriptTag());
  if (hasVideo(info) && info.frames) {
    parts.push('');
    parts.push('Prefer the image sequence (smoothest on iPhones)? Use this section instead:');
    parts.push('');
    parts.push(framesEmbed(info));
  }
  parts.push('');
  parts.push('Notes');
  parts.push('-----');
  parts.push('- Every video frame is a keyframe, so jumping to any point is instant.');
  parts.push('- The style attribute on the section sets how long the effect lasts (300vh = 3 screens).');
  parts.push('- data-layout="card" grows the video from a card to full screen. data-layout="split" puts text beside it.');
  parts.push('  data-layout="reveal" opens the video out of a circle. data-layout="zoom" starts close and pulls back.');
  parts.push('- Each caption shows from its data-at (0 = start, 1 = end) until the next one. Edit the text freely.');
  parts.push('- data-caption-style on the section changes how text comes in: words, blur or mask (fade up if left out).');
  parts.push('- Visitors who ask their device for reduced motion see the poster instead.');
  parts.push('- Serve the files from your own site. Videos on other domains need CORS headers.');
  if (ffmpegCommands.length) {
    parts.push('');
    parts.push('Same result with ffmpeg on the command line');
    parts.push('-------------------------------------------');
    parts.push(...ffmpegCommands);
  }
  parts.push('');
  return parts.join('\n');
}
