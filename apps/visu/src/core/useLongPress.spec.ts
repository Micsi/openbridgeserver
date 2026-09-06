import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useLongPress } from './useLongPress';

// M4 · #104 AC1 — der Buzz laeuft ueber @capacitor/haptics, nicht mehr ueber
// navigator.vibrate. Gemockt wird deshalb genau das Plugin: der echte Web-Pfad
// (der `navigator.vibrate` braucht und ohne es wirft) wird im Produktionsbuild
// gemessen, siehe e2e-pwa/haptics.spec.ts.
vi.mock('@capacitor/haptics', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/haptics')>('@capacitor/haptics');
  return { ...actual, Haptics: { impact: vi.fn(async () => undefined) } };
});

/**
 * Long-press composable contract (port of the prototype `useLongPress` in
 * reference/vue-ionic/store.js, see MIGRATION.md §2 / §7):
 *  - fires after 420 ms of sustained press
 *  - cancels on pointerup / pointerleave before the threshold
 *  - aborts if the pointer moves more than 10 px in either axis
 *  - suppresses the native context menu
 *  - emits a haptic buzz when it fires (@capacitor/haptics, #104 AC1)
 */

function down(x = 0, y = 0): PointerEvent {
  return { clientX: x, clientY: y } as unknown as PointerEvent;
}

describe('useLongPress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fires the callback after 420 ms of sustained press', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down());
    expect(cb).not.toHaveBeenCalled();
    expect(lp.fired).toBe(false);

    vi.advanceTimersByTime(419);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(lp.fired).toBe(true);
  });

  it('honours a custom threshold via the ms option', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb, { ms: 1000 });

    lp.onPointerdown(down());
    vi.advanceTimersByTime(420);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(580);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cancels on pointerup before the threshold', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down());
    vi.advanceTimersByTime(200);
    lp.onPointerup();

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    expect(lp.fired).toBe(false);
  });

  it('cancels on pointerleave before the threshold', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down());
    vi.advanceTimersByTime(200);
    lp.onPointerleave();

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancels on pointercancel before the threshold', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down());
    vi.advanceTimersByTime(200);
    lp.onPointercancel();

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    expect(lp.fired).toBe(false);
  });

  it('aborts when the pointer moves more than 10 px on the x axis', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down(0, 0));
    lp.onPointermove(down(11, 0));

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('aborts when the pointer moves more than 10 px on the y axis', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down(0, 0));
    lp.onPointermove(down(0, 11));

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('tolerates small movements within the 10 px threshold', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down(0, 0));
    lp.onPointermove(down(10, 10));

    vi.advanceTimersByTime(420);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('suppresses the native context menu', () => {
    const lp = useLongPress(vi.fn());
    const preventDefault = vi.fn();

    lp.onContextmenu({ preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('emits the haptic buzz through @capacitor/haptics when it fires', () => {
    const impact = vi.mocked(Haptics.impact);
    impact.mockClear();

    const lp = useLongPress(vi.fn());
    lp.onPointerdown(down());
    vi.advanceTimersByTime(420);

    expect(impact).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith({ style: ImpactStyle.Light });
  });

  it('does not buzz when the press is cancelled before the threshold', () => {
    const impact = vi.mocked(Haptics.impact);
    impact.mockClear();

    const lp = useLongPress(vi.fn());
    lp.onPointerdown(down());
    vi.advanceTimersByTime(200);
    lp.onPointerup();
    vi.advanceTimersByTime(1000);

    expect(impact).not.toHaveBeenCalled();
  });

  // Dass ein FEHLSCHLAG der Haptik die Geste nicht abbricht, ist hier bewusst
  // NICHT getestet: `vi.fn()` haengt sich selbst an das Ergebnis einer Mock-
  // Promise (vitest fuehrt `mock.settledResults`), also ist eine gemockte
  // Rejection nie „unhandled" — ein Test darauf bestuende auch ohne `.catch()`
  // in useLongPress (gegengeprobt: `.catch()` entfernt, Test blieb gruen). Der
  // Beweis laeuft deshalb gegen den echten Plugin-Web-Pfad im Produktionsbuild:
  // e2e-pwa/haptics.spec.ts.

  it('resets the fired flag on a fresh pointerdown', () => {
    const cb = vi.fn();
    const lp = useLongPress(cb);

    lp.onPointerdown(down());
    vi.advanceTimersByTime(420);
    expect(lp.fired).toBe(true);

    lp.onPointerdown(down());
    expect(lp.fired).toBe(false);
  });
});
