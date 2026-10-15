import type { Target } from '../core/budget';
import { ffmpegCommands, type CommandInput } from '../core/ffmpeg';
import {
  clipRange,
  fitSize,
  frameFileName,
  frameTimestamps,
  MOBILE_SHORT_SIDE,
  videoBitrate,
  type Range,
  type Settings,
  type Size,
} from '../core/settings';
import { PATHS, type ExportInfo, type FrameExt } from '../core/snippets';
import { canEncode, encodeVideo, type Progress } from './encode';
import { AbortedError, FriendlyError } from './errors';
import { extractFrames, imageExt, poster } from './frames';
import type { ProbeResult } from './probe';

export interface OutputFile {
  path: string;
  /** Null for the summary row that stands for the whole image sequence. */
  blob: Blob | null;
  bytes: number;
  label: string;
  /** Which kind of visitor downloads it, for the size check. */
  target: Target | null;
}

export interface PipelineResult {
  files: OutputFile[];
  frames: Blob[];
  info: ExportInfo;
  notes: string[];
  commands: string[];
  elapsedMs: number;
}

export interface PipelineState {
  label: string;
  step: number;
  steps: number;
  /** 0 to 1 across all steps. */
  overall: number;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

interface Step {
  label: string;
  weight: number;
  run: (progress: Progress, signal: AbortSignal) => Promise<void>;
}

export interface Plan {
  range: Range;
  main: Size;
  mobile: Size | null;
  frameExt: FrameExt;
  commands: CommandInput;
}

/** Works out sizes and which outputs make sense, without doing any work yet. */
export function planFor(p: ProbeResult, s: Settings): Plan {
  const src = { width: p.width, height: p.height };
  const range = clipRange(p.duration, s.trimStart, s.trimEnd);
  const main = fitSize(src, s.maxShortSide);
  // A mobile copy only helps when it is actually smaller than the main one.
  const mobileCandidate = fitSize(src, MOBILE_SHORT_SIDE);
  const mobile = s.outputs.mobile && mobileCandidate.width < main.width ? mobileCandidate : null;
  const frameExt = imageExt();
  return {
    range,
    main,
    mobile,
    frameExt,
    commands: {
      inputName: p.file.name,
      range,
      fps: s.fps,
      main: s.outputs.mp4 ? main : undefined,
      mobile: mobile ?? undefined,
      webm: s.outputs.webm ? main : undefined,
      frames: s.outputs.frames ? { size: main, count: s.frameCount, ext: frameExt } : undefined,
    },
  };
}

export function commandsFor(p: ProbeResult, s: Settings): string[] {
  return ffmpegCommands(planFor(p, s).commands);
}

export async function runPipeline(
  p: ProbeResult,
  s: Settings,
  onState: (state: PipelineState) => void,
  signal: AbortSignal,
): Promise<PipelineResult> {
  const started = performance.now();
  const plan = planFor(p, s);
  const { range, main, mobile } = plan;
  const seconds = range.end - range.start;
  const frameCount = Math.round(seconds * s.fps);
  const files: OutputFile[] = [];
  const notes: string[] = [];
  let frames: Blob[] = [];
  const videos = { mp4: false, mobile: false, webm: false };

  if (!s.outputs.mp4 && !s.outputs.mobile && !s.outputs.webm && !s.outputs.frames) {
    throw new FriendlyError('Pick at least one output.');
  }
  if (s.outputs.mobile && !mobile) {
    if (s.outputs.mp4) notes.push('Your video is already phone-sized, so the main video is used on phones too.');
  }

  const mainBitrate = videoBitrate(main, s.fps, s.quality, 'avc');
  const needsAvc = s.outputs.mp4 || (s.outputs.mobile && !s.outputs.mp4);
  if (needsAvc && !(await canEncode('avc', main, mainBitrate))) {
    throw new FriendlyError(
      "This browser can't encode MP4 video. Try a recent Chrome, Edge or Safari, or use the ffmpeg commands below.",
    );
  }

  const steps: Step[] = [];
  const pixels = (sz: Size) => sz.width * sz.height * Math.max(1, frameCount);

  steps.push({
    label: 'Saving the poster image',
    weight: main.width * main.height * 4,
    run: async () => {
      const blob = await poster(p.file, main, range.start);
      files.push({ path: PATHS.poster, blob, bytes: blob.size, label: 'Poster image', target: null });
    },
  });

  const addVideo = (label: string, path: string, size: Size, codec: 'avc' | 'vp9', target: Target, flag: keyof typeof videos) =>
    steps.push({
      label,
      weight: pixels(size) * (codec === 'vp9' ? 2 : 1),
      run: async (progress, sig) => {
        const blob = await encodeVideo(
          p.file,
          { codec, size, fps: s.fps, bitrate: videoBitrate(size, s.fps, s.quality, codec), range },
          progress,
          sig,
        );
        files.push({ path, blob, bytes: blob.size, label: `${cap(label.replace(/^Making the /, ''))} (${size.width}×${size.height})`, target });
        videos[flag] = true;
      },
    });

  if (s.outputs.mp4) addVideo('Making the main video', PATHS.mp4, main, 'avc', 'desktop', 'mp4');
  if (mobile) addVideo('Making the phone video', PATHS.mobile, mobile, 'avc', 'mobile', 'mobile');
  else if (s.outputs.mobile && !s.outputs.mp4) addVideo('Making the phone video', PATHS.mobile, main, 'avc', 'mobile', 'mobile');

  if (s.outputs.webm) {
    if (await canEncode('vp9', main, videoBitrate(main, s.fps, s.quality, 'vp9'))) {
      addVideo('Making the WebM video', PATHS.webm, main, 'vp9', 'desktop', 'webm');
    } else {
      notes.push("This browser can't encode WebM, so it was skipped. The MP4 works everywhere.");
    }
  }

  if (s.outputs.frames) {
    const count = Math.max(2, Math.round(s.frameCount));
    steps.push({
      label: 'Saving the image frames',
      weight: main.width * main.height * count * 3,
      run: async (progress, sig) => {
        frames = await extractFrames(p.file, main, frameTimestamps(range, count), plan.frameExt, progress, sig);
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
    await st.run(report, signal);
    done += st.weight;
    report(1);
  }

  const info: ExportInfo = {
    title: p.file.name.replace(/\.[^.]+$/, '') || 'Scroll video',
    width: main.width,
    height: main.height,
    videos,
    frames: frames.length ? { count: frames.length, ext: plan.frameExt } : null,
    hasPoster: true,
    scrollLength: s.scrollLength,
    layout: 'full',
    captions: [],
  };
  if (frames.length) {
    files.push({
      path: `${PATHS.frames}${frameFileName(0, plan.frameExt)} …`,
      blob: null,
      bytes: frames.reduce((a, b) => a + b.size, 0),
      label: `${frames.length} image frames (${main.width}×${main.height})`,
      target: 'desktop',
    });
  }

  return { files, frames, info, notes, commands: ffmpegCommands(plan.commands), elapsedMs: performance.now() - started };
}

