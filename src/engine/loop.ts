import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from 'mediabunny';
import { rateSize } from '../core/budget';
import {
  effectiveFade,
  LOOP_KEYFRAME_SECONDS,
  LOOP_PATHS,
  loopBitrate,
  loopCommands,
  loopFrames,
  type LoopInfo,
  type LoopSettings,
} from '../core/loop';
import { clipRange, fitSize, type Range, type Size } from '../core/settings';
import { canEncode, encodeVideo, type Progress } from './encode';
import { AbortedError, FriendlyError } from './errors';
import { poster } from './frames';
import type { OutputFile, PipelineState } from './pipeline';
import type { ProbeResult } from './probe';

export interface LoopResult {
  kind: 'loop';
  files: OutputFile[];
  info: LoopInfo;
  notes: string[];
  commands: string[];
  elapsedMs: number;
  /** Size of the file the user dropped in, for the before and after. */
  originalBytes: number;
}

interface LoopEncode {
  codec: 'avc' | 'vp9';
  size: Size;
  fps: number;
  bitrate: number;
  range: Range;
  fade: number;
}

/**
 * Draws every output frame itself: the main picture, with the clip's opening blended over it in
 * the last `fade` seconds, then hands the canvas to the encoder.
 */
async function encodeCrossfade(file: Blob, o: LoopEncode, onProgress: Progress, signal: AbortSignal): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new FriendlyError('This file has no video in it.');
    const frames = loopFrames(o.range, o.fade, o.fps);
    const sinkOpts = { width: o.size.width, height: o.size.height, fit: 'fill' as const };
    const mains = new CanvasSink(track, sinkOpts).canvasesAtTimestamps(frames.map((f) => f.main));
    const heads = new CanvasSink(track, sinkOpts).canvasesAtTimestamps(
      frames.filter((f) => f.head !== null).map((f) => f.head!),
    );

    const canvas = document.createElement('canvas');
    canvas.width = o.size.width;
    canvas.height = o.size.height;
    const ctx = canvas.getContext('2d')!;
    const format = o.codec === 'avc' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const source = new CanvasSource(canvas, {
      codec: o.codec,
      quality: new Quality({ bitrate: o.bitrate, bitrateMode: 'variable' }),
      keyFrameInterval: LOOP_KEYFRAME_SECONDS,
    });
    output.addVideoTrack(source, { frameRate: o.fps });
    await output.start();

    let lastMain: CanvasImageSource | null = null;
    for (let i = 0; i < frames.length; i++) {
      if (signal.aborted) {
        await output.cancel();
        throw new AbortedError();
      }
      const f = frames[i];
      const main = (await mains.next()).value;
      const mainCanvas: CanvasImageSource | null = main ? main.canvas : lastMain;
      if (mainCanvas) ctx.drawImage(mainCanvas, 0, 0, o.size.width, o.size.height);
      lastMain = mainCanvas;
      if (f.head !== null) {
        const head = (await heads.next()).value;
        if (head) {
          ctx.globalAlpha = f.weight;
          ctx.drawImage(head.canvas, 0, 0, o.size.width, o.size.height);
          ctx.globalAlpha = 1;
        }
      }
      await source.add(f.t, 1 / o.fps);
      onProgress((i + 1) / frames.length);
    }
    await mains.return(undefined);
    await heads.return(undefined);
    await output.finalize();
    if (!target.buffer) throw new FriendlyError('The encoder produced no output.');
    return new Blob([target.buffer], { type: format.mimeType });
  } finally {
    input.dispose();
  }
}

function encodeLoop(file: Blob, o: LoopEncode, onProgress: Progress, signal: AbortSignal): Promise<Blob> {
  if (o.fade > 0) return encodeCrossfade(file, o, onProgress, signal);
  return encodeVideo(
    file,
    {
      codec: o.codec,
      size: o.size,
      fps: o.fps,
      bitrate: o.bitrate,
      range: o.range,
      keyFrameInterval: LOOP_KEYFRAME_SECONDS,
      bitrateMode: 'variable',
    },
    onProgress,
    signal,
  );
}

