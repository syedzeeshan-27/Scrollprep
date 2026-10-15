import { zipSync, type Zippable } from 'fflate';
import { frameFileName } from '../core/settings';
import { demoPage, PATHS, readme } from '../core/snippets';
import type { PipelineResult } from './pipeline';

const text = (s: string) => new TextEncoder().encode(s);

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
