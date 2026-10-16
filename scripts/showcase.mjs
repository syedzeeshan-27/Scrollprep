// Builds the example sites in public/examples from free Pexels clips.
// Each clip goes through the real app (headless Chrome), and the media folder from the downloaded
// zip is copied next to the hand-written example page.
//
//   node scripts/showcase.mjs          (needs Chrome or Edge, and curl)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';

const root = resolve(import.meta.dirname, '..');
const clips = join(root, '.showcase', 'clips');
mkdirSync(clips, { recursive: true });

const pick = (name, value) => async (page) => page.click(`input[name=${name}][value="${value}"]`, { force: true });

export const EXAMPLES = [
  {
    id: 'camera',
    clip: 'https://videos.pexels.com/video-files/29902812/12835805_1080_1080_60fps.mp4',
    folder: 'scrollprep',
    setup: [pick('fps', 24)],
  },
  {
    id: 'coffee',
    clip: 'https://videos.pexels.com/video-files/19157857/19157857-hd_2048_1080_60fps.mp4',
    folder: 'scrollprep',
    trim: [1, 9],
    setup: [pick('size', 720), pick('fps', 24), async (page) => page.uncheck('input[name=mobile]')],
  },
  {
    id: 'coast',
    clip: 'https://videos.pexels.com/video-files/38265735/16247643_1920_1080_60fps.mp4',
    folder: 'scrollprep',
    trim: [0, 7],
    setup: [pick('fps', 24), pick('framing', 'tall')],
  },
  {
    id: 'retreat',
    clip: 'https://videos.pexels.com/video-files/28903385/12510984_1920_1080_60fps.mp4',
    folder: 'background',
    setup: [pick('mode', 'loop'), pick('crossfade', 1)],
  },
];

for (const ex of EXAMPLES) {
  const file = join(clips, `${ex.id}.mp4`);
  if (!existsSync(file)) {
    console.log(`Downloading ${ex.id}…`);
    execFileSync('curl', ['-sSLf', '-A', 'Mozilla/5.0', '-o', file, ex.clip]);
  }
}

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH.');

console.log('Building…');
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4318, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });

const only = process.argv.slice(2);
for (const ex of EXAMPLES) {
  if (only.length && !only.includes(ex.id)) continue;
  console.log(`\n== ${ex.id}`);
  const page = await context.newPage();
  await page.goto('http://localhost:4318/');
  await page.setInputFiles('#file', join(clips, `${ex.id}.mp4`));
  await page.waitForSelector('#settings:not([hidden])', { timeout: 60000 });
  for (const step of ex.setup) await step(page);
  if (ex.trim) {
    await page.fill('input[name=trimStart]', String(ex.trim[0]));
    await page.fill('input[name=trimEnd]', String(ex.trim[1]));
  }
  const t0 = Date.now();
  await page.click('#go');
  await page.waitForSelector('#results:not([hidden]), #error:not([hidden])', { timeout: 600000 });
  if (await page.isVisible('#error')) throw new Error(`${ex.id}: ${await page.textContent('#error')}`);
  console.log(`   converted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const zipPath = join(root, '.showcase', `${ex.id}.zip`);
  await download.saveAs(zipPath);

  const target = join(root, 'public', 'examples', ex.id, ex.folder);
  rmSync(target, { recursive: true, force: true });
  for (const [path, data] of Object.entries(unzipSync(readFileSync(zipPath)))) {
    if (!path.startsWith(`${ex.folder}/`) || path.endsWith('/')) continue;
    const out = join(target, path.slice(ex.folder.length + 1));
    mkdirSync(join(out, '..'), { recursive: true });
    writeFileSync(out, data);
    console.log(`   ${path}  ${(data.length / 1048576).toFixed(2)} MB`);
  }
  // Keep the generated README next to the media: it has the exact embed code and ffmpeg commands.
  const zip = unzipSync(readFileSync(zipPath));
  if (zip['README.txt']) writeFileSync(join(root, '.showcase', `${ex.id}-README.txt`), zip['README.txt']);
  await page.close();
}

await browser.close();
await new Promise((r) => server.httpServer.close(r));
