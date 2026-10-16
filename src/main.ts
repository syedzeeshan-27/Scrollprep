import './styles.css';
import runtimeSource from './runtime/scrollscrub.js?raw';
import { budgetAdvice, inputWarnings, rateSize, type BudgetLevel, type Target } from './core/budget';
import {
  clipRange,
  defaultFrameCount,
  defaultSettings,
  estimateBytes,
  FRAME_BYTES_PER_PIXEL,
  fitSize,
  MAX_FRAME_COUNT,
  MOBILE_SHORT_SIDE,
  videoBitrate,
  type Settings,
} from './core/settings';
import {
  cleanCaptions,
  demoPage,
  escapeHtml,
  framesEmbed,
  hasVideo,
  LAYOUTS,
  MAX_CAPTIONS,
  PATHS,
  scriptTag,
  videoEmbed,
  type Caption,
  type ExportInfo,
  type Layout,
} from './core/snippets';
import { AbortedError, FriendlyError } from './engine/errors';
import { Timeline } from './ui/timeline';
import { FRAMINGS, needsCrop, phoneCrop, type Focus } from './core/crop';
import type { LoopResult, PipelineResult, ProbeResult } from './engine';
import {
  CROSSFADES,
  effectiveFade,
  LOOP_CSS,
  LOOP_PATHS,
  LOOP_SCRIPT,
  loopBitrate,
  loopDemoPage,
  loopDuration,
  loopEmbed,
  type LoopSettings,
} from './core/loop';

// The engine pulls in the video library (about 500 KB), so load it only when needed. Start
// fetching it once the page is idle so it is usually ready by the time someone drops a file.
let enginePromise: Promise<typeof import('./engine')> | null = null;
const engine = () => (enginePromise ??= import('./engine'));
const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
idle(() => void engine());

// ---------- tiny DOM helpers ----------

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
};
const show = (el: HTMLElement, on = true) => (el.hidden = !on);

const MB = 1024 * 1024;
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}
const formatTime = (s: number) => `${s.toFixed(s < 10 ? 1 : 0)} s`;

const el = {
  drop: $('#drop'),
  file: $<HTMLInputElement>('#file'),
  choose: $('#choose'),
  sample: $<HTMLButtonElement>('#sample'),
  workspace: $('#workspace'),
  sourceBody: $('#source-body'),
  reset: $('#reset'),
  settings: $<HTMLFormElement>('#settings'),
  estimate: $('#estimate'),
  go: $<HTMLButtonElement>('#go'),
  progress: $('#progress'),
  progressLabel: $('#progress-label'),
  progressPct: $('#progress-pct'),
  progressStep: $('#progress-step'),
  bar: $('#bar'),
  cancel: $('#cancel'),
  error: $('#error'),
  results: $('#results'),
  previewMode: $('#preview-mode'),
  preview: $<HTMLIFrameElement>('#preview'),
  length: $<HTMLInputElement>('#length'),
  lengthOut: $('#length-out'),
  files: $('#files'),
  notes: $('#notes'),
  elapsed: $('#elapsed'),
  download: $<HTMLButtonElement>('#download'),
  again: $('#again'),
  tabs: $('#tabs'),
  code: $('#code'),
  copy: $<HTMLButtonElement>('#copy'),
  layout: $('#layout'),
  captions: $('#captions'),
  addCaption: $<HTMLButtonElement>('#add-caption'),
  timeline: $('#timeline'),
  phoneFraming: $('#phone-framing'),
  mode: $('#mode'),
  modeHint: $('#mode-hint'),
  crossfade: $('#crossfade'),
  savings: $('#savings'),
  codeIntro: $('#code-intro'),
  design: $('#design'),
  previewHint: $('#preview-hint'),
  framing: $('#framing'),
  focusWrap: $('#focus-wrap'),
  focus: $('#focus'),
};

// ---------- state ----------

let source: ProbeResult | null = null;
let sourceUrl: string | null = null;
let result: PipelineResult | null = null;
let loopResult: LoopResult | null = null;
let mode: 'scroll' | 'loop' = 'scroll';
let resultUrls: Map<string, string> = new Map();
let frameUrls: string[] = [];
let thumbUrls: string[] = [];
let controller: AbortController | null = null;
let zipCache: { length: number; blob: Blob } | null = null;
let previewMode: 'after' | 'phone' | 'before' | 'frames' = 'after';
let codeTab = 'embed';
let layout: Layout = 'full';
/** What the phone crop centres on, picked by clicking the video. */
let focus: Focus = { x: 0.5, y: 0.5 };
// Example lines so the effect is visible straight away. Easy to edit or remove.
const captions: Caption[] = [
  { text: 'Built to last.', at: 0.1 },
  { text: 'Every detail, considered.', at: 0.55 },
];

