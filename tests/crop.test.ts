import { describe, expect, it } from 'vitest';
import { cropForFocus, needsCrop, phoneCrop } from '../src/core/crop';

const hd = { width: 1920, height: 1080 };

describe('cropForFocus', () => {
  it('makes the tallest 9:16 crop of a landscape video, centred', () => {
    const c = cropForFocus(hd, 9 / 16, { x: 0.5, y: 0.5 });
    expect(c.height).toBe(1080);
    expect(c.width).toBe(606);
    expect(c.top).toBe(0);
    expect(c.left).toBe(656);
  });
  it('follows the focus point', () => {
    expect(cropForFocus(hd, 9 / 16, { x: 0.25, y: 0.5 }).left).toBe(176);
  });
  it('keeps the crop inside the frame at the edges', () => {
    expect(cropForFocus(hd, 9 / 16, { x: 0, y: 0.5 }).left).toBe(0);
    const right = cropForFocus(hd, 9 / 16, { x: 1, y: 0.5 });
    expect(right.left + right.width).toBeLessThanOrEqual(1920);
    expect(right.left).toBeGreaterThan(1300);
  });
  it('uses even numbers everywhere', () => {
    const c = cropForFocus({ width: 1281, height: 721 }, 4 / 5, { x: 0.33, y: 0.71 });
    for (const v of Object.values(c)) expect(v % 2).toBe(0);
  });
  it('crops height when the source is taller than the target', () => {
    const c = cropForFocus({ width: 1080, height: 1920 }, 4 / 5, { x: 0.5, y: 0.2 });
    expect(c.width).toBe(1080);
    expect(c.height).toBe(1350);
    expect(c.top).toBe(0);
  });
});

describe('needsCrop / phoneCrop', () => {
  it('crops wide videos but not portrait ones', () => {
    expect(needsCrop(hd, 'tall')).toBe(true);
    expect(needsCrop({ width: 1080, height: 1920 }, 'tall')).toBe(false);
    expect(needsCrop(hd, 'same')).toBe(false);
  });
  it('returns null when no crop is needed', () => {
    expect(phoneCrop({ width: 1080, height: 1920 }, 'tall', { x: 0.5, y: 0.5 })).toBeNull();
    expect(phoneCrop(hd, 'portrait', { x: 0.5, y: 0.5 })?.width).toBe(864);
  });
});
