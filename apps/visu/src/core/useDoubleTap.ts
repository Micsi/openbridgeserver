/**
 * useDoubleTap – double-tap gesture composable.
 *
 * The gesture Zielmodell (vom User festgelegt): Long-Press öffnet das
 * Positions-Preset-Popover, Double-Tap öffnet das Detail, Single-Tap bedient
 * direkt. This composable owns the double-tap half: it fires a callback when two
 * taps land on the *same* tile within {@link DEFAULT_MS}. A tap on a different
 * tile (or a tap outside any tile) resets the pending sequence.
 *
 * Like {@link useLongPress} it is pure gesture/timer logic and owns no
 * application state (Goldene Regel 4): it only reports *that* a double-tap
 * happened via the callback and the {@link DoubleTapHandlers.fired} flag; the
 * host maps that to `openDetail`.
 *
 * The `fired` flag lets the grid's `onClick` suppress the single-tap dispatch
 * that coincides with the completing (second) tap – exactly as `useLongPress`
 * suppresses the tap after a long-press.
 */

export interface DoubleTapOptions {
  /** Max gap between the two taps in milliseconds. Default 300. */
  ms?: number;
}

export interface DoubleTapHandlers {
  onPointerdown(e: PointerEvent): void;
  /** Whether the double-tap fired for the current/last tap cycle. */
  readonly fired: boolean;
}

/** Default double-tap window: two taps closer than this (ms) count as one. */
const DEFAULT_MS = 300;

/** Resolve the device id a DOM target belongs to (its enclosing tile cell). */
function tileIdFor(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('.skin-host-cell');
  return cell?.dataset.id ?? null;
}

export function useDoubleTap(
  cb: (e: PointerEvent) => void,
  { ms = DEFAULT_MS }: DoubleTapOptions = {},
): DoubleTapHandlers {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  /** The tile id of the pending first tap, or null when no sequence is open. */
  let pendingId: string | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    onPointerdown(e: PointerEvent): void {
      const id = tileIdFor(e.target);
      // A second tap on the SAME tile while the window is still open completes
      // the double-tap. `pendingId` is cleared when the window expires, so a
      // match here already implies the two taps were close enough in time.
      if (id !== null && pendingId !== null && pendingId === id) {
        clear();
        pendingId = null;
        fired = true;
        cb(e);
        return;
      }
      // Otherwise this is a fresh first tap: reset the fired flag (so the next
      // single-tap dispatch is not suppressed) and open a new window. A tap
      // outside any tile (id === null) opens no window and can never complete.
      fired = false;
      pendingId = id;
      clear();
      if (id !== null) {
        timer = setTimeout(() => {
          timer = null;
          pendingId = null;
        }, ms);
      }
    },
    get fired(): boolean {
      return fired;
    },
  };
}
