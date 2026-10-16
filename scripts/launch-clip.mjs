// Makes the launch video (launch/scrollprep-launch.mp4): a side-by-side stutter comparison, the app
// converting a clip, the example sites, and an end card. Everything is recorded in real time with
// Chrome's screencast, then stitched with ffmpeg.
//
//   node scripts/launch-clip.mjs     (run scripts/showcase.mjs first; needs Chrome and ffmpeg)

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const root = resolve(import.meta.dirname, '..');
const work = join(root, '.showcase', 'launch');
const stage = join(work, 'stage');
const outDir = join(root, 'launch');
rmSync(work, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(outDir, { recursive: true });

copyFileSync(join(root, 'scripts', 'launch', 'compare.html'), join(stage, 'index.html'));
copyFileSync(join(root, '.showcase', 'clips', 'camera.mp4'), join(stage, 'original.mp4'));
copyFileSync(join(root, 'public', 'examples', 'camera', 'scrollprep', 'video.mp4'), join(stage, 'scrollprep.mp4'));

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH.');

const BG = '0x09090c';
const W = 1920;
const H = 1080;
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const segments = [];

/** Records the page in real time while `action` runs. Returns frames with how long each one shows. */
async function screencast(page, action, size = { maxWidth: W, maxHeight: 1200 }) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1, ...size });
  const t0 = Date.now() / 1000;
  await action();
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  return frames.map((f, i) => ({
    data: f.data,
    duration: Math.max(0.001, (i + 1 < frames.length ? frames[i + 1].t : t1) - (i === 0 ? Math.min(f.t, t0) : f.t)),
  }));
}

