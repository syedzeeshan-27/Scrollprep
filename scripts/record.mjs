// Records the README demo GIFs: the app converting a clip, and each example site being scrolled.
// Run scripts/showcase.mjs first so the example media exists.
//
//   node scripts/record.mjs [name ...]     (needs Chrome or Edge, plus ffmpeg on PATH)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const root = resolve(import.meta.dirname, '..');
const media = join(root, 'docs', 'media');
const work = join(root, '.showcase', 'frames');
mkdirSync(media, { recursive: true });

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH.');

const FPS = 12;
const STEP = 1 / FPS;
const base = 'http://localhost:4319/';

/** Collects screenshots, each with how long it stays on screen, then encodes a GIF. */
class Reel {
  constructor(name, page, clip) {
    this.name = name;
    this.page = page;
    this.clip = clip;
    this.dir = join(work, name);
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
  }
  async shot(duration = STEP) {
    const file = `${String(this.frames.length + 1).padStart(4, '0')}.jpg`;
    await this.page.screenshot({ path: join(this.dir, file), type: 'jpeg', quality: 92, clip: this.clip });
    this.frames.push({ file, duration });
  }
  hold(seconds) {
    if (this.frames.length) this.frames[this.frames.length - 1].duration += seconds;
  }
  encode(width, colors = 128) {
    const list = this.frames.map((f) => `file '${f.file}'\nduration ${f.duration.toFixed(4)}`).join('\n');
    const last = this.frames[this.frames.length - 1].file;
    writeFileSync(join(this.dir, 'list.txt'), `${list}\nfile '${last}'\n`);
    const out = join(media, `${this.name}.gif`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(this.dir, 'list.txt'),
      '-vf', `fps=${FPS},scale=${width}:-2:flags=lanczos,hqdn3d=4:4:0.01:0.01,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
      out,
    ]);
    console.log(`   ${this.name}.gif  ${this.frames.length} shots, ${(statSync(out).size / 1048576).toFixed(2)} MB`);
  }
}

/** Waits for the scroll player to catch up with the scroll position. */
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((done) => {
        const v = document.querySelector('.scrollscrub__media');
        const start = performance.now();
        const tick = () => {
          if ((!v || !v.seeking) && performance.now() - start > 60) done();
          else if (performance.now() - start > 600) done();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function scrollTo(page, y) {
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await settle(page);
}

/** Scrolls from one position to another over `count` shots with an ease in and out. */
async function scrollShots(reel, from, to, count) {
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await scrollTo(reel.page, from + (to - from) * e);
    await reel.shot();
  }
}

async function openExample(context, id) {
  const page = await context.newPage();
  await page.goto(`${base}examples/${id}/index.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.readyState >= 3;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}

const sectionEnd = (page) =>
  page.evaluate(() => {
    const s = document.querySelector('[data-scrollscrub]');
    return { top: s.offsetTop, end: s.offsetTop + s.offsetHeight - innerHeight };
  });

/** A scroll-effect example: hold on the hero, scroll into the effect, scrub all the way through. */
async function recordScroll(context, id, { width = 640, intro = 16, through = 84, colors = 128 } = {}) {
  console.log(`== ${id}`);
  const page = await openExample(context, id);
  const reel = new Reel(id, page);
  const { top, end } = await sectionEnd(page);
  await scrollTo(page, 0);
  await reel.shot(1.0);
  await scrollShots(reel, 0, top, intro);
  await scrollShots(reel, top, end, through);
  reel.hold(1.0);
  reel.encode(width, colors);
  await page.close();
}

async function recordLoop(context, id, { width = 640, seconds = 6 } = {}) {
  console.log(`== ${id}`);
  const page = await openExample(context, id);
  const reel = new Reel(id, page);
  // Real time: the background video plays on its own, so each shot lasts as long as it took.
  let last = performance.now();
  const stop = last + seconds * 1000;
  while (performance.now() < stop) {
    await reel.shot(0);
    const now = performance.now();
    reel.frames[reel.frames.length - 1].duration = (now - last) / 1000;
    last = now;
  }
  reel.encode(width);
  await page.close();
}

/**
 * All five effects side by side, driven by one scroll. Each tile is a small page with the coast clip,
 * rendered at 800x500 and shown at half size, so the split layout still gets its wide-screen look.
 */
const EFFECT_TILES = [
  ['full', 'rise', 'Full screen'],
  ['card', 'rise', 'Card grows'],
  ['split', 'rise', 'Split'],
  ['reveal', 'words', 'Circle reveal'],
  ['zoom', 'blur', 'Zoom out'],
  ['full', 'mask', 'Text: slide from mask'],
];

function tilePage(layout, style, label) {
  const attrs = `${layout === 'full' ? '' : ` data-layout="${layout}"`}${style === 'rise' ? '' : ` data-caption-style="${style}"`}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html{background:#09090c;color:#ededf2;font-family:system-ui,sans-serif}body{margin:0}
    .scrollscrub__caption{font-size:44px}
  </style></head><body>
  <section class="scrollscrub" data-scrollscrub${attrs} style="--scrollscrub-length:300vh;--scrollscrub-ratio:1.7778">
    <div class="scrollscrub__stage"><div class="scrollscrub__frame">
      <video class="scrollscrub__media" muted playsinline preload="auto" src="/examples/coast/scrollprep/video.mp4"></video>
    </div><div class="scrollscrub__captions"><div class="scrollscrub__caption" data-at="0.3">${label}</div></div></div>
  </section><div style="height:40px"></div>
  <script src="/examples/coast/scrollprep/scrollscrub.js"></script></body></html>`;
}

async function recordEffects(context) {
  console.log('== effects');
  const page = await context.newPage();
  await page.goto(base);
  const tiles = EFFECT_TILES.map(([l, s, label]) => ({ html: tilePage(l, s, label), label: label.replace('Text: ', 'Text · ') }));
  await page.evaluate((tiles) => {
    document.open();
    document.write(`<!doctype html><html><head><style>
      html,body{margin:0;background:#09090c;color:#ededf2;font-family:system-ui,sans-serif}
      .grid{display:grid;grid-template-columns:repeat(3,400px);gap:22px 20px;justify-content:center;padding:34px 0}
      .tile{width:400px}.clip{width:400px;height:250px;overflow:hidden;border-radius:14px;border:1px solid #23232c}
      iframe{width:800px;height:500px;border:0;transform:scale(.5);transform-origin:0 0}
      .tile b{display:block;margin-top:10px;font-size:17px;font-weight:650;letter-spacing:-.01em}
    </style></head><body><div class="grid">${tiles
      .map((t, i) => `<div class="tile"><div class="clip"><iframe id="t${i}"></iframe></div><b>${t.label}</b></div>`)
      .join('')}</div></body></html>`);
    document.close();
    tiles.forEach((t, i) => (document.getElementById(`t${i}`).srcdoc = t.html));
  }, tiles);
  const frames = () => page.frames().filter((f) => f !== page.mainFrame());
  await page.waitForFunction(() =>
    [...document.querySelectorAll('iframe')].every((f) => f.contentDocument?.querySelector('video')?.readyState >= 3),
    null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const scrollAll = async (p) => {
    await Promise.all(frames().map((f) => f.evaluate((p) => {
      const s = document.querySelector('[data-scrollscrub]');
      window.scrollTo(0, (s.offsetHeight - innerHeight) * p);
    }, p)));
    await Promise.all(frames().map((f) => f.evaluate(() => new Promise((done) => {
      const v = document.querySelector('video');
      const t0 = performance.now();
      const tick = () => (!v.seeking && performance.now() - t0 > 60) || performance.now() - t0 > 600 ? done() : requestAnimationFrame(tick);
      requestAnimationFrame(tick);
    }))));
  };
  const height = await page.evaluate(() => Math.ceil(document.querySelector('.grid').getBoundingClientRect().bottom));
  const reel = new Reel('effects', page, { x: 0, y: 0, width: 1280, height });
  await scrollAll(0);
  await reel.shot(0.8);
  for (let i = 1; i <= 80; i++) {
    const t = i / 80;
    await scrollAll(t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    await reel.shot();
  }
  reel.hold(1.2);
  reel.encode(640, 96);
  await page.close();
}

/** The ScrollPrep homepage: header loop, then scrolling through the built-in demo. */
async function recordLanding(context) {
  console.log('== landing');
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.querySelector('.demo__scrub video')?.readyState >= 3, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const reel = new Reel('landing', page);
  const { top, end } = await page.evaluate(() => {
    const s = document.querySelector('.demo__scrub');
    return { top: s.offsetTop, end: s.offsetTop + s.offsetHeight - innerHeight };
  });
  await reel.shot(0.9);
  await scrollShots(reel, 0, top, 16);
  await scrollShots(reel, top, end, 84);
  reel.hold(1.0);
  reel.encode(640);
  await page.close();
}

/** The animated keyframe strip in "Why normal videos stutter", recorded in real time. */
async function recordStrip(context) {
  console.log('== how-it-works');
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  const clip = await page.evaluate(() => {
    const s = document.querySelector('.strips');
    s.scrollIntoView({ block: 'center' });
    const a = s.getBoundingClientRect();
    const b = document.querySelector('.legend').getBoundingClientRect();
    return { x: a.left - 16, y: a.top - 16, width: a.width + 32, height: b.bottom - a.top + 32 };
  });
  // Start at the beginning of a sweep so the GIF loops cleanly.
  await page.waitForFunction(() => document.querySelector('.strip__cells i.on') === document.querySelector('.strip__cells i'), null, { timeout: 10000, polling: 5 });
  const reel = new Reel('how-it-works', page, clip);
  let last = performance.now();
  const stop = last + 38 * 120;
  while (performance.now() < stop) {
    await reel.shot(0);
    const now = performance.now();
    reel.frames[reel.frames.length - 1].duration = (now - last) / 1000;
    last = now;
  }
  reel.encode(720, 64);
  await page.close();
}

/** The side-by-side stutter comparison, straight from the launch video's screen recording. */
function encodeBeforeAfter() {
  console.log('== before-after');
  const src = join(root, '.showcase', 'launch', '1-compare.mp4');
  if (!existsSync(src)) throw new Error('Run scripts/launch-clip.mjs first: it records the comparison.');
  const out = join(media, 'before-after.gif');
  // The recording fades in and out for the launch video. Trim that off so the GIF loops without a black flash.
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.35', '-to', '7.4', '-i', src,
    '-vf', 'fps=15,scale=720:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    out,
  ]);
  console.log(`   before-after.gif  ${(statSync(out).size / 1048576).toFixed(2)} MB`);
}

/** The app itself: drop a clip, convert it, scroll the live preview, show the files and code. */
async function recordApp(context) {
  console.log('== app');
  const page = await context.newPage();
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  const reel = new Reel('app', page);
  await reel.shot(1.2);
  await page.setInputFiles('#file', join(root, '.showcase', 'clips', 'camera.mp4'));
  await page.waitForSelector('#settings:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(600);
  await reel.shot(0.6);
  const settingsTop = await page.evaluate(() => document.querySelector('#source').getBoundingClientRect().top + scrollY - 70);
  await scrollShots(reel, 0, settingsTop, 10);
  await page.click('input[name=fps][value="24"]', { force: true });
  await reel.shot(0.8);
  const goTop = await page.evaluate(() => document.querySelector('#go').getBoundingClientRect().bottom + scrollY - innerHeight + 60);
  await scrollShots(reel, settingsTop, Math.max(settingsTop, goTop), 8);
  await reel.shot(0.6);
  await page.click('#go');
  // Conversion: one shot every 400 ms, played back faster.
  while (!(await page.isVisible('#results'))) {
    if (await page.isVisible('#error')) throw new Error(await page.textContent('#error'));
    await page.waitForTimeout(400);
    const progressTop = await page.evaluate(() => {
      const p = document.querySelector('#progress');
      return p.hidden ? null : p.getBoundingClientRect().top + scrollY - innerHeight / 2;
    });
    if (progressTop !== null) await page.evaluate((y) => window.scrollTo(0, y), progressTop);
    await reel.shot(STEP * 2);
  }
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('video')?.readyState >= 3, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const from = await page.evaluate(() => scrollY);
  const previewTop = await page.evaluate(() => document.querySelector('#preview').getBoundingClientRect().top + scrollY - 90);
  await scrollShots(reel, from, previewTop, 12);
  reel.hold(0.6);
  // Scroll inside the preview frame.
  const frame = await (await page.$('#preview')).contentFrame();
  const range = await frame.evaluate(() => {
    const s = document.querySelector('[data-scrollscrub]');
    return { top: s.offsetTop, end: s.offsetTop + s.offsetHeight - innerHeight };
  });
  const inner = async (a, b, count) => {
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await frame.evaluate((y) => window.scrollTo(0, y), a + (b - a) * e);
      await page.waitForTimeout(90);
      await reel.shot();
    }
  };
  await inner(0, range.top, 14);
  await inner(range.top, range.end, 70);
  reel.hold(0.6);
  const filesTop = await page.evaluate(() => document.querySelector('#files').getBoundingClientRect().top + scrollY - 140);
  await scrollShots(reel, previewTop, filesTop, 14);
  reel.hold(1.6);
  reel.encode(720, 128);
  await page.close();
}

console.log('Building…');
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4319, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath, headless: true });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const jobs = {
  app: () => recordApp(desktop),
  camera: () => recordScroll(desktop, 'camera'),
  coffee: () => recordScroll(desktop, 'coffee', { through: 72 }),
  coast: () => recordScroll(desktop, 'coast', { width: 600, through: 76 }),
  retreat: () => recordLoop(desktop, 'retreat', { width: 560, seconds: 4.5 }),
  watch: () => recordScroll(desktop, 'watch', { through: 76 }),
  // Rippling water is hard on GIF compression. Keep all the colours (fewer looks muddy), go a bit narrower.
  beach: () => recordScroll(desktop, 'beach', { width: 560, through: 72 }),
  effects: () => recordEffects(desktop),
  landing: () => recordLanding(desktop),
  'how-it-works': () => recordStrip(desktop),
  'before-after': async () => encodeBeforeAfter(),
  'coast-phone': async () => {
    const page = await openExample(phone, 'coast');
    const reel = new Reel('coast-phone', page);
    console.log('== coast-phone');
    const { top, end } = await sectionEnd(page);
    await scrollTo(page, 0);
    await reel.shot(0.8);
    await scrollShots(reel, 0, top, 16);
    await scrollShots(reel, top, end, 90);
    reel.hold(0.8);
    reel.encode(300);
    await page.close();
  },
};

const only = process.argv.slice(2);
for (const [name, job] of Object.entries(jobs)) {
  if (!only.length || only.includes(name)) await job();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));
