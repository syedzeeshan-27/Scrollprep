import { describe, expect, it } from 'vitest';
import { assignLanes, fractionAt, nudge, shortLabel } from '../src/core/timeline';

describe('fractionAt', () => {
  it('maps a pointer position to a snapped fraction', () => {
    expect(fractionAt(150, 100, 400)).toBe(0.13);
    expect(fractionAt(300, 100, 400)).toBe(0.5);
  });
  it('clamps outside the strip', () => {
    expect(fractionAt(0, 100, 400)).toBe(0);
    expect(fractionAt(900, 100, 400)).toBe(1);
  });
  it('handles a zero-width strip', () => {
    expect(fractionAt(10, 0, 0)).toBe(0);
  });
});

describe('nudge', () => {
  it('moves by 1% or 5% and stays in range', () => {
    expect(nudge(0.5, 1)).toBe(0.51);
    expect(nudge(0.5, -1, true)).toBe(0.45);
    expect(nudge(0.99, 1, true)).toBe(1);
    expect(nudge(0.02, -1, true)).toBe(0);
  });
  it('does not drift with floating point', () => {
    let at = 0;
    for (let i = 0; i < 30; i++) at = nudge(at, 1);
    expect(at).toBe(0.3);
  });
});

describe('shortLabel', () => {
  it('truncates long text and names empty text', () => {
    expect(shortLabel('Short')).toBe('Short');
    expect(shortLabel('Every detail, considered carefully', 12)).toBe('Every detai…');
    expect(shortLabel('   ')).toBe('Empty text');
  });
});

describe('assignLanes', () => {
  it('keeps well-spaced markers in one row', () => {
    expect(assignLanes([0.1, 0.5, 0.9], 0.15)).toEqual([0, 0, 0]);
  });
  it('stacks markers that are close together', () => {
    expect(assignLanes([0.1, 0.12, 0.14], 0.15)).toEqual([0, 1, 2]);
  });
  it('works regardless of input order', () => {
    expect(assignLanes([0.5, 0.1, 0.52], 0.15)).toEqual([0, 0, 1]);
  });
  it('reuses the row that frees up soonest when all rows are busy', () => {
    const lanes = assignLanes([0.1, 0.11, 0.12, 0.13], 0.15, 3);
    expect(lanes.slice(0, 3)).toEqual([0, 1, 2]);
    expect(lanes[3]).toBe(0);
  });
});
