/** Phone framing: a tall crop of a wide video, centred on a point the user picks. Pure maths. */

import type { Size } from './settings';

export type PhoneFraming = 'tall' | 'portrait' | 'same';

/** Width divided by height for each framing. */
export const FRAMING_ASPECT: Record<Exclude<PhoneFraming, 'same'>, number> = {
  tall: 9 / 16,
  portrait: 4 / 5,
};

export const FRAMINGS: { id: PhoneFraming; label: string }[] = [
  { id: 'tall', label: 'Tall 9:16' },
  { id: 'portrait', label: '4:5' },
  { id: 'same', label: 'Same as desktop' },
];

/** Where the subject is, as fractions of the frame (0,0 top left, 1,1 bottom right). */
export interface Focus {
  x: number;
  y: number;
}

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const toEven = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function framingAspect(framing: PhoneFraming): number | null {
  return framing === 'same' ? null : FRAMING_ASPECT[framing];
}

/** A crop only makes sense when the video is wider than the phone shape. */
export function needsCrop(src: Size, framing: PhoneFraming): boolean {
  const aspect = framingAspect(framing);
  return aspect != null && src.width / src.height > aspect * 1.02;
}

/**
 * The largest rectangle of the given shape that fits inside the video, centred on the focus point
 * but kept inside the frame. All values are even, as H.264 needs.
 */
export function cropForFocus(src: Size, aspect: number, focus: Focus): CropRect {
  let width = src.width;
  let height = src.height;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  width = toEven(width);
  height = toEven(height);
  const floorEven = (n: number) => Math.floor(n / 2) * 2;
  const place = (center: number, size: number, total: number) =>
    floorEven(clamp(center - size / 2, 0, total - size));
  return {
    width,
    height,
    left: place(focus.x * src.width, width, src.width),
    top: place(focus.y * src.height, height, src.height),
  };
}

/** The crop for these settings, or null when the phone version keeps the desktop framing. */
export function phoneCrop(src: Size, framing: PhoneFraming, focus: Focus): CropRect | null {
  if (!needsCrop(src, framing)) return null;
  return cropForFocus(src, framingAspect(framing)!, focus);
}
