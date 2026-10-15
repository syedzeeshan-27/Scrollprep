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
import { demoPage, escapeHtml, framesEmbed, hasVideo, PATHS, scriptTag, videoEmbed, type ExportInfo } from './core/snippets';
import { AbortedError, FriendlyError } from './engine/errors';
import type { PipelineResult, ProbeResult } from './engine';

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
};

// ---------- state ----------

let source: ProbeResult | null = null;
let sourceUrl: string | null = null;
let result: PipelineResult | null = null;
let resultUrls: Map<string, string> = new Map();
let frameUrls: string[] = [];
let controller: AbortController | null = null;
let zipCache: { length: number; blob: Blob } | null = null;
let previewMode: 'after' | 'before' | 'frames' = 'after';
let codeTab = 'embed';

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
  return s;
}

function pill(level: BudgetLevel): string {
  const text = level === 'ok' ? 'Light' : level === 'heavy' ? 'Heavy' : 'Too heavy';
  return `<span class="pill pill--${level}">${text}</span>`;
}

function renderEstimate() {
  if (!source) return;
  const s = readSettings();
  const range = clipRange(source.duration, s.trimStart, s.trimEnd);
  const secs = range.end - range.start;
  const main = fitSize(source, s.maxShortSide);
  const rows: string[] = [];
  const row = (label: string, bytes: number, target: Target) =>
    rows.push(`<li><span>${label}</span><span class="mono">≈ ${formatBytes(bytes)}</span>${pill(rateSize(bytes, target))}</li>`);
  if (s.outputs.mp4) row(`Main video, ${main.width}×${main.height}`, estimateBytes(videoBitrate(main, s.fps, s.quality, 'avc'), secs), 'desktop');
  if (s.outputs.mobile) {
    const m = fitSize(source, MOBILE_SHORT_SIDE);
    if (m.width < main.width || !s.outputs.mp4) {
      row(`Phone video, ${m.width}×${m.height}`, estimateBytes(videoBitrate(m, s.fps, s.quality, 'avc'), secs), 'mobile');
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
}

el.settings.addEventListener('input', renderEstimate);
el.settings.addEventListener('change', renderEstimate);

// ---------- loading a file ----------

function revoke() {
  for (const u of resultUrls.values()) URL.revokeObjectURL(u);
  for (const u of frameUrls) URL.revokeObjectURL(u);
  resultUrls = new Map();
  frameUrls = [];
  zipCache = null;
}

function resetAll() {
  controller?.abort();
  revoke();
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  source = null;
  sourceUrl = null;
  result = null;
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
  revoke();
  result = null;
  show(el.results, false);
  show(el.error, false);
  show(el.progress);
  el.go.disabled = true;
  controller = new AbortController();
  const p = source;
  const { runPipeline, commandsFor } = await engine();
  try {
    result = await runPipeline(
      p,
      s,
      (st) => {
        const pct = Math.round(st.overall * 100);
        el.progressLabel.textContent = st.label;
        el.progressStep.textContent = `Step ${st.step} of ${st.steps}`;
        el.progressPct.textContent = `${pct}%`;
        el.bar.style.width = `${pct}%`;
      },
      controller.signal,
    );
    for (const f of result.files) if (f.blob) resultUrls.set(f.path, URL.createObjectURL(f.blob));
    frameUrls = result.frames.map((b) => URL.createObjectURL(b));
    previewMode = hasVideo(result.info) ? 'after' : 'frames';
    codeTab = 'embed';
    renderResults();
    show(el.results);
    el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (err instanceof AbortedError || controller?.signal.aborted) {
      showError('Cancelled. Change the settings and try again whenever you like.');
    } else if (err instanceof FriendlyError) {
      showError(err.message, err.detail, commandsFor(p, s));
    } else {
      console.error(err);
      showError('Something went wrong while converting.', String(err), commandsFor(p, s));
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
  return { ...result!.info, scrollLength: Number(el.length.value) || 3 };
}

function renderPreview() {
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
  } else {
    // The preview shows the desktop version, so leave out the phone swap.
    const desk: ExportInfo = { ...info, videos: { ...info.videos, mobile: info.videos.mobile && !info.videos.mp4 && !info.videos.webm } };
    html = demoPage(desk, { mode: 'video', resolve, runtime: { inline: runtimeSource }, badge: 'After: ScrollPrep' });
  }
  el.preview.srcdoc = html;
}

function renderModes() {
  if (!result) return;
  const modes: [typeof previewMode, string][] = [];
  if (hasVideo(result.info)) modes.push(['after', 'After']);
  if (result.info.frames) modes.push(['frames', 'Frames']);
  modes.push(['before', 'Before']);
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
el.length.addEventListener('change', renderPreview);

function renderFiles() {
  if (!result) return;
  el.files.innerHTML = result.files
    .map((f) => {
      const rating = f.target ? pill(rateSize(f.bytes, f.target)) : '';
      const advice = f.target && rateSize(f.bytes, f.target) !== 'ok' ? `<small>${budgetAdvice(rateSize(f.bytes, f.target), f.target)}</small>` : '';
      return `<li><div><b>${escapeHtml(f.label)}</b><code>${escapeHtml(f.path)}</code>${advice}</div><span class="mono">${formatBytes(f.bytes)}</span>${rating}</li>`;
    })
    .join('');
  el.notes.innerHTML = result.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('');
  el.elapsed.textContent = `Done in ${formatTime(result.elapsedMs / 1000)}`;
}

function codeFor(tab: string): string {
  const info = currentInfo();
  if (tab === 'embed') return hasVideo(info) ? videoEmbed(info) : framesEmbed(info);
  if (tab === 'frames') return framesEmbed(info);
  if (tab === 'script') return `<!-- Add once, just before </body> -->\n${scriptTag()}`;
  return result!.commands.join('\n');
}

function renderCode() {
  if (!result) return;
  const tabs: [string, string][] = [['embed', hasVideo(result.info) ? 'Video embed' : 'Frames embed']];
  if (hasVideo(result.info) && result.info.frames) tabs.push(['frames', 'Frames embed']);
  tabs.push(['script', 'Script tag'], ['ffmpeg', 'ffmpeg version']);
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
  if (!result) return;
  const length = Number(el.length.value) || 3;
  el.download.disabled = true;
  el.download.textContent = 'Packing…';
  try {
    if (!zipCache || zipCache.length !== length) {
      const { buildZip } = await engine();
      zipCache = { length, blob: await buildZip({ ...result, info: currentInfo() }, runtimeSource) };
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipCache.blob);
    a.download = `${result.info.title.replace(/[^\w.-]+/g, '-')}-scrollprep.zip`;
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

