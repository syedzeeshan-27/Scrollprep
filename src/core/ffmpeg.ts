/** Equivalent ffmpeg commands, for the readme and for browsers that can't do the job themselves. */

import type { Range, Size } from './settings';

export interface CommandInput {
  inputName: string;
  range: Range;
  fps: number;
  main?: Size;
  mobile?: Size;
  webm?: Size;
  frames?: { size: Size; count: number; ext: 'webp' | 'jpg' };
}

const q = (name: string) => `"${name.replace(/"/g, '\\"')}"`;
const t = (s: number) => s.toFixed(3).replace(/\.?0+$/, '') || '0';

function trimArgs(r: Range): string {
  return `-ss ${t(r.start)} -to ${t(r.end)}`;
}

export function ffmpegCommands(c: CommandInput): string[] {
  const head = `ffmpeg -i ${q(c.inputName)} ${trimArgs(c.range)}`;
  const vf = (s: Size, fps: number | string) => `-vf "scale=${s.width}:${s.height},fps=${fps}"`;
  const h264 = '-c:v libx264 -preset slow -crf 20 -g 1 -pix_fmt yuv420p -movflags +faststart -an';
  const out: string[] = [];
  if (c.main) out.push(`${head} ${vf(c.main, c.fps)} ${h264} scrollprep/video.mp4`);
  if (c.mobile) out.push(`${head} ${vf(c.mobile, c.fps)} ${h264} scrollprep/video-mobile.mp4`);
  if (c.webm) {
    out.push(
      `${head} ${vf(c.webm, c.fps)} -c:v libvpx-vp9 -crf 32 -b:v 0 -g 1 -row-mt 1 -pix_fmt yuv420p -an scrollprep/video.webm`,
    );
  }
  if (c.frames) {
    const len = Math.max(0.001, c.range.end - c.range.start);
    const rate = `${c.frames.count}/${t(len)}`;
    const codec = c.frames.ext === 'webp' ? '-c:v libwebp -quality 80' : '-q:v 3';
    out.push('# ffmpeg will not create folders, so make scrollprep/frames first');
    out.push(
      `${head} ${vf(c.frames.size, rate)} -frames:v ${c.frames.count} ${codec} scrollprep/frames/frame-%04d.${c.frames.ext}`,
    );
  }
  return out;
}
