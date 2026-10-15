import { describe, expect, it } from 'vitest';
import {
  clipRange,
  defaultFrameCount,
  estimateBytes,
  fitSize,
  frameFileName,
  frameTimestamps,
  videoBitrate,
} from '../src/core/settings';
import { BUDGETS, inputWarnings, rateSize } from '../src/core/budget';
import { demoPage, escapeHtml, framesEmbed, readme, videoEmbed, type ExportInfo } from '../src/core/snippets';
import { ffmpegCommands } from '../src/core/ffmpeg';

describe('fitSize', () => {
  it('caps 4K landscape to 1080p', () => {
    expect(fitSize({ width: 3840, height: 2160 }, 1080)).toEqual({ width: 1920, height: 1080 });
  });
  it('caps portrait by its short side', () => {
    expect(fitSize({ width: 2160, height: 3840 }, 1080)).toEqual({ width: 1080, height: 1920 });
  });
  it('never upscales', () => {
    expect(fitSize({ width: 640, height: 360 }, 1080)).toEqual({ width: 640, height: 360 });
  });
  it('rounds odd sizes down to even numbers', () => {
    const s = fitSize({ width: 1281, height: 721 }, 1080);
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
  });
  it('caps ultra-wide long sides', () => {
    const s = fitSize({ width: 8000, height: 1080 }, 1080);
    expect(s.width).toBeLessThanOrEqual(2160);
  });
  it('rejects empty sizes', () => {
    expect(() => fitSize({ width: 0, height: 100 }, 1080)).toThrow();
  });
});

describe('bitrate and size estimate', () => {
  it('uses fewer bits for VP9', () => {
    const s = { width: 1920, height: 1080 };
    expect(videoBitrate(s, 30, 'medium', 'vp9')).toBeLessThan(videoBitrate(s, 30, 'medium', 'avc'));
  });
  it('scales with quality', () => {
    const s = { width: 1280, height: 720 };
    expect(videoBitrate(s, 30, 'low', 'avc')).toBeLessThan(videoBitrate(s, 30, 'high', 'avc'));
  });
  it('estimates bytes from bitrate', () => {
    expect(estimateBytes(8_000_000, 10)).toBe(10_000_000);
  });
});

describe('clipRange', () => {
  it('defaults to the whole clip', () => {
    expect(clipRange(10, 0, null)).toEqual({ start: 0, end: 10 });
  });
  it('clamps out-of-range values', () => {
    expect(clipRange(10, -5, 50)).toEqual({ start: 0, end: 10 });
  });
  it('keeps a minimum length when end is before start', () => {
    const r = clipRange(10, 5, 2);
    expect(r.start).toBe(5);
    expect(r.end).toBeCloseTo(5.1);
  });
});

describe('frames', () => {
  it('spaces timestamps inside the range', () => {
    const ts = frameTimestamps({ start: 0, end: 4 }, 4);
    expect(ts).toEqual([0.5, 1.5, 2.5, 3.5]);
  });
  it('caps the default frame count', () => {
    expect(defaultFrameCount(60, 30)).toBe(150);
    expect(defaultFrameCount(2, 30)).toBe(60);
  });
  it('pads frame names', () => {
    expect(frameFileName(0, 'webp')).toBe('frame-0001.webp');
    expect(frameFileName(119, 'jpg')).toBe('frame-0120.jpg');
  });
});

describe('budget', () => {
  it('rates sizes per target', () => {
    expect(rateSize(BUDGETS.desktop.ok, 'desktop')).toBe('ok');
    expect(rateSize(BUDGETS.desktop.ok + 1, 'desktop')).toBe('heavy');
    expect(rateSize(BUDGETS.mobile.heavy + 1, 'mobile')).toBe('too-heavy');
  });
  it('warns about long and huge inputs', () => {
    expect(inputWarnings({ duration: 5, width: 1920, height: 1080, bytes: 1e6 })).toEqual([]);
    expect(inputWarnings({ duration: 45, width: 3840, height: 2160, bytes: 1e6 })).toHaveLength(2);
  });
});

const info: ExportInfo = {
  title: 'Shoe <spin>',
  width: 1920,
  height: 1080,
  videos: { mp4: true, mobile: true, webm: true },
  frames: { count: 120, ext: 'webp' },
  hasPoster: true,
  scrollLength: 3,
};

describe('snippets', () => {
  it('lists webm before mp4 and adds the mobile swap', () => {
    const html = videoEmbed(info);
    expect(html.indexOf('video.webm')).toBeLessThan(html.indexOf('video.mp4'));
    expect(html).toContain('data-src-mobile="scrollprep/video-mobile.mp4"');
    expect(html).toContain('--scrollscrub-length:300vh');
    expect(html).toContain('poster="scrollprep/poster.jpg"');
  });
  it('uses the mobile file as the only source when it is the only video', () => {
    const html = videoEmbed({ ...info, videos: { mp4: false, mobile: true, webm: false } });
    expect(html).toContain('<source src="scrollprep/video-mobile.mp4"');
    expect(html).not.toContain('data-src-mobile');
  });
  it('resolves paths for the preview', () => {
    const html = videoEmbed(info, (p) => `blob:${p}`);
    expect(html).toContain('src="blob:scrollprep/video.mp4"');
  });
  it('builds the frame pattern', () => {
    expect(framesEmbed(info)).toContain('data-frames="scrollprep/frames/frame-{i}.webp" data-frame-count="120"');
  });
  it('escapes explicit frame lists', () => {
    expect(framesEmbed(info, ['a.webp', 'b.webp'])).toContain('data-frame-list="[&quot;a.webp&quot;,&quot;b.webp&quot;]"');
  });
  it('escapes the title in the demo page and keeps inline scripts closed safely', () => {
    const page = demoPage(info, { mode: 'video', runtime: { inline: 'var a = "</script>";' } });
    expect(page).toContain('Shoe &lt;spin&gt;');
    expect(page).not.toContain('"</script>"');
  });
  it('writes a readme with both embeds and ffmpeg commands', () => {
    const text = readme(info, ['ffmpeg -i x']);
    expect(text).toContain('data-scrollscrub');
    expect(text).toContain('image sequence');
    expect(text).toContain('ffmpeg -i x');
  });
  it('escapes html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('ffmpeg commands', () => {
  it('makes every frame a keyframe and strips audio', () => {
    const cmds = ffmpegCommands({
      inputName: 'my clip.mov',
      range: { start: 1, end: 5.5 },
      fps: 30,
      main: { width: 1920, height: 1080 },
      webm: { width: 1920, height: 1080 },
      frames: { size: { width: 1280, height: 720 }, count: 90, ext: 'webp' },
    });
    expect(cmds[0]).toContain('"my clip.mov"');
    expect(cmds[0]).toContain('-ss 1 -to 5.5');
    expect(cmds[0]).toContain('-g 1');
    expect(cmds[0]).toContain('-an');
    expect(cmds[0]).toContain('scale=1920:1080,fps=30');
    expect(cmds[1]).toContain('libvpx-vp9');
    expect(cmds.at(-1)).toContain('fps=90/4.5');
    expect(cmds.at(-1)).toContain('frame-%04d.webp');
  });
});
