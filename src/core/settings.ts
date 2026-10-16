/** Pure settings maths. No browser APIs here, so it is easy to unit test. */

import type { Focus, PhoneFraming } from './crop';

export type Resolution = 720 | 1080;
export type QualityLevel = 'low' | 'medium' | 'high';
export type VideoCodecChoice = 'avc' | 'vp9';

export interface Outputs {
  /** Main H.264 MP4. Plays everywhere. */
  mp4: boolean;
  /** Lighter MP4 picked on small screens. */
  mobile: boolean;
  /** VP9 WebM, smaller, for Chrome and Firefox. */
  webm: boolean;
  /** Numbered image sequence for a canvas player. */
  frames: boolean;
}

export interface Settings {
  maxShortSide: Resolution;
  fps: 24 | 30;
  quality: QualityLevel;
  /** Seconds into the source. */
  trimStart: number;
  /** Seconds into the source, or null for the end. */
  trimEnd: number | null;
  outputs: Outputs;
  frameCount: number;
  /** How many screen heights the scroll effect lasts. */
  scrollLength: number;
  /** How the phone version is framed when the video is wider than a phone. */
  phoneFraming: PhoneFraming;
  /** What the phone crop centres on. */
  focus: Focus;
}

export interface Size {
  width: number;
  height: number;
}

export const MOBILE_SHORT_SIDE = 720;
export const MAX_FRAME_COUNT = 300;
export const DEFAULT_FRAME_CAP = 150;

/**
 * Bits per pixel per frame for an all-keyframe encode. All-intra needs far more bits than a normal
 * encode because no frame can borrow detail from its neighbours.
 */
export const BITS_PER_PIXEL: Record<QualityLevel, number> = {
  low: 0.07,
  medium: 0.12,
  high: 0.2,
};

/**
 * Rough size of one WebP/JPEG frame at quality 0.8, in bytes per pixel. Flat graphics come in near
 * 0.02, busy camera footage near 0.07.
 */
export const FRAME_BYTES_PER_PIXEL = 0.04;

/** VP9 reaches similar quality with fewer bits than H.264. */
export const VP9_FACTOR = 0.7;

export function defaultSettings(): Settings {
  return {
    maxShortSide: 1080,
    fps: 30,
    quality: 'medium',
    trimStart: 0,
    trimEnd: null,
    outputs: { mp4: true, mobile: true, webm: false, frames: false },
    frameCount: 120,
    scrollLength: 3,
    phoneFraming: 'tall',
    focus: { x: 0.5, y: 0.5 },
  };
}

const toEven = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Scales a source size so its short side is at most `maxShortSide`, keeping the aspect ratio.
 * Never upscales. Both sides come out even, which H.264 with 4:2:0 colour requires.
 * The long side is also capped at twice the short-side limit so ultra-wide clips stay sane.
 */
export function fitSize(src: Size, maxShortSide: number): Size {
  if (src.width <= 0 || src.height <= 0) throw new Error('Video has no size');
  const short = Math.min(src.width, src.height);
  const long = Math.max(src.width, src.height);
  const scale = Math.min(1, maxShortSide / short, (maxShortSide * 2) / long);
  return { width: toEven(src.width * scale), height: toEven(src.height * scale) };
}

export function videoBitrate(size: Size, fps: number, quality: QualityLevel, codec: VideoCodecChoice): number {
  const factor = codec === 'vp9' ? VP9_FACTOR : 1;
  return Math.round(size.width * size.height * fps * BITS_PER_PIXEL[quality] * factor);
}

export function estimateBytes(bitrate: number, seconds: number): number {
  return Math.round((bitrate * seconds) / 8);
}

export interface Range {
  start: number;
  end: number;
}

/** Clamps the trim settings to the clip, keeping at least 0.1 s. */
export function clipRange(duration: number, trimStart: number, trimEnd: number | null): Range {
  const minLen = Math.min(0.1, duration);
  const start = Math.min(Math.max(0, trimStart || 0), Math.max(0, duration - minLen));
  const rawEnd = trimEnd == null || !Number.isFinite(trimEnd) ? duration : trimEnd;
  const end = Math.max(start + minLen, Math.min(duration, rawEnd));
  return { start, end };
}

/** Sensible default number of frames for an image sequence. */
export function defaultFrameCount(seconds: number, fps: number): number {
  return Math.max(2, Math.min(DEFAULT_FRAME_CAP, Math.round(seconds * fps)));
}

/**
 * Evenly spaced sample times across a range. Each sample sits in the middle of its slot so the
 * last one never falls past the final frame.
 */
export function frameTimestamps(range: Range, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  const step = (range.end - range.start) / n;
  return Array.from({ length: n }, (_, i) => range.start + (i + 0.5) * step);
}

export function frameFileName(index: number, ext: string): string {
  return `frame-${String(index + 1).padStart(4, '0')}.${ext}`;
}
