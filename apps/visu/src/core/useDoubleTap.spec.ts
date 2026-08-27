import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDoubleTap } from './useDoubleTap';

/**
 * Double-tap composable contract (gesture Zielmodell, vom User festgelegt):
 *  - fires when two taps land on the SAME tile within the 300 ms window,
 *  - does NOT fire when the second tap is too slow,
 *  - does NOT fire when the second tap lands on a different tile,
 *  - does NOT fire for taps outside any tile,
 *  - sets `fired` for the completing tap so the grid can suppress the single-tap
 *    dispatch, and resets it on the next fresh tap.
 */

/** Build a `.skin-host-cell[data-id]` wrapping a child, and a pointer event on it. */
function tapOn(id: string): PointerEvent {
  const cell = document.createElement('div');
  cell.className = 'skin-host-cell';
  cell.dataset.id = id;
  const child = document.createElement('button');
  cell.appendChild(child);
  return { target: child } as unknown as PointerEvent;
}

/** A pointer event whose target is outside any tile cell. */
function tapOutside(): PointerEvent {
  return { target: document.createElement('div') } as unknown as PointerEvent;
}

describe('useDoubleTap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fires when two taps hit the same tile within the window', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    dt.onPointerdown(tapOn('kueche-roll'));
    expect(cb).not.toHaveBeenCalled();
    expect(dt.fired).toBe(false);

    vi.advanceTimersByTime(200);
    dt.onPointerdown(tapOn('kueche-roll'));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(dt.fired).toBe(true);
  });

  it('does not fire when the second tap is too slow (window elapsed)', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    dt.onPointerdown(tapOn('kueche-roll'));
    vi.advanceTimersByTime(301); // window (300 ms) has expired
    dt.onPointerdown(tapOn('kueche-roll'));

    expect(cb).not.toHaveBeenCalled();
    expect(dt.fired).toBe(false);
  });

  it('honours a custom window via the ms option', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb, { ms: 500 });

    dt.onPointerdown(tapOn('t'));
    vi.advanceTimersByTime(400); // still inside the widened window
    dt.onPointerdown(tapOn('t'));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the second tap lands on a different tile', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    dt.onPointerdown(tapOn('kueche-roll'));
    vi.advanceTimersByTime(100);
    dt.onPointerdown(tapOn('wiga-jalousie')); // different tile → sequence resets

    expect(cb).not.toHaveBeenCalled();
    expect(dt.fired).toBe(false);
  });

  it('treats a reset (different tile) as a new first tap that can still complete', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    dt.onPointerdown(tapOn('a'));
    dt.onPointerdown(tapOn('b')); // resets: now "b" is the pending first tap
    dt.onPointerdown(tapOn('b')); // second "b" within the window → fires

    expect(cb).toHaveBeenCalledTimes(1);
    expect(dt.fired).toBe(true);
  });

  it('never fires for taps outside any tile (id === null)', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    dt.onPointerdown(tapOutside());
    dt.onPointerdown(tapOutside());

    expect(cb).not.toHaveBeenCalled();
    expect(dt.fired).toBe(false);
  });

  it('never fires for a non-Element target (id === null)', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    // e.g. a pointer event whose target is null – tileIdFor resolves no cell.
    dt.onPointerdown({ target: null } as unknown as PointerEvent);
    dt.onPointerdown({ target: null } as unknown as PointerEvent);

    expect(cb).not.toHaveBeenCalled();
    expect(dt.fired).toBe(false);
  });

  it('resets the fired flag on a fresh first tap after firing', () => {
    const cb = vi.fn();
    const dt = useDoubleTap(cb);

    dt.onPointerdown(tapOn('t'));
    dt.onPointerdown(tapOn('t'));
    expect(dt.fired).toBe(true);

    dt.onPointerdown(tapOn('t')); // a new first tap
    expect(dt.fired).toBe(false);
  });
});
