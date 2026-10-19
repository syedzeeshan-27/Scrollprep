import { describe, expect, it } from 'vitest';
import runtimeSource from '../src/runtime/scrollscrub.js?raw';
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
import {
  cleanCaptions,
  defaultHeadline,
  demoPage,
  escapeHtml,
  framesEmbed,
  MAX_CAPTIONS,
  MAX_HEADLINE,
  readme,
  videoEmbed,
  type ExportInfo,
} from '../src/core/snippets';
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
  layout: 'full',
  captions: [],
};

describe('layouts and captions', () => {
  it('leaves the layout attribute off for full screen', () => {
    expect(videoEmbed(info)).not.toContain('data-layout');
  });
  it('adds the layout attribute and wraps the media in a frame', () => {
    const html = videoEmbed({ ...info, layout: 'card' });
    expect(html).toContain('data-layout="card"');
    expect(html).toMatch(/scrollscrub__frame">\s*<video/);
    expect(framesEmbed({ ...info, layout: 'split' })).toContain('data-layout="split"');
  });
  it('writes captions sorted, escaped and clamped, skipping empty ones', () => {
    const html = videoEmbed({
      ...info,
      captions: [
        { text: 'Second <b>', at: 0.6 },
        { text: '   ', at: 0.3 },
        { text: 'First', at: -1 },
        { text: 'Last', at: 7 },
      ],
    });
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html).toContain('data-at="0">First');
    expect(html).toContain('data-at="1">Last');
    expect(html).toContain('Second &lt;b&gt;');
    expect(html.match(/scrollscrub__caption"/g)).toHaveLength(3);
  });
  it('omits the captions block when there are none', () => {
    expect(videoEmbed(info)).not.toContain('scrollscrub__captions');
  });
  it('writes the reveal and zoom layouts', () => {
    expect(videoEmbed({ ...info, layout: 'reveal' })).toContain('data-layout="reveal"');
    expect(framesEmbed({ ...info, layout: 'zoom' })).toContain('data-layout="zoom"');
  });
  it('adds the caption style only when it is not the default and there is text', () => {
    const caps = [{ text: 'Hello there', at: 0.2 }];
    expect(videoEmbed({ ...info, captions: caps })).not.toContain('data-caption-style');
    expect(videoEmbed({ ...info, captions: caps, captionStyle: 'rise' })).not.toContain('data-caption-style');
    expect(videoEmbed({ ...info, captions: caps, captionStyle: 'words' })).toContain('data-caption-style="words"');
    expect(framesEmbed({ ...info, captions: caps, captionStyle: 'mask' })).toContain('data-caption-style="mask"');
    expect(videoEmbed({ ...info, captionStyle: 'blur' })).not.toContain('data-caption-style');
  });
  it('caps the number of captions', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ text: `c${i}`, at: i / 10 }));
    expect(cleanCaptions(many)).toHaveLength(MAX_CAPTIONS);
  });
  it('writes the letterbox layout and the typewriter style', () => {
    const caps = [{ text: 'Hello there', at: 0.2 }];
    expect(framesEmbed({ ...info, layout: 'letterbox' })).toContain('data-layout="letterbox"');
    expect(videoEmbed({ ...info, captions: caps, captionStyle: 'type' })).toContain('data-caption-style="type"');
  });
  it('writes the knockout word after the frame, defaulting to the first word of the title', () => {
    const html = videoEmbed({ ...info, layout: 'knockout', headline: ' Air <max> ' });
    expect(html).toContain('data-layout="knockout"');
    expect(html).toMatch(/<\/div>\s*<div class="scrollscrub__knockout" aria-hidden="true">Air &lt;max&gt;<\/div>/);
    expect(framesEmbed({ ...info, layout: 'knockout' })).toContain('aria-hidden="true">Shoe</div>');
    expect(videoEmbed({ ...info, layout: 'card', headline: 'Air' })).not.toContain('scrollscrub__knockout');
    expect(defaultHeadline('my-coffee_pour v2.mp4')).toBe('my');
    expect(defaultHeadline('   ')).toBe('Scroll');
    expect(defaultHeadline('Supercalifragilistic words')).toHaveLength(MAX_HEADLINE);
  });
  it('adds data-glow only when asked', () => {
    expect(videoEmbed({ ...info, glow: true })).toContain('data-scrollscrub data-glow ');
    expect(framesEmbed({ ...info, layout: 'card', glow: true })).toContain('data-layout="card" data-glow ');
    expect(videoEmbed({ ...info, glow: false })).not.toContain('data-glow');
  });
  it('writes data-hold only for lines that hold the frame', () => {
    const html = videoEmbed({
      ...info,
      captions: [
        { text: 'Held', at: 0.2, hold: 0.1 },
        { text: 'Free', at: 0.5, hold: 0 },
        { text: 'Plain', at: 0.8 },
      ],
    });
    expect(html).toContain('data-at="0.2" data-hold="0.1">Held');
    expect(html).toContain('data-at="0.5">Free');
    expect(html).toContain('data-at="0.8">Plain');
  });
  it('trims a hold that would run into the next line, past the end or over the cap', () => {
    const caps = cleanCaptions([
      { text: 'A', at: 0.3, hold: 0.2 },
      { text: 'B', at: 0.4, hold: 0.9 },
      { text: 'C', at: 0.95, hold: 0.2 },
      { text: 'D', at: 0.5, hold: -1 },
    ]);
    expect(caps.map((c) => c.hold)).toEqual([0.1, 0.1, undefined, 0.05]);
  });
});