// ---------- settings form ----------

function readSettings(): Settings {
  const f = new FormData(el.settings);
  const num = (k: string) => {
    const v = String(f.get(k) ?? '').trim();
    return v === '' ? null : Number(v);
  };
  const s = defaultSettings();
  s.maxShortSide = Number(f.get('size')) === 720 ? 720 : 1080;
  s.fps = Number(f.get('fps')) === 24 ? 24 : 30;
  s.quality = (f.get('quality') as Settings['quality']) ?? 'medium';
  s.trimStart = num('trimStart') ?? 0;
  s.trimEnd = num('trimEnd');
  s.outputs = { mp4: f.has('mp4'), mobile: f.has('mobile'), webm: f.has('webm'), frames: f.has('frames') };
  s.frameCount = Math.min(MAX_FRAME_COUNT, Math.max(2, Math.round(num('frameCount') ?? 120)));
  s.scrollLength = Number(el.length.value) || 3;
  const framing = String(f.get('framing') ?? 'tall');
  s.phoneFraming = framing === 'portrait' || framing === 'same' ? framing : 'tall';
  s.focus = { ...focus };
  return s;
}

function pill(level: BudgetLevel): string {
  const text = level === 'ok' ? 'Light' : level === 'heavy' ? 'Heavy' : 'Too heavy';
  return `<span class="pill pill--${level}">${text}</span>`;
}

function readLoopSettings(): LoopSettings {
  const s = readSettings();
  const f = new FormData(el.settings);
  const fade = Number(f.get('crossfade'));
  return {
    maxShortSide: s.maxShortSide,
    fps: s.fps,
    quality: s.quality,
    trimStart: s.trimStart,
    trimEnd: s.trimEnd,
    crossfade: fade === 0 || fade === 1 ? fade : 0.5,
    webm: f.has('loopWebm'),
  };
}

// ---------- mode: scroll effect or background loop ----------

const MODE_TEXT = {
  scroll: { hint: 'Plays as people scroll. Every frame becomes a full picture so it scrubs smoothly.', go: 'Make it scroll-ready' },
  loop: { hint: 'Autoplays on repeat behind your page header. Made as small as possible.', go: 'Shrink it' },
};

el.crossfade.innerHTML = CROSSFADES.map(
  (c) => `<label><input type="radio" name="crossfade" value="${c.value}" ${c.value === 0.5 ? 'checked' : ''}/><span>${c.label}</span></label>`,
).join('');

el.mode.addEventListener('change', () => {
  mode = new FormData(el.settings).get('mode') === 'loop' ? 'loop' : 'scroll';
  for (const node of el.settings.querySelectorAll<HTMLElement>('[data-mode]')) show(node, node.dataset.mode === mode);
  el.modeHint.textContent = MODE_TEXT[mode].hint;
  el.go.textContent = MODE_TEXT[mode].go;
  renderEstimate();
});