function planLoop(p: ProbeResult, s: LoopSettings) {
  const range = clipRange(p.duration, s.trimStart, s.trimEnd);
  const size = fitSize({ width: p.width, height: p.height }, s.maxShortSide);
  const fade = effectiveFade(range, s.crossfade);
  return { range, size, fade };
}

export function loopCommandsFor(p: ProbeResult, s: LoopSettings): string[] {
  const { range, size, fade } = planLoop(p, s);
  return loopCommands({ inputName: p.file.name, range, fade, fps: s.fps, size, webm: s.webm });
}

export async function runLoop(
  p: ProbeResult,
  s: LoopSettings,
  onState: (state: PipelineState) => void,
  signal: AbortSignal,
): Promise<LoopResult> {
  const started = performance.now();
  const { range, size, fade } = planLoop(p, s);
  const notes: string[] = [];
  const files: OutputFile[] = [];
  const mp4Bitrate = loopBitrate(size, s.fps, s.quality, 'avc');
  if (!(await canEncode('avc', size, mp4Bitrate))) {
    throw new FriendlyError(
      "This browser can't encode MP4 video. Try a recent Chrome, Edge or Safari, or use the ffmpeg commands below.",
    );
  }
  const webm = s.webm && (await canEncode('vp9', size, loopBitrate(size, s.fps, s.quality, 'vp9')));
  if (s.webm && !webm) notes.push("This browser can't encode WebM, so it was skipped. The MP4 works everywhere.");
  if (s.crossfade > fade) notes.push(`The clip is short, so the crossfade was shortened to ${fade.toFixed(2)} s.`);

  const steps: { label: string; weight: number; run: (pr: Progress) => Promise<void> }[] = [
    {
      label: 'Saving the poster image',
      weight: 0.05,
      run: async () => {
        const blob = await poster(p.file, size, range.start + fade);
        files.push({ path: LOOP_PATHS.poster, blob, bytes: blob.size, label: 'Poster image', target: null });
      },
    },
    {
      label: fade > 0 ? 'Making the seamless MP4 loop' : 'Making the MP4 loop',
      weight: 1,
      run: async (pr) => {
        const blob = await encodeLoop(p.file, { codec: 'avc', size, fps: s.fps, bitrate: mp4Bitrate, range, fade }, pr, signal);
        files.push({ path: LOOP_PATHS.mp4, blob, bytes: blob.size, label: `MP4 loop (${size.width}×${size.height})`, target: 'background' });
      },
    },
  ];
  if (webm) {
    steps.push({
      label: 'Making the WebM loop',
      weight: 1.5,
      run: async (pr) => {
        const bitrate = loopBitrate(size, s.fps, s.quality, 'vp9');
        const blob = await encodeLoop(p.file, { codec: 'vp9', size, fps: s.fps, bitrate, range, fade }, pr, signal);
        files.push({ path: LOOP_PATHS.webm, blob, bytes: blob.size, label: `WebM loop (${size.width}×${size.height})`, target: 'background' });
      },
    });
  }

  const total = steps.reduce((a, st) => a + st.weight, 0);
  let done = 0;
  for (let i = 0; i < steps.length; i++) {
    if (signal.aborted) throw new AbortedError();
    const st = steps[i];
    const report = (f: number) =>
      onState({ label: st.label, step: i + 1, steps: steps.length, overall: (done + st.weight * Math.min(1, f)) / total });
    report(0);
    await st.run(report);
    done += st.weight;
    report(1);
  }

  const mp4 = files.find((f) => f.path === LOOP_PATHS.mp4);
  if (mp4 && rateSize(mp4.bytes, 'background') !== 'ok') {
    notes.push('Background videos load before anything moves. Try 720p, low quality or a shorter trim to make it lighter.');
  }

  return {
    kind: 'loop',
    files,
    info: { title: p.file.name.replace(/\.[^.]+$/, '') || 'Background video', width: size.width, height: size.height, hasWebm: webm },
    notes,
    commands: loopCommandsFor(p, s),
    elapsedMs: performance.now() - started,
    originalBytes: p.file.size,
  };
}
