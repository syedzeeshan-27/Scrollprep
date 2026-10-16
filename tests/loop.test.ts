import { describe, expect, it } from 'vitest';
import {
  effectiveFade,
  loopBitrate,
  loopCommands,
  loopDemoPage,
  loopDuration,
  loopEmbed,
  loopFrames,
  loopReadme,
} from '../src/core/loop';

const range = { start: 0, end: 6 };

describe('loop timing', () => {
  it('shortens the loop by the crossfade', () => {
    expect(loopDuration(range, 0.5)).toBe(5.5);
  });
  it('caps the crossfade at a third of the clip', () => {
    expect(effectiveFade({ start: 0, end: 0.9 }, 1)).toBeCloseTo(0.3);
    expect(effectiveFade(range, 1)).toBe(1);
  });
  it('plans plain frames when there is no crossfade', () => {
    const f = loopFrames(range, 0, 30);
    expect(f).toHaveLength(180);
    expect(f.every((x) => x.head === null)).toBe(true);
    expect(f[0].main).toBe(0);
  });
  it('blends the opening in at the end so the wrap is seamless', () => {
    const f = loopFrames(range, 1, 30);
    expect(f).toHaveLength(150);
    // The output starts 1 s in.
    expect(f[0].main).toBe(1);
    expect(f[0].head).toBeNull();
    // The blend covers the last 30 frames, rising towards the opening.
    const blend = f.filter((x) => x.head !== null);
    expect(blend).toHaveLength(30);
    expect(blend[0].head).toBeCloseTo(0);
    expect(blend[0].weight).toBeGreaterThan(0);
    expect(blend.at(-1)!.weight).toBe(1);
    // The last frame shows the frame just before the loop's first frame.
    expect(blend.at(-1)!.head! + 1 / 30).toBeCloseTo(f[0].main);
    for (let i = 1; i < blend.length; i++) expect(blend[i].weight).toBeGreaterThan(blend[i - 1].weight);
  });
  it('respects a trimmed start', () => {
    const f = loopFrames({ start: 2, end: 5 }, 0.5, 24);
    expect(f[0].main).toBe(2.5);
    expect(f.find((x) => x.head !== null)!.head).toBeCloseTo(2);
  });
});

describe('loop bitrate', () => {
  it('uses far fewer bits than a scroll video and less for VP9', () => {
    const s = { width: 1920, height: 1080 };
    expect(loopBitrate(s, 30, 'medium', 'avc')).toBeLessThan(3_000_000);
    expect(loopBitrate(s, 30, 'medium', 'vp9')).toBeLessThan(loopBitrate(s, 30, 'medium', 'avc'));
  });
});

const info = { title: 'Ocean <waves>', width: 1920, height: 1080, hasWebm: true };

describe('loop embed and pages', () => {
  it('autoplays muted and inline with webm first', () => {
    const html = loopEmbed(info);
    expect(html).toContain('autoplay muted loop playsinline');
    expect(html.indexOf('loop.webm')).toBeLessThan(html.indexOf('loop.mp4'));
    expect(html).toContain('poster="background/poster.jpg"');
  });
  it('leaves out webm when there is none', () => {
    expect(loopEmbed({ ...info, hasWebm: false })).not.toContain('webm');
  });
  it('escapes the title in the demo and includes the reduced-motion script', () => {
    const page = loopDemoPage(info, (p) => `blob:${p}`);
    expect(page).toContain('Ocean &lt;waves&gt;');
    expect(page).toContain('src="blob:background/loop.mp4"');
    expect(page).toContain('prefers-reduced-motion');
  });
  it('writes a readme with embed, css and commands', () => {
    const text = loopReadme(info, ['ffmpeg -x']);
    expect(text).toContain('bg-video');
    expect(text).toContain('object-fit: cover');
    expect(text).toContain('ffmpeg -x');
  });
});

describe('loop ffmpeg commands', () => {
  it('uses xfade for the crossfade with the right offset', () => {
    const [mp4, webm] = loopCommands({ inputName: 'a.mov', range, fade: 1, fps: 30, size: { width: 1280, height: 720 }, webm: true });
    expect(mp4).toContain('xfade=transition=fade:duration=1:offset=4');
    expect(mp4).toContain('scale=1280:720,fps=30');
    expect(mp4).toContain('-g 60');
    expect(mp4).toContain('-an');
    expect(webm).toContain('libvpx-vp9');
  });
  it('uses a plain scale without a crossfade', () => {
    const [mp4] = loopCommands({ inputName: 'a.mov', range, fade: 0, fps: 24, size: { width: 1280, height: 720 }, webm: false });
    expect(mp4).toContain('-vf "scale=1280:720,fps=24"');
    expect(mp4).not.toContain('xfade');
  });
});