function renderEstimate() {
  if (!source) return;
  const s = readSettings();
  const range = clipRange(source.duration, s.trimStart, s.trimEnd);
  const secs = range.end - range.start;
  const main = fitSize(source, s.maxShortSide);
  const rows: string[] = [];
  const row = (label: string, bytes: number, target: Target) =>
    rows.push(`<li><span>${label}</span><span class="mono">≈ ${formatBytes(bytes)}</span>${pill(rateSize(bytes, target))}</li>`);
  if (mode === 'loop') {
    const ls = readLoopSettings();
    const fade = effectiveFade(range, ls.crossfade);
    const len = loopDuration(range, fade);
    row(`MP4 loop, ${main.width}×${main.height}`, estimateBytes(loopBitrate(main, ls.fps, ls.quality, 'avc'), len), 'background');
    if (ls.webm) row('WebM loop', estimateBytes(loopBitrate(main, ls.fps, ls.quality, 'vp9'), len), 'background');
    el.estimate.innerHTML = `<p class="estimate__title">Estimated sizes for a ${formatTime(len)} loop. Your file is ${formatBytes(source.file.size)}.</p><ul>${rows.join('')}</ul>`;
    el.go.disabled = !source.canDecode;
    return;
  }
  if (s.outputs.mp4) row(`Main video, ${main.width}×${main.height}`, estimateBytes(videoBitrate(main, s.fps, s.quality, 'avc'), secs), 'desktop');
  if (s.outputs.mobile) {
    const crop = phoneCrop(source, s.phoneFraming, s.focus);
    const m = fitSize(crop ?? source, MOBILE_SHORT_SIDE);
    if (crop || m.width < main.width || !s.outputs.mp4) {
      const shape = crop ? ', cropped for phones' : '';
      row(`Phone video, ${m.width}×${m.height}${shape}`, estimateBytes(videoBitrate(m, s.fps, s.quality, 'avc'), secs), 'mobile');
    } else {
      rows.push(`<li><span class="muted">No separate phone video needed. This one is already phone-sized.</span></li>`);
    }
  }
  if (s.outputs.webm) row('WebM video', estimateBytes(videoBitrate(main, s.fps, s.quality, 'vp9'), secs), 'desktop');
  if (s.outputs.frames) row(`${s.frameCount} image frames`, Math.round(main.width * main.height * FRAME_BYTES_PER_PIXEL * s.frameCount), 'desktop');
  el.estimate.innerHTML = rows.length
    ? `<p class="estimate__title">Estimated sizes for ${formatTime(secs)}</p><ul>${rows.join('')}</ul>`
    : `<p class="warn">Pick at least one output.</p>`;
  el.go.disabled = !rows.length || !source.canDecode;
  const fc = el.settings.querySelector<HTMLElement>('.frames-count');
  if (fc) show(fc, s.outputs.frames);
  renderFraming(s);
}

// ---------- phone framing ----------

el.framing.innerHTML = FRAMINGS.map(
  (f) => `<label><input type="radio" name="framing" value="${f.id}" ${f.id === 'tall' ? 'checked' : ''}/><span>${f.label}</span></label>`,
).join('');

const focusVideo = el.focus.querySelector('video')!;
const focusBox = el.focus.querySelector<HTMLElement>('.focus__box')!;

/** Shows the framing options for wide videos, and the crop box over the picker. */
function renderFraming(s: Settings) {
  if (!source) return;
  const wide = needsCrop(source, 'tall');
  show(el.phoneFraming, s.outputs.mobile && wide);
  const crop = s.outputs.mobile ? phoneCrop(source, s.phoneFraming, s.focus) : null;
  show(el.focusWrap, !!crop);
  if (!crop) return;
  el.focus.style.aspectRatio = `${source.width} / ${source.height}`;
  focusBox.style.left = `${(crop.left / source.width) * 100}%`;
  focusBox.style.top = `${(crop.top / source.height) * 100}%`;
  focusBox.style.width = `${(crop.width / source.width) * 100}%`;
  focusBox.style.height = `${(crop.height / source.height) * 100}%`;
}

function setFocusFrom(e: PointerEvent) {
  const r = el.focus.getBoundingClientRect();
  focus = {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
  };
  renderFraming(readSettings());
}

let pickingFocus = false;
el.focus.addEventListener('pointerdown', (e) => {
  pickingFocus = true;
  el.focus.setPointerCapture(e.pointerId);
  setFocusFrom(e);
});
el.focus.addEventListener('pointermove', (e) => pickingFocus && setFocusFrom(e));
el.focus.addEventListener('pointerup', () => (pickingFocus = false));
el.focus.addEventListener('pointercancel', () => (pickingFocus = false));

// Show a frame from the middle of the clip in the picker.
focusVideo.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(focusVideo.duration)) focusVideo.currentTime = focusVideo.duration / 2;
});

el.settings.addEventListener('input', renderEstimate);
el.settings.addEventListener('change', renderEstimate);

// ---------- loading a file ----------

function revoke() {
  for (const u of resultUrls.values()) URL.revokeObjectURL(u);
  for (const u of frameUrls) URL.revokeObjectURL(u);
  for (const u of thumbUrls) URL.revokeObjectURL(u);
  resultUrls = new Map();
  frameUrls = [];
  thumbUrls = [];
  zipCache = null;
}

