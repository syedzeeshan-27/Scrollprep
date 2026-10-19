import { escapeHtml, type Caption } from '../core/snippets';
import { assignLanes, fractionAt, nudge, shortLabel } from '../core/timeline';

export interface TimelineEvents {
  /** A marker moved. `done` is false while dragging and true once it is dropped or nudged. */
  onMove(index: number, at: number, done: boolean): void;
  /** The strip was clicked or scrubbed, or a marker was clicked. */
  onSeek(at: number): void;
}

const LANE_PX = 30;
const LABEL_PX = 150;
const STRIP_PX = 56;

/**
 * A strip of video stills with one draggable marker per line of text, plus a playhead that shows
 * where the preview is. Markers move with the pointer or with the arrow keys (Shift for 5%).
 */
export class Timeline {
  private readonly markersEl: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly thumbsEl: HTMLElement;
  private readonly playhead: HTMLElement;
  private captions: Caption[] = [];
  private dragging = -1;
  private playheadAt = -1;

  constructor(
    root: HTMLElement,
    private readonly events: TimelineEvents,
  ) {
    root.innerHTML = `
      <div class="tl">
        <div class="tl__markers"></div>
        <div class="tl__strip" title="Click or drag to move the preview">
          <div class="tl__thumbs"></div>
          <div class="tl__playhead" aria-hidden="true"></div>
        </div>
        <div class="tl__scale" aria-hidden="true"><span>Start</span><span>Middle</span><span>End</span></div>
      </div>`;
    this.markersEl = root.querySelector('.tl__markers')!;
    this.strip = root.querySelector('.tl__strip')!;
    this.thumbsEl = root.querySelector('.tl__thumbs')!;
    this.playhead = root.querySelector('.tl__playhead')!;
    this.bindStrip();
    this.bindMarkers();
    new ResizeObserver(() => this.render()).observe(this.strip);
  }

  setThumbs(urls: string[]) {
    this.thumbsEl.innerHTML = urls.map((u) => `<img src="${escapeHtml(u)}" alt="" draggable="false">`).join('');
  }

  setCaptions(captions: Caption[]) {
    this.captions = captions;
    if (this.dragging < 0) this.render();
  }

  setPlayhead(at: number) {
    if (Math.abs(at - this.playheadAt) < 0.001) return;
    this.playheadAt = at;
    this.playhead.style.left = `${at * 100}%`;
  }

  private stripFraction(clientX: number) {
    const r = this.strip.getBoundingClientRect();
    return fractionAt(clientX, r.left, r.width);
  }

  private render() {
    const width = this.strip.clientWidth || 600;
    const lanes = assignLanes(
      this.captions.map((c) => c.at),
      LABEL_PX / width,
    );
    const laneCount = this.captions.length ? Math.max(...lanes) + 1 : 1;
    this.markersEl.style.height = `${laneCount * LANE_PX + 8}px`;
    // The strip sits below the markers; a hold shows as a bar along its bottom edge.
    const holdTop = (laneCount - 1) * LANE_PX + 38 + STRIP_PX - 8;
    this.markersEl.innerHTML = this.captions
      .map((c, i) => {
        const pct = Math.round(c.at * 100);
        const label = shortLabel(c.text);
        // The stem runs down through the strip so the exact point is visible on the stills.
        const stem = (laneCount - 1 - lanes[i]) * LANE_PX + 14 + STRIP_PX;
        const hold = c.hold ? `<i class="tl__hold" data-i="${i}" style="left:${c.at * 100}%;width:${c.hold * 100}%;top:${holdTop}px"></i>` : '';
        return `<div class="tl__marker" data-i="${i}" style="left:${c.at * 100}%;top:${lanes[i] * LANE_PX}px;--at:${c.at}">
          <button type="button" class="tl__label" aria-label="${escapeHtml(label)}, appears at ${pct}%. Drag, or use the arrow keys to move it.">
            <span>${escapeHtml(label)}</span><b>${pct}%</b>
          </button>
          <i class="tl__stem" style="height:${stem}px"></i>
        </div>${hold}`;
      })
      .join('');
  }

  private place(index: number, at: number) {
    const m = this.markersEl.querySelector<HTMLElement>(`.tl__marker[data-i="${index}"]`);
    if (!m) return;
    m.style.left = `${at * 100}%`;
    m.style.setProperty('--at', String(at));
    const hold = this.markersEl.querySelector<HTMLElement>(`.tl__hold[data-i="${index}"]`);
    if (hold) hold.style.left = `${at * 100}%`;
    const pct = m.querySelector('b');
    if (pct) pct.textContent = `${Math.round(at * 100)}%`;
  }

  private bindStrip() {
    let scrubbing = false;
    this.strip.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      this.strip.setPointerCapture(e.pointerId);
      this.events.onSeek(this.stripFraction(e.clientX));
    });
    this.strip.addEventListener('pointermove', (e) => {
      if (scrubbing) this.events.onSeek(this.stripFraction(e.clientX));
    });
    const stop = () => (scrubbing = false);
    this.strip.addEventListener('pointerup', stop);
    this.strip.addEventListener('pointercancel', stop);
  }

  private bindMarkers() {
    let moved = false;
    let startX = 0;
    this.markersEl.addEventListener('pointerdown', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('.tl__marker');
      if (!m) return;
      e.preventDefault();
      this.dragging = Number(m.dataset.i);
      moved = false;
      startX = e.clientX;
      m.classList.add('is-dragging');
      m.querySelector<HTMLElement>('.tl__label')?.focus({ preventScroll: true });
      this.markersEl.setPointerCapture(e.pointerId);
    });
    this.markersEl.addEventListener('pointermove', (e) => {
      if (this.dragging < 0) return;
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      const at = this.stripFraction(e.clientX);
      if (at === this.captions[this.dragging]?.at) return;
      this.place(this.dragging, at);
      this.events.onMove(this.dragging, at, false);
    });
    const end = () => {
      if (this.dragging < 0) return;
      const i = this.dragging;
      this.dragging = -1;
      const c = this.captions[i];
      if (!c) return this.render();
      if (moved) this.events.onMove(i, c.at, true);
      else this.events.onSeek(Math.min(1, c.at + 0.01));
      this.render();
      this.markersEl.querySelector<HTMLElement>(`.tl__marker[data-i="${i}"] .tl__label`)?.focus({ preventScroll: true });
    };
    this.markersEl.addEventListener('pointerup', end);
    this.markersEl.addEventListener('pointercancel', end);

    this.markersEl.addEventListener('keydown', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('.tl__marker');
      if (!m) return;
      const i = Number(m.dataset.i);
      const c = this.captions[i];
      if (!c) return;
      let at: number;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') at = nudge(c.at, -1, e.shiftKey);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') at = nudge(c.at, 1, e.shiftKey);
      else if (e.key === 'Home') at = 0;
      else if (e.key === 'End') at = 1;
      else return;
      e.preventDefault();
      this.events.onMove(i, at, true);
      this.render();
      this.markersEl.querySelector<HTMLElement>(`.tl__marker[data-i="${i}"] .tl__label`)?.focus({ preventScroll: true });
    });
  }
}
