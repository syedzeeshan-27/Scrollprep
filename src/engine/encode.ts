import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeVideo,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from 'mediabunny';
import type { CropRect } from '../core/crop';
import type { Range, Size, VideoCodecChoice } from '../core/settings';
import { AbortedError, FriendlyError } from './errors';

export interface EncodeOptions {
  codec: VideoCodecChoice;
  size: Size;
  fps: number;
  bitrate: number;
  range: Range;
  /** Region of the source to keep, in source pixels, applied before resizing. */
  crop?: CropRect;
}

export type Progress = (fraction: number) => void;


export function canEncode(codec: VideoCodecChoice, size: Size, bitrate: number): Promise<boolean> {
  return canEncodeVideo(codec, { width: size.width, height: size.height, quality: new Quality({ bitrate }) }).catch(
    () => false,
  );
}

/**
 * Re-encodes the clip so every frame is a keyframe, at the given size and frame rate, with no audio.
 * Uses the browser's own (often hardware) encoder through WebCodecs.
 */
export async function encodeVideo(file: Blob, o: EncodeOptions, onProgress: Progress, signal: AbortSignal): Promise<Blob> {
  if (signal.aborted) throw new AbortedError();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const format = o.codec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: o.range.start, end: o.range.end },
      audio: { discard: true },
      video: {
        width: o.size.width,
        height: o.size.height,
        fit: 'fill',
        crop: o.crop,
        frameRate: o.fps,
        codec: o.codec,
        // Constant mode: hardware encoders ignore the target in variable mode when every frame is a keyframe.
        quality: new Quality({ bitrate: o.bitrate, bitrateMode: 'constant' }),
        keyFrameInterval: 0, // every frame is a keyframe
        forceTranscode: true,
        allowTransformationMetadata: false,
      },
      tags: {},
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
      throw new FriendlyError("This browser can't convert this video.", reasons);
    }
    const onAbort = () => void conversion.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    conversion.onProgress = (p) => onProgress(p);
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) throw new AbortedError();
    if (!target.buffer) throw new FriendlyError('The encoder produced no output.');
    return new Blob([target.buffer], { type: format.mimeType });
  } catch (e) {
    if (signal.aborted) throw new AbortedError();
    throw e;
  } finally {
    input.dispose();
  }
}
