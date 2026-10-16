import { zipSync, type Zippable } from 'fflate';
import { frameFileName } from '../core/settings';
import { demoPage, PATHS, readme } from '../core/snippets';
import type { PipelineResult } from './pipeline';
import type { LoopResult } from './loop';
import { loopDemoPage, loopReadme } from '../core/loop';

const text = (s: string) => new TextEncoder().encode(s);

/** The background-loop zip: videos, poster, a demo page and the readme. */
export async function buildLoopZip(result: LoopResult): Promise<Blob> {
  const entries: Zippable = {};
  for (const f of result.files) {
    if (f.blob) entries[f.path] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  entries['demo.html'] = [text(loopDemoPage(result.info, (p) => p)), { level: 6 }];
  entries['README.txt'] = [text(loopReadme(result.info, result.commands)), { level: 6 }];
  return new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/**
 * Packs everything into one zip. Media is stored as-is (it is already compressed), text files are
 * deflated.
 */
export async function buildZip(result: PipelineResult, runtimeSource: string): Promise<Blob> {
  const entries: Zippable = {};
  const put = async (path: string, blob: Blob) => {
    entries[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  };

  for (const f of result.files) if (f.blob) await put(f.path, f.blob);
  const ext = result.info.frames?.ext ?? 'webp';
  for (let i = 0; i < result.frames.length; i++) await put(PATHS.frames + frameFileName(i, ext), result.frames[i]);

  const hasVideo = result.info.videos.mp4 || result.info.videos.mobile || result.info.videos.webm;
  entries[PATHS.runtime] = [text(runtimeSource), { level: 6 }];
  entries['demo.html'] = [
    text(demoPage(result.info, { mode: hasVideo ? 'video' : 'frames', runtime: { src: PATHS.runtime } })),
    { level: 6 },
  ];
  if (hasVideo && result.info.frames) {
    entries['demo-frames.html'] = [
      text(demoPage(result.info, { mode: 'frames', runtime: { src: PATHS.runtime } })),
      { level: 6 },
    ];
  }
  entries['README.txt'] = [text(readme(result.info, result.commands)), { level: 6 }];

  const bytes = zipSync(entries);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}