function resetAll() {
  controller?.abort();
  revoke();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  source = null;
  sourceUrl = null;
  focusVideo.removeAttribute('src');
  result = null;
  loopResult = null;
  el.preview.srcdoc = '';
  show(el.workspace, false);
  show(el.results, false);
  show(el.progress, false);
  show(el.error, false);
  document.querySelector('.hero')?.removeAttribute('hidden');
  el.file.value = '';
}

function showError(message: string, detail?: string, commands?: string[]) {
  let html = `<p><b>${escapeHtml(message)}</b></p>`;
  if (detail) html += `<p class="muted small">${escapeHtml(detail)}</p>`;
  if (commands?.length) {
    html += `<p class="muted">You can get the same result with ffmpeg on your computer:</p><pre><code>${escapeHtml(commands.join('\n'))}</code></pre>`;
  }
  el.error.innerHTML = html;
  show(el.error);
}

function diagnosis(p: ProbeResult): string {
  if (p.keyframes == null) return '';
  const total = Math.max(1, Math.round(p.duration * p.fps));
  if (p.keyframes >= total * 0.9) {
    return `<p class="diag diag--ok">Every frame is already a full picture. ScrollPrep will still resize it and make it web-ready.</p>`;
  }
  const spots = p.keyframes === 1 ? 'spot' : 'spots';
  return `<p class="diag">Only <b>${p.keyframes}</b> of about <b>${total}</b> frames are full pictures. Scrolling can land cleanly on just ${p.keyframes} ${spots}, which is why it stutters. ScrollPrep makes every frame a full picture.</p>`;
}

async function loadFile(file: File) {
  resetAll();
  document.querySelector('.hero')?.setAttribute('hidden', '');
  show(el.workspace);
  show(el.settings, false);
  el.sourceBody.innerHTML = `<p class="muted">Reading ${escapeHtml(file.name)}…</p>`;
  window.scrollTo({ top: 0 });
  try {
    const { probe } = await engine();
    const p = await probe(file);
    source = p;
    sourceUrl = URL.createObjectURL(file);
    focus = { x: 0.5, y: 0.5 };
    focusVideo.src = sourceUrl;
    const warn = inputWarnings({ duration: p.duration, width: p.width, height: p.height, bytes: file.size });
    el.sourceBody.innerHTML = `
      <div class="source">
        <video class="source__video" src="${sourceUrl}" muted playsinline preload="metadata" controls></video>
        <dl class="facts">
          <div><dt>File</dt><dd title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</dd></div>
          <div><dt>Size</dt><dd>${p.width}×${p.height}</dd></div>
          <div><dt>Length</dt><dd>${formatTime(p.duration)}</dd></div>
          <div><dt>Frame rate</dt><dd>${p.fps ? `${Math.round(p.fps)} fps` : 'unknown'}</dd></div>
          <div><dt>Format</dt><dd>${escapeHtml(p.codec ?? 'unknown')}${p.hasAudio ? ', has sound' : ''}</dd></div>
          <div><dt>File size</dt><dd>${formatBytes(file.size)}</dd></div>
        </dl>
      </div>
      ${diagnosis(p)}
      ${warn.map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join('')}
      ${p.hasAudio ? '<p class="muted small">Sound is removed. Scroll videos play silently.</p>' : ''}`;

    const f = el.settings;
    (f.elements.namedItem('trimStart') as HTMLInputElement).value = '0';
    const end = f.elements.namedItem('trimEnd') as HTMLInputElement;
    end.value = p.duration.toFixed(1);
    end.max = p.duration.toFixed(2);
    (f.elements.namedItem('frameCount') as HTMLInputElement).value = String(defaultFrameCount(p.duration, 30));
    show(el.settings);
    renderEstimate();

    if (!p.canDecode) {
      const { commandsFor } = await engine();
      showError(
        `Your browser can't read this video format (${p.codec ?? 'unknown'}).`,
        'Try Chrome or Edge, or re-save the video as an H.264 MP4 first.',
        commandsFor(p, readSettings()),
      );
    }
  } catch (e) {
    source = null;
    show(el.settings, false);
    el.sourceBody.innerHTML = '';
    showError(e instanceof FriendlyError ? e.message : "Couldn't read that file.", e instanceof FriendlyError ? e.detail : String(e));
  }
}

