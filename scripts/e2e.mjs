// End-to-end check: builds the app, serves it, drives headless Chrome through real conversions,
// downloads each zip and verifies the outputs with ffprobe.
//
//   npm run e2e            (needs Chrome or Edge, plus ffmpeg and ffprobe on PATH)
//   CHROME_PATH=... npm run e2e

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.e2e-out');
const inputs = join(out, 'inputs');
mkdirSync(inputs, { recursive: true });

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH.');

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function makeInput(name, args) {
  const p = join(inputs, name);
  if (!existsSync(p)) ffmpeg([...args, p]);
  return p;
}

const fourK = makeInput('4k-with-audio.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '90', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
]);
const portrait = makeInput('portrait.mov', [
  '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=25:duration=2',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', '-pix_fmt', 'yuv420p',
]);
const notVideo = join(inputs, 'not-a-video.mp4');
writeFileSync(notVideo, 'this is just text pretending to be a video');

function probeVideo(file) {
  const json = JSON.parse(
    run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]),
  );
  const v = json.streams.find((s) => s.codec_type === 'video');
  const keys = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v', '-skip_frame', 'nokey', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ]).trim();
  return {
    width: v.width,
    height: v.height,
    codec: v.codec_name,
    pixFmt: v.pix_fmt,
    frames: Number(v.nb_read_frames),
    keyframes: Number(keys),
    audio: json.streams.some((s) => s.codec_type === 'audio'),
    bytes: Number(json.format.size),
  };
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? '  ok ' : '  FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

function verifyVideo(dir, name, maxShort, expectCodec) {
  const p = join(dir, name);
  if (!existsSync(p)) return check(false, `${name} exists`);
  const v = probeVideo(p);
  console.log(`       ${name}: ${v.width}x${v.height} ${v.codec} ${v.pixFmt} ${v.frames} frames, ${v.keyframes} keyframes, ${(v.bytes / 1048576).toFixed(2)} MB`);
  check(v.codec === expectCodec, `${name} codec is ${expectCodec}`);
  check(v.frames > 0 && v.keyframes === v.frames, `${name} every frame is a keyframe`);
  check(Math.min(v.width, v.height) <= maxShort, `${name} short side <= ${maxShort}`);
  check(v.width % 2 === 0 && v.height % 2 === 0, `${name} even dimensions`);
  check(!v.audio, `${name} has no audio`);
  if (expectCodec === 'h264') check(v.pixFmt === 'yuv420p', `${name} is yuv420p`);
  return v;
}

console.log('Building…');
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4317, strictPort: true }, logLevel: 'warn' });
const base = 'http://localhost:4317/';

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });

/** Scrolls the preview to a fraction of the effect and reads the player's state. */
async function previewAt(page, fraction) {
  const frame = await (await page.$('#preview')).contentFrame();
  await frame.waitForSelector('[data-scrollscrub]');
  await frame.evaluate((f) => {
    const s = document.querySelector('[data-scrollscrub]');
    window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * f);
  }, fraction);
  await page.waitForTimeout(800);
  return frame.evaluate(() => {
    const s = document.querySelector('[data-scrollscrub]');
    return {
      layout: s.dataset.layout ?? 'full',
      grow: Number(s.style.getPropertyValue('--scrollscrub-grow')),
      active: [...document.querySelectorAll('.scrollscrub__caption.is-active')].map((c) => c.textContent),
    };
  });
}

async function pickLayout(page, id) {
  await page.click(`#layout input[value="${id}"]`, { force: true });
  await page.waitForFunction(
    (id) => {
      const doc = document.querySelector('#preview').contentDocument;
      return doc?.readyState === 'complete' && (doc.querySelector('[data-scrollscrub]')?.dataset.layout ?? 'full') === id;
    },
    id,
    { timeout: 10000 },
  );
  // The app restores the preview's scroll position right after it reloads. Let that land first.
  await page.waitForTimeout(300);
}

