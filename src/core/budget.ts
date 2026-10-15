/** File-size guidance. A scroll video has to download before it scrubs, so weight matters. */

export type Target = 'desktop' | 'mobile';
export type BudgetLevel = 'ok' | 'heavy' | 'too-heavy';

const MB = 1024 * 1024;

export const BUDGETS: Record<Target, { ok: number; heavy: number }> = {
  desktop: { ok: 8 * MB, heavy: 20 * MB },
  mobile: { ok: 5 * MB, heavy: 12 * MB },
};

export function rateSize(bytes: number, target: Target): BudgetLevel {
  const b = BUDGETS[target];
  if (bytes <= b.ok) return 'ok';
  if (bytes <= b.heavy) return 'heavy';
  return 'too-heavy';
}

export function budgetAdvice(level: BudgetLevel, target: Target): string {
  if (level === 'ok') return target === 'mobile' ? 'Light enough for phones.' : 'Good size for the web.';
  const fixes = 'Try 720p, 24 fps, low quality, or a shorter trim.';
  if (level === 'heavy') return `A bit heavy. It will take a moment on slow connections. ${fixes}`;
  return `Too heavy for most visitors. ${fixes}`;
}

/** Warnings shown before processing starts. */
export function inputWarnings(input: { duration: number; width: number; height: number; bytes: number }): string[] {
  const out: string[] = [];
  if (input.duration > 30) {
    out.push('This clip is over 30 seconds. Scroll videos work best under 15 seconds, so consider trimming it.');
  }
  if (Math.min(input.width, input.height) > 1440 || input.bytes > 300 * MB) {
    out.push('This is a big file. Processing happens on your computer and may take a minute or two.');
  }
  return out;
}
