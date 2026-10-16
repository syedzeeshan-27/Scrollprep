import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { frameTimestamps, type Size } from '../core/settings';
import type { FrameExt } from '../core/snippets';
import type { Progress } from './encode';
import { AbortedError, FriendlyError } from './errors';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

let webpSupport: boolean | null = null;

/** Safari can display WebP but cannot encode it from a canvas, so fall back to JPEG there. */
export function imageExt(): FrameExt {
  if (webpSupport === null) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpSupport ? 'webp' : 'jpg';
}

function toBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save frame'))), type, quality),
  );
}

async function openTrack(file: Blob) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new FriendlyError('This file has no video in it.');
  }
  return { input, track };
}

/** Saves one picture per timestamp. */
export async function extractFrames(
  file: Blob,
  size: Size,
  timestamps: number[],
  ext: FrameExt,
  onProgress: Progress,
  signal: AbortSignal,
): Promise<Blob[]> {
  const { input, track } = await openTrack(file);
  const type = ext === 'webp' ? 'image/webp' : 'image/jpeg';
  try {
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: 'fill' });
    const out: Blob[] = [];
    let last: Blob | null = null;
    for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
      if (signal.aborted) throw new AbortedError();
      // A missing frame (rare, at the very start) reuses the previous one so numbering stays intact.
      const blob: Blob | null = wrapped ? await toBlob(wrapped.canvas, type, 0.8) : last;
      if (blob) out.push(blob);
      last = blob;
      onProgress(out.length / timestamps.length);
    }
    if (!out.length) throw new FriendlyError('No frames could be read from this video.');
    while (out.length < timestamps.length) out.push(out[out.length - 1]);
    return out;
  } finally {
    input.dispose();
  }
}

/** Small JPEG stills spread evenly across the clip, for the caption timeline. */
export async function thumbnails(file: Blob, count: number, height: number): Promise<Blob[]> {
  const { input, track } = await openTrack(file);
  try {
    const width = Math.max(2, Math.round((height * track.displayWidth) / track.displayHeight / 2) * 2);
    const sink = new CanvasSink(track, { width, height, fit: 'fill' });
    const [start, end] = await Promise.all([track.getFirstTimestamp(), track.computeDuration()]);
    const out: Blob[] = [];
    let last: Blob | null = null;
    for await (const wrapped of sink.canvasesAtTimestamps(frameTimestamps({ start, end }, count))) {
      const blob: Blob | null = wrapped ? await toBlob(wrapped.canvas, 'image/jpeg', 0.7) : last;
      if (blob) out.push(blob);
      last = blob;
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** A JPEG of the first frame, used before the video loads and for reduced-motion visitors. */
export async function poster(file: Blob, size: Size, time: number): Promise<Blob> {
  const { input, track } = await openTrack(file);
  try {
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: 'fill' });
    const first = await track.getFirstTimestamp();
    const wrapped = (await sink.getCanvas(Math.max(time, first))) ?? (await sink.getCanvas(first));
    if (!wrapped) throw new FriendlyError('Could not read the first frame.');
    return await toBlob(wrapped.canvas, 'image/jpeg', 0.82);
  } finally {
    input.dispose();
  }
}