async function convert(label, { load, setup, expectError, inspect }) {
  console.log(`\n== ${label}`);
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => m.type() === 'error' && logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(String(e)));
  await page.goto(base);
  await load(page);
  if (expectError) {
    await page.waitForSelector('#error:not([hidden])', { timeout: 30000 });
    const text = await page.textContent('#error');
    console.log(`       error shown: ${text.trim().slice(0, 100)}`);
    check(true, 'friendly error shown');
    await page.close();
    return;
  }
  await page.waitForSelector('#settings:not([hidden])', { timeout: 60000 });
  if (setup) await setup(page);
  const t0 = Date.now();
  await page.click('#go');
  await page.waitForSelector('#results:not([hidden]), #error:not([hidden])', { timeout: 300000 });
  if (await page.isVisible('#error')) {
    check(false, `conversion finished: ${(await page.textContent('#error')).trim().slice(0, 300)}`);
    console.log(logs.join('\n'));
    await page.close();
    return;
  }
  console.log(`       converted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // The preview iframe must actually scrub: scroll it and the video time should move.
  await page.waitForFunction(() => !!document.querySelector('#preview').contentDocument?.querySelector('[data-scrollscrub]'), null, { timeout: 15000 }).catch(() => {});
  const frame = await (await page.$('#preview')).contentFrame();
  if (frame) {
    await frame.waitForFunction(() => {
      const v = document.querySelector('video');
      return !v || v.readyState >= 1;
    }, null, { timeout: 15000 });
    await frame.evaluate(() => {
      const s = document.querySelector('[data-scrollscrub]');
      window.scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight) * 0.6);
    });
    await page.waitForTimeout(1500);
    const state = await frame.evaluate(() => {
      const v = document.querySelector('video');
      const c = document.querySelector('canvas');
      return v ? { kind: 'video', t: v.currentTime, d: v.duration } : { kind: 'canvas', w: c?.width ?? 0 };
    });
    if (state.kind === 'video') {
      check(state.t > state.d * 0.3, `preview scrubs (time ${state.t.toFixed(2)} of ${state.d.toFixed(2)} at 60% scroll)`);
    } else {
      check(state.w > 0, 'preview canvas draws');
    }
  } else {
    check(false, 'preview iframe present');
  }
  if (inspect) await inspect(page);

  const name = label.replace(/\W+/g, '-').toLowerCase();
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(pageWidth <= 390, `results fit a phone screen (page width ${pageWidth})`);
  await page.screenshot({ path: join(out, `${name}-phone.png`), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const zipPath = join(out, `${name}.zip`);
  await download.saveAs(zipPath);
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  const files = unzipSync(readFileSync(zipPath));
  for (const [path, data] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, data);
  }
  const names = Object.keys(files);
  check(names.includes('demo.html') && names.includes('README.txt') && names.includes('scrollprep/scrollscrub.js'), 'zip has demo, readme and runtime');
  check(names.includes('scrollprep/poster.jpg'), 'zip has poster');
  check(logs.length === 0, `no console errors${logs.length ? `: ${logs.join(' | ')}` : ''}`);
  await page.close();
  return { dir, names };
}

const setInput = (file) => async (page) => page.setInputFiles('#file', file);

// 1. The sample clip with every output switched on.
const sample = await convert('Sample all outputs', {
  load: async (page) => page.click('#sample'),
  setup: async (page) => {
    await page.check('input[name=webm]');
    await page.check('input[name=frames]');
    await page.fill('input[name=frameCount]', '60');
  },
  inspect: async (page) => {
    // Default example text: the second line (at 55%) shows at 62%, the first (at 10%) at 20%.
    let st = await previewAt(page, 0.62);
    check(st.active.length === 1 && st.active[0] === 'Every detail, considered.', `text at 62% is the second line (${st.active})`);
    st = await previewAt(page, 0.2);
    check(st.active[0] === 'Built to last.', `text at 20% is the first line (${st.active})`);

    await pickLayout(page, 'card');
    st = await previewAt(page, 0.1);
    check(st.grow > 0 && st.grow < 0.5, `card is still small at 10% (grow ${st.grow})`);
    st = await previewAt(page, 0.6);
    check(st.grow === 1, `card fills the screen by 60% (grow ${st.grow})`);

    // Edit the text, then pick split: the code and the zip must follow.
    await page.fill('#captions li:first-child .cap-text', 'Lighter than air');
    await pickLayout(page, 'split');
    st = await previewAt(page, 0.2);
    check(st.layout === 'split' && st.active[0] === 'Lighter than air', `split layout shows the edited text (${st.layout}, ${st.active})`);
    const code = await page.textContent('#code');
    check(code.includes('data-layout="split"') && code.includes('Lighter than air'), 'embed code has the layout and the text');
  },
});
if (sample) {
  verifyVideo(sample.dir, 'scrollprep/video.mp4', 1080, 'h264');
  // The sample is 540p, below the phone size, so no separate phone file is expected.
  check(!sample.names.includes('scrollprep/video-mobile.mp4'), 'no pointless phone copy for a small source');
  verifyVideo(sample.dir, 'scrollprep/video.webm', 1080, 'vp9');
  const frames = sample.names.filter((n) => n.startsWith('scrollprep/frames/'));
  check(frames.length === 60, `60 frames written (got ${frames.length})`);
  check(sample.names.includes('demo-frames.html'), 'frames demo page written');
  const demo = readFileSync(join(sample.dir, 'demo.html'), 'utf8');
  check(demo.includes('data-layout="split"') && demo.includes('Lighter than air'), 'zip demo uses the chosen layout and text');

  // The exported demo, opened straight from disk by someone who has reduced motion switched on.
  const calm = await browser.newContext({ reducedMotion: 'reduce' });
  const cp = await calm.newPage();
  await cp.goto(pathToFileURL(join(sample.dir, 'demo.html')).href);
  await cp.waitForTimeout(500);
  const still = await cp.evaluate(() => ({
    isStatic: document.querySelector('[data-scrollscrub]').classList.contains('scrollscrub--static'),
    shown: [...document.querySelectorAll('.scrollscrub__caption')].every((c) => getComputedStyle(c).opacity === '1'),
  }));
  check(still.isStatic && still.shown, 'reduced motion: still poster with every line of text shown');
  await calm.close();
}

// 2. A 4K clip with sound and default settings: must be capped and silent.
const big = await convert('4K with audio', { load: setInput(fourK) });
if (big) {
  const v = verifyVideo(big.dir, 'scrollprep/video.mp4', 1080, 'h264');
  check(v && v.width === 1920 && v.height === 1080, '4K scaled to exactly 1920x1080');
  const m = verifyVideo(big.dir, 'scrollprep/video-mobile.mp4', 720, 'h264');
  check(m && m.width === 1280 && m.height === 720, 'phone copy is 1280x720');
}

// 3. Portrait MOV at 720p, trimmed, 24 fps.
const tall = await convert('Portrait trimmed', {
  load: setInput(portrait),
  setup: async (page) => {
    await page.check('input[name=size][value="720"]');
    await page.check('input[name=fps][value="24"]');
    await page.uncheck('input[name=mobile]');
    await page.fill('input[name=trimStart]', '0.5');
    await page.fill('input[name=trimEnd]', '1.5');
  },
});
if (tall) {
  const v = verifyVideo(tall.dir, 'scrollprep/video.mp4', 720, 'h264');
  check(v && v.width === 720 && v.height === 1280, 'portrait kept upright at 720x1280');
  check(v && v.frames >= 22 && v.frames <= 26, `trim to 1 s at 24 fps gives about 24 frames (got ${v?.frames})`);
}

// 4. Not a video at all.
await convert('Not a video', { load: setInput(notVideo), expectError: true });

// Phone-width screenshot of the landing page for a visual check.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const pp = await phone.newPage();
await pp.goto(base);
await pp.screenshot({ path: join(out, 'landing-phone.png'), fullPage: true });
const width = await pp.evaluate(() => document.documentElement.scrollWidth);
check(width <= 390, `no sideways scroll on a phone (page width ${width})`);
await phone.close();

await browser.close();
await new Promise((r) => server.httpServer.close(r));

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