el.choose.addEventListener('click', () => el.file.click());
el.file.addEventListener('change', () => {
  const f = el.file.files?.[0];
  if (f) void loadFile(f);
});
el.reset.addEventListener('click', () => {
  resetAll();
  window.scrollTo({ top: 0 });
});

el.sample.addEventListener('click', async () => {
  el.sample.disabled = true;
  const old = el.sample.textContent;
  el.sample.textContent = 'Loading sample…';
  try {
    const res = await fetch('/sample.mp4');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await loadFile(new File([blob], 'sample-spinning-card.mp4', { type: 'video/mp4' }));
  } catch (e) {
    showError("Couldn't load the sample clip.", String(e));
    show(el.workspace);
  } finally {
    el.sample.disabled = false;
    el.sample.textContent = old;
  }
});

// Drag and drop anywhere on the page.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFile(f);
});

// ---------- processing ----------

el.settings.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!source || controller) return;
  const s = readSettings();
  const ls = readLoopSettings();
  const isLoop = mode === 'loop';
  revoke();
  result = null;
  loopResult = null;
  show(el.results, false);
  show(el.error, false);
  show(el.progress);
  el.go.disabled = true;
  controller = new AbortController();
  const p = source;
  const { runPipeline, commandsFor, runLoop, loopCommandsFor } = await engine();
  const commands = () => (isLoop ? loopCommandsFor(p, ls) : commandsFor(p, s));
  const onState = (st: { label: string; step: number; steps: number; overall: number }) => {
    const pct = Math.round(st.overall * 100);
    el.progressLabel.textContent = st.label;
    el.progressStep.textContent = `Step ${st.step} of ${st.steps}`;
    el.progressPct.textContent = `${pct}%`;
    el.bar.style.width = `${pct}%`;
  };
  try {
    if (isLoop) {
      loopResult = await runLoop(p, ls, onState, controller.signal);
      for (const f of loopResult.files) if (f.blob) resultUrls.set(f.path, URL.createObjectURL(f.blob));
      previewMode = 'after';
    } else {
      result = await runPipeline(p, s, onState, controller.signal);
      for (const f of result.files) if (f.blob) resultUrls.set(f.path, URL.createObjectURL(f.blob));
      frameUrls = result.frames.map((b) => URL.createObjectURL(b));
      previewMode = hasVideo(result.info) ? 'after' : 'frames';
    }
    codeTab = 'embed';
    renderResults();
    show(el.results);
    if (!isLoop) void loadThumbs();
    el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (err instanceof AbortedError || controller?.signal.aborted) {
      showError('Cancelled. Change the settings and try again whenever you like.');
    } else if (err instanceof FriendlyError) {
      showError(err.message, err.detail, commands());
    } else {
      console.error(err);
      showError('Something went wrong while converting.', String(err), commands());
    }
  } finally {
    controller = null;
    show(el.progress, false);
    renderEstimate();
  }
});

el.cancel.addEventListener('click', () => controller?.abort());

// ---------- results ----------

function currentInfo(): ExportInfo {
  return { ...result!.info, scrollLength: Number(el.length.value) || 3, layout, captions: cleanCaptions(captions) };
}

// ---------- effect style: layout and text ----------

el.layout.innerHTML = LAYOUTS.map(
  (l) => `<label><input type="radio" name="layout" value="${l.id}" ${l.id === layout ? 'checked' : ''}/><span>${l.label}</span></label>`,
).join('');

el.layout.addEventListener('change', (e) => {
  layout = (e.target as HTMLInputElement).value as Layout;
  styleChanged(true);
});

let styleTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Code updates at once. The preview reloads right away for clicks, after a pause for typing.
 * `seekTo` scrolls the reloaded preview to that point of the effect.
 */
function styleChanged(now: boolean, seekTo?: number) {
  zipCache = null;
  renderCode();
  clearTimeout(styleTimer);
  if (now) renderPreview(seekTo);
  else styleTimer = setTimeout(() => renderPreview(seekTo), 400);
}

// ---------- preview scroll helpers ----------

function previewSection() {
  const w = el.preview.contentWindow;
  const s = w?.document.querySelector<HTMLElement>('[data-scrollscrub]');
  return w && s ? { w, s } : null;
}

/** How far through the effect the preview is scrolled, 0 to 1. */
function previewProgress(): number | null {
  const p = previewSection();
  if (!p) return null;
  const travel = p.s.offsetHeight - p.w.innerHeight;
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, (p.w.scrollY - p.s.offsetTop) / travel));
}