/** Writes frames to disk and encodes them into a 30 fps segment, with an optional filter chain. */
function segment(name, frames, filter = `scale=${W}:${H}:flags=lanczos`, extraInputs = []) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const lines = [];
  frames.forEach((f, i) => {
    const file = `${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(f.data, 'base64'));
    lines.push(`file '${file}'`, `duration ${f.duration.toFixed(4)}`);
  });
  lines.push(lines[lines.length - 2]);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const total = frames.reduce((s, f) => s + f.duration, 0);
  const fade = `fade=in:st=0:d=0.25,fade=out:st=${(total - 0.25).toFixed(3)}:d=0.25`;
  const out = join(work, `${name}.mp4`);
  const inputs = ['-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt')];
  for (const p of extraInputs) inputs.push('-i', p);
  ffmpeg([
    ...inputs,
    '-filter_complex', `[0:v]fps=30,${filter}[v];[v]${fade},format=yuv420p[out]`,
    '-map', '[out]', '-t', total.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', out,
  ]);
  segments.push(out);
  console.log(`   ${name}: ${frames.length} frames, ${total.toFixed(1)} s`);
}

/** A recorded browser view, shrunk onto the dark stage with a caption above it. */
function framed(captionPng) {
  return {
    filter: `scale=1536:960:flags=lanczos,pad=${W}:${H}:192:104:color=${BG}[f];[f][1:v]overlay=0:0`,
    inputs: [captionPng],
  };
}

const FONT = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
const CARD_CSS = `html,body{margin:0;width:${W}px;height:${H}px;font-family:Inter,system-ui,sans-serif;color:#ededf2}
  .grad{background:linear-gradient(90deg,#a78bfa,#22d3ee);-webkit-background-clip:text;color:transparent}`;

async function renderPng(page, name, body, transparent = false) {
  await page.setContent(`<!doctype html><html><head>${FONT}<style>${CARD_CSS}
    html{background:${transparent ? 'transparent' : '#09090c'}}</style></head><body>${body}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const file = join(work, `${name}.png`);
  await page.screenshot({ path: file, omitBackground: transparent });
  return file;
}

function still(name, png, seconds) {
  const out = join(work, `${name}.mp4`);
  ffmpeg([
    '-loop', '1', '-i', png, '-t', String(seconds), '-r', '30',
    '-vf', `fade=in:st=0:d=0.25,fade=out:st=${seconds - 0.25}:d=0.25,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', out,
  ]);
  segments.push(out);
  console.log(`   ${name}: still, ${seconds} s`);
}

const caption = (page, name, text) =>
  renderPng(page, name, `<div style="position:absolute;top:0;left:0;right:0;height:104px;display:flex;align-items:center;justify-content:center;
    font-size:40px;font-weight:700;letter-spacing:-.02em">${text}</div>`, true);

console.log('Building…');
await build({ root, logLevel: 'warn' });
const app = await preview({ root, preview: { port: 4320, strictPort: true }, logLevel: 'warn' });
const stageServer = await preview({ root: stage, build: { outDir: stage }, preview: { port: 4321, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath, headless: true });
const big = await browser.newContext({ viewport: { width: W, height: H } });
const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
const tool = await big.newPage();

// 1. The hook: the same clip scrubbed as a normal video and after ScrollPrep.
console.log('== compare');
{
  const page = await big.newPage();
  await page.goto('http://localhost:4321/');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(500);
  const frames = await screencast(page, () => page.evaluate(() => window.start()), { maxWidth: W, maxHeight: H });
  segment('1-compare', frames);
  await page.close();
}

// 2. Why, in one line.
still('2-why', await renderPng(tool, 'why', `<div style="height:100%;display:grid;place-content:center;text-align:center;padding:0 160px">
  <div style="font-size:30px;color:#9b9bab;font-weight:500;margin-bottom:26px">Normal videos only store a full picture every few seconds.</div>
  <div style="font-size:92px;font-weight:800;letter-spacing:-.04em;line-height:1">ScrollPrep makes <span class="grad">every frame</span> one.</div>
  <div style="font-size:30px;color:#9b9bab;font-weight:500;margin-top:30px">Right in your browser. Nothing gets uploaded.</div></div>`), 3);

// 3. The app: drop a clip, convert it, scroll the preview.
console.log('== app');
{
  const page = await desk.newPage();
  await page.goto('http://localhost:4320/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const smooth = (y, ms) =>
    page.evaluate(([y, ms]) => new Promise((done) => {
      const from = scrollY, t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, from + (y - from) * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
        t < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    }), [y, ms]);
  const part1 = await screencast(page, async () => {
    await page.waitForTimeout(900);
    await page.setInputFiles('#file', join(root, '.showcase', 'clips', 'camera.mp4'));
    await page.waitForSelector('#settings:not([hidden])', { timeout: 60000 });
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => document.querySelector('#go').getBoundingClientRect().bottom + scrollY - innerHeight + 80);
    await smooth(y, 1200);
    await page.waitForTimeout(400);
    await page.click('#go');
  });
  const part2 = await screencast(page, async () => {
    await page.waitForSelector('#results:not([hidden])', { timeout: 300000 });
    await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('video')?.readyState >= 3, null, { timeout: 20000 });
  });
  // Settings play back a bit faster, the conversion six times faster.
  for (const f of part1) f.duration /= 1.5;
  for (const f of part2) f.duration /= 6;
  const part3 = await screencast(page, async () => {
    const y = await page.evaluate(() => document.querySelector('#preview').getBoundingClientRect().top + scrollY - 90);
    await smooth(y, 900);
    await page.waitForTimeout(200);
    const frame = await (await page.$('#preview')).contentFrame();
    await frame.evaluate(() => new Promise((done) => {
      const s = document.querySelector('[data-scrollscrub]');
      const end = s.offsetTop + s.offsetHeight - innerHeight, t0 = performance.now(), ms = 3200;
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, end * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
        t < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    }));
    await page.waitForTimeout(500);
  });
  const f = framed(await caption(tool, 'cap-app', 'Drop a video. Preview it. Get the files and the code.'));
  segment('3-app', [...part1, ...part2, ...part3], f.filter, f.inputs);
  await page.close();
}

// 4. The example sites.
const examples = [
  ['camera', 'Product spin', 3.4],
  ['coffee', 'Text beside the video', 3.2],
  ['coast', 'Card grows to full screen', 3.4],
  ['retreat', 'Background loop: 13 MB → 2.4 MB', 3],
];
for (const [id, text, seconds] of examples) {
  console.log(`== ${id}`);
  const page = await desk.newPage();
  await page.goto(`http://localhost:4320/examples/${id}/index.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 3, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  // Start just above the effect so the clip gets to the good part fast.
  const range = await page.evaluate(() => {
    const s = document.querySelector('[data-scrollscrub]');
    return s ? { from: Math.max(0, s.offsetTop - innerHeight * 0.6), to: s.offsetTop + s.offsetHeight - innerHeight } : { from: 0, to: innerHeight * 0.5 };
  });
  await page.evaluate((y) => window.scrollTo(0, y), range.from);
  await page.waitForTimeout(600);
  const frames = await screencast(page, () =>
    page.evaluate(([a, b, ms]) => new Promise((done) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, a + (b - a) * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2));
        t < 1 ? requestAnimationFrame(step) : setTimeout(done, 300);
      };
      requestAnimationFrame(step);
    }), [range.from, range.to, seconds * 1000]),
  );
  const f = framed(await caption(tool, `cap-${id}`, text));
  segment(`4-${id}`, frames, f.filter, f.inputs);
  await page.close();
}

// 5. End card.
still('5-end', await renderPng(tool, 'end', `<div style="height:100%;display:grid;place-content:center;text-align:center">
  <div style="display:flex;justify-content:center;gap:10px;margin-bottom:34px">
    <i style="width:22px;height:84px;border-radius:8px;background:#7c5cff"></i><i style="width:22px;height:84px;border-radius:8px;background:#a78bfa"></i><i style="width:22px;height:84px;border-radius:8px;background:#22d3ee"></i></div>
  <div style="font-size:120px;font-weight:800;letter-spacing:-.045em;line-height:1">ScrollPrep</div>
  <div style="font-size:34px;color:#9b9bab;font-weight:500;margin-top:22px">Free · open source · runs in your browser</div>
  <div style="font-size:46px;font-weight:700;margin-top:56px" class="grad">scrollprep.vercel.app</div>
  <div style="font-size:26px;color:#9b9bab;margin-top:16px">github.com/syedzeeshan-27/Scrollprep</div></div>`), 3.5);

await browser.close();
await new Promise((r) => app.httpServer.close(r));
await new Promise((r) => stageServer.httpServer.close(r));

const list = join(work, 'segments.txt');
writeFileSync(list, segments.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
const final = join(outDir, 'scrollprep-launch.mp4');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final]);
console.log(`\n${final}  ${(statSync(final).size / 1048576).toFixed(1)} MB`);