describe('runtime hold map', () => {
  // The runtime only runs with a window; hand it a bare one and a document that never fires load.
  const win: { ScrollScrub?: { holdMap: (items: { at: number; hold: number }[]) => (p: number) => number } } = {};
  new Function('window', 'document', runtimeSource)(win, { readyState: 'loading', addEventListener() {} });
  const holdMap = win.ScrollScrub!.holdMap;

  it('is the identity with no holds', () => {
    const v = holdMap([{ at: 0.3, hold: 0 }]);
    expect(v(0)).toBe(0);
    expect(v(0.37)).toBe(0.37);
    expect(v(1)).toBe(1);
  });
  it('freezes the video across a hold and still ends at the end', () => {
    const v = holdMap([{ at: 0.2, hold: 0.1 }]);
    expect(v(0)).toBe(0);
    expect(v(0.2)).toBeCloseTo(0.2 / 0.9, 6);
    expect(v(0.25)).toBeCloseTo(v(0.2), 6);
    expect(v(0.3)).toBeCloseTo(v(0.2), 6);
    expect(v(0.65)).toBeCloseTo(0.55 / 0.9, 6);
    expect(v(1)).toBe(1);
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      expect(v(p)).toBeGreaterThanOrEqual(last);
      last = v(p);
    }
  });
  it('stacks several holds', () => {
    const v = holdMap([{ at: 0.1, hold: 0.1 }, { at: 0.6, hold: 0.2 }]);
    expect(v(0.15)).toBeCloseTo(v(0.1), 6);
    expect(v(0.7)).toBeCloseTo(v(0.6), 6);
    expect(v(0.8)).toBeCloseTo(v(0.6), 6);
    expect(v(1)).toBe(1);
  });
});

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

describe('phone framing output', () => {
  it('adds the phone poster swap only when there is a phone poster', () => {
    expect(videoEmbed(info)).not.toContain('data-poster-mobile');
    expect(videoEmbed({ ...info, hasMobilePoster: true })).toContain('data-poster-mobile="scrollprep/poster-mobile.jpg"');
  });
  it('crops before scaling in the ffmpeg phone command', () => {
    const [cmd] = ffmpegCommands({
      inputName: 'a.mp4',
      range: { start: 0, end: 2 },
      fps: 30,
      mobile: { width: 606, height: 1080 },
      mobileCrop: { left: 656, top: 0, width: 606, height: 1080 },
    });
    expect(cmd).toContain('-vf "crop=606:1080:656:0,scale=606:1080,fps=30"');
    expect(cmd).toContain('video-mobile.mp4');
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