function seekPreview(at: number) {
  const p = previewSection();
  if (p) p.w.scrollTo(0, p.s.offsetTop + Math.max(0, p.s.offsetHeight - p.w.innerHeight) * at);
}

// ---------- timeline ----------

const timeline = new Timeline(el.timeline, {
  onMove(i, at, done) {
    if (!captions[i]) return;
    captions[i].at = at;
    const num = el.captions.querySelector<HTMLInputElement>(`li[data-i="${i}"] input[type=number]`);
    if (num) num.value = String(Math.round(at * 100));
    if (done) {
      // Reload with the new timing and land just after the text appears, so you see it.
      styleChanged(true, Math.min(1, at + 0.01));
    } else {
      zipCache = null;
      renderCode();
      seekPreview(at);
    }
  },
  onSeek: seekPreview,
});

/** Stills for the timeline, from the lightest processed video, or from the image frames. */
async function loadThumbs() {
  if (!result) return;
  const count = 10;
  const video = [PATHS.mobile, PATHS.mp4, PATHS.webm]
    .map((p) => result!.files.find((f) => f.path === p)?.blob)
    .find((b): b is Blob => !!b);
  try {
    let blobs: Blob[];
    if (video) {
      const { thumbnails } = await engine();
      blobs = await thumbnails(video, count, 72);
    } else {
      const n = result.frames.length;
      blobs = Array.from({ length: Math.min(count, n) }, (_, i) => result!.frames[Math.floor(((i + 0.5) * n) / count)]);
    }
    for (const u of thumbUrls) URL.revokeObjectURL(u);
    thumbUrls = blobs.map((b) => URL.createObjectURL(b));
    timeline.setThumbs(thumbUrls);
  } catch (e) {
    console.warn('Could not make timeline thumbnails', e);
  }
}

// Keep the playhead in step with the preview while results are on screen.
function followPreview() {
  if (!el.results.hidden) {
    const at = previewProgress();
    if (at != null) timeline.setPlayhead(at);
  }
  requestAnimationFrame(followPreview);
}
requestAnimationFrame(followPreview);

function renderCaptions() {
  el.captions.innerHTML = captions
    .map(
      (c, i) => `<li data-i="${i}">
        <input type="text" class="cap-text" maxlength="80" value="${escapeHtml(c.text)}" placeholder="Say something about it" aria-label="Text ${i + 1}" />
        <label class="cap-at">at <input type="number" min="0" max="100" step="5" value="${Math.round(c.at * 100)}" aria-label="When text ${i + 1} appears, in percent" /> %</label>
        <button type="button" class="link cap-del" aria-label="Remove text ${i + 1}">Remove</button>
      </li>`,
    )
    .join('');
  el.addCaption.disabled = captions.length >= MAX_CAPTIONS;
  timeline.setCaptions(captions);
}

el.captions.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  const i = Number(input.closest('li')?.dataset.i);
  if (!captions[i]) return;
  if (input.classList.contains('cap-text')) captions[i].text = input.value;
  else captions[i].at = Math.min(100, Math.max(0, Number(input.value) || 0)) / 100;
  timeline.setCaptions(captions);
  styleChanged(false);
});

el.captions.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.cap-del');
  if (!btn) return;
  captions.splice(Number(btn.closest('li')?.dataset.i), 1);
  renderCaptions();
  styleChanged(true);
});

el.addCaption.addEventListener('click', () => {
  // New text goes where the preview is, or a step after the last line.
  const lastAt = captions.length ? Math.max(...captions.map((c) => c.at)) : 0;
  const here = previewProgress();
  const at = here != null && here > 0.02 ? Math.round(here * 100) / 100 : Math.min(0.9, Math.round((lastAt + 0.25) * 20) / 20);
  captions.push({ text: '', at });
  renderCaptions();
  el.captions.querySelector<HTMLInputElement>('li:last-child .cap-text')?.focus();
});

renderCaptions();

// After the preview reloads, either keep the reader's place or jump to a requested point.
let afterLoad: { y: number; seekTo?: number } | null = null;
el.preview.addEventListener('load', () => {
  const a = afterLoad;
  afterLoad = null;
  if (!a) return;
  if (a.seekTo != null) seekPreview(a.seekTo);
  else el.preview.contentWindow?.scrollTo(0, a.y);
});

function renderPreview(seekTo?: number) {
  if (loopResult) {
    const resolve = (path: string) => resultUrls.get(path) ?? path;
    const before = previewMode === 'before' && sourceUrl;
    el.preview.classList.remove('is-phone');
    afterLoad = null;
    el.preview.srcdoc = before
      ? loopDemoPage({ ...loopResult.info, hasWebm: false }, (path) => (path === LOOP_PATHS.mp4 ? sourceUrl! : resolve(path)), `Before: your original file (${formatBytes(loopResult.originalBytes)})`)
      : loopDemoPage(loopResult.info, resolve, `After: ${formatBytes(loopResult.files.find((f) => f.path === LOOP_PATHS.mp4)?.bytes ?? 0)}`);
    return;
  }
  if (!result) return;
  const info = currentInfo();
  const resolve = (path: string) => resultUrls.get(path) ?? path;
  let html: string;
  if (previewMode === 'before' && sourceUrl) {
    const before: ExportInfo = { ...info, videos: { mp4: true, mobile: false, webm: false } };
    html = demoPage(before, {
      mode: 'video',
      resolve: (path) => (path === PATHS.mp4 ? sourceUrl! : resolve(path)),
      runtime: { inline: runtimeSource },
      badge: 'Before: your original file',
    });
  } else if (previewMode === 'frames') {
    html = demoPage(info, { mode: 'frames', frameUrls, runtime: { inline: runtimeSource }, badge: 'After: image frames' });
  } else if (previewMode === 'phone') {
    // A phone-width frame, so the player picks the phone video and poster by itself.
    html = demoPage(info, { mode: 'video', resolve, runtime: { inline: runtimeSource }, badge: 'Phone' });
  } else {
    // The preview shows the desktop version, so leave out the phone swap.
    const desk: ExportInfo = {
      ...info,
      hasMobilePoster: false,
      videos: { ...info.videos, mobile: info.videos.mobile && !info.videos.mp4 && !info.videos.webm },
    };
    html = demoPage(desk, { mode: 'video', resolve, runtime: { inline: runtimeSource }, badge: 'After: ScrollPrep' });
  }
  el.preview.classList.toggle('is-phone', previewMode === 'phone');
  // A reload that is still pending keeps the place it already remembered.
  afterLoad = { y: afterLoad?.y ?? el.preview.contentWindow?.scrollY ?? 0, seekTo };
  el.preview.srcdoc = html;
}

function renderModes() {
  const modes: [typeof previewMode, string][] = [];
  if (loopResult) {
    modes.push(['after', 'After'], ['before', 'Before']);
  } else if (result) {
    if (hasVideo(result.info)) modes.push(['after', 'After']);
    if (result.info.videos.mobile) modes.push(['phone', 'Phone']);
    if (result.info.frames) modes.push(['frames', 'Frames']);
    modes.push(['before', 'Before']);
  } else {
    return;
  }
  el.previewMode.innerHTML = modes
    .map(
      ([m, label]) =>
        `<label><input type="radio" name="pmode" value="${m}" ${m === previewMode ? 'checked' : ''}/><span>${label}</span></label>`,
    )
    .join('');
}

el.previewMode.addEventListener('change', (e) => {
  previewMode = (e.target as HTMLInputElement).value as typeof previewMode;
  renderPreview();
});

el.length.addEventListener('input', () => {
  const n = Number(el.length.value);
  el.lengthOut.textContent = `${n} screen${n === 1 ? '' : 's'}`;
  zipCache = null;
  renderCode();
});
el.length.addEventListener('change', () => styleChanged(true));

function renderFiles() {
  const r = loopResult ?? result;
  if (!r) return;
  // For a background loop, the before and after file size is the headline.
  const mp4 = loopResult?.files.find((f) => f.path === LOOP_PATHS.mp4);
  if (loopResult && mp4) {
    const saved = Math.max(0, Math.round((1 - mp4.bytes / loopResult.originalBytes) * 100));
    el.savings.innerHTML = `<span class="mono">${formatBytes(loopResult.originalBytes)}</span> → <b class="mono">${formatBytes(mp4.bytes)}</b>${saved > 0 ? ` <span class="pill pill--ok">${saved}% smaller</span>` : ''}`;
    show(el.savings);
  } else {
    show(el.savings, false);
  }
  el.files.innerHTML = r.files
    .map((f) => {
      const rating = f.target ? pill(rateSize(f.bytes, f.target)) : '';
      const advice = f.target && rateSize(f.bytes, f.target) !== 'ok' ? `<small>${budgetAdvice(rateSize(f.bytes, f.target), f.target)}</small>` : '';
      return `<li><div><b>${escapeHtml(f.label)}</b><code>${escapeHtml(f.path)}</code>${advice}</div><span class="mono">${formatBytes(f.bytes)}</span>${rating}</li>`;
    })
    .join('');
  el.notes.innerHTML = r.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('');
  el.elapsed.textContent = `Done in ${formatTime(r.elapsedMs / 1000)}`;
}

function codeFor(tab: string): string {
  if (loopResult) {
    if (tab === 'embed') return loopEmbed(loopResult.info);
    if (tab === 'css') return LOOP_CSS;
    if (tab === 'script') return LOOP_SCRIPT;
    return loopResult.commands.join('\n');
  }
  const info = currentInfo();
  if (tab === 'embed') return hasVideo(info) ? videoEmbed(info) : framesEmbed(info);
  if (tab === 'frames') return framesEmbed(info);
  if (tab === 'script') return `<!-- Add once, just before </body> -->\n${scriptTag()}`;
  return result!.commands.join('\n');
}

function renderCode() {
  let tabs: [string, string][];
  if (loopResult) {
    tabs = [['embed', 'HTML'], ['css', 'CSS'], ['script', 'Reduced motion'], ['ffmpeg', 'ffmpeg version']];
    el.codeIntro.innerHTML = 'Copy the <code>background</code> folder from the zip next to your page. Put this HTML inside the section it should fill, and add the CSS.';
  } else if (result) {
    tabs = [['embed', hasVideo(result.info) ? 'Video embed' : 'Frames embed']];
    if (hasVideo(result.info) && result.info.frames) tabs.push(['frames', 'Frames embed']);
    tabs.push(['script', 'Script tag'], ['ffmpeg', 'ffmpeg version']);
    el.codeIntro.innerHTML = 'Copy the <code>scrollprep</code> folder from the zip next to your page, then paste this where the effect should go.';
  } else {
    return;
  }
  el.tabs.innerHTML = tabs
    .map(([id, label]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === codeTab}">${label}</button>`)
    .join('');
  el.code.textContent = codeFor(codeTab);
}

el.tabs.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (!t) return;
  codeTab = t.dataset.tab!;
  renderCode();
});

el.copy.addEventListener('click', async () => {
  const text = el.code.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  el.copy.textContent = 'Copied';
  setTimeout(() => (el.copy.textContent = 'Copy'), 1500);
});

el.download.addEventListener('click', async () => {
  if (!result && !loopResult) return;
  const length = Number(el.length.value) || 3;
  el.download.disabled = true;
  el.download.textContent = 'Packing…';
  try {
    if (!zipCache || zipCache.length !== length) {
      const { buildZip, buildLoopZip } = await engine();
      const blob = loopResult ? await buildLoopZip(loopResult) : await buildZip({ ...result!, info: currentInfo() }, runtimeSource);
      zipCache = { length, blob };
    }
    const title = (loopResult ?? result)!.info.title;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipCache.blob);
    a.download = `${title.replace(/[^\w.-]+/g, '-')}-${loopResult ? 'background' : 'scrollprep'}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  } catch (e) {
    showError("Couldn't build the zip.", String(e));
  } finally {
    el.download.disabled = false;
    el.download.textContent = 'Download zip';
  }
});

el.again.addEventListener('click', () => {
  el.settings.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function renderResults() {
  // The effect styling (layouts, text, timeline) only applies to scroll videos.
  show(el.design, !loopResult);
  el.previewHint.innerHTML = loopResult
    ? 'Your loop plays behind a sample headline. Switch to <b>Before</b> to see the original file.'
    : 'Scroll inside the box. Switch to <b>Before</b> to feel the difference.';
  renderModes();
  renderPreview();
  renderFiles();
  renderCode();
}

// ---------- explainer graphic ----------

for (const cells of document.querySelectorAll<HTMLElement>('.strip__cells')) {
  const every = Number(cells.dataset.key);
  cells.innerHTML = Array.from({ length: 30 }, (_, i) => `<i class="${i % every === 0 ? 'key' : ''}"></i>`).join('');
}

