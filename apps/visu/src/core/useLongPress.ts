/**
 * useLongPress — long-press gesture composable.
 *
 * Ported 1:1 in behaviour from the prototype `useLongPress` in
 * reference/vue-ionic/store.js (see MIGRATION.md §2 / §7):
 *  - fires after 420 ms of sustained press,
 *  - aborts when the pointer moves more than 10 px in either axis,
 *  - cancels on pointerup / pointerleave / pointercancel,
 *  - suppresses the native context menu.
 *
 * The haptic feedback is encapsulated in {@link buzz} and goes through
 * `@capacitor/haptics` (M4 · #104 AC1): one call for all three platforms — iOS
 * and Android get the native taptic/vibrator, the Web/PWA build gets the
 * plugin's own web implementation on top of `navigator.vibrate`. No platform
 * branch here (tests/single-codebase.test.ts); the plugin owns the dispatch.
 *
 * Pure gesture/timer logic — owns no application state (Goldene Regel 4).
 */
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export interface LongPressOptions {
  /** Press duration in milliseconds before the callback fires. Default 420. */
  ms?: number;
}

export interface LongPressHandlers {
  onPointerdown(e: PointerEvent): void;
  onPointermove(e: PointerEvent): void;
  onPointerup(): void;
  onPointerleave(): void;
  onPointercancel(): void;
  onContextmenu(e: Event): void;
  /** Whether the long-press fired for the current/last press cycle. */
  readonly fired: boolean;
}

/** Movement tolerance: a drag farther than this (px, either axis) cancels. */
const MOVE_TOLERANCE_PX = 10;
/** Default long-press threshold. */
const DEFAULT_MS = 420;

/**
 * Encapsulated haptic feedback (#104 AC1).
 *
 * `ImpactStyle.Light` is the short tick a long-press should give — the closest
 * equivalent to the 8 ms `navigator.vibrate` this replaces (the plugin's web
 * implementation maps Light to a 20 ms pattern).
 *
 * Haptics are best-effort and MUST NOT abort the interaction, and the ONE way
 * they fail is a REJECTED PROMISE — no `try` is needed around this call:
 *  - the shipped web implementation throws `unavailable('Browser does not
 *    support the vibrate API')` when `navigator.vibrate` is missing (Safari,
 *    desktop Firefox), and `impact()` is `async`, so that surfaces as a
 *    rejection;
 *  - a missing implementation throws too, but Capacitor's own proxy raises that
 *    inside the promise chain as well: every throw in
 *    `createPluginMethodWrapper` sits in `loadPluginImplementation().then(…)`
 *    (@capacitor/core@8.5.1/dist/index.js:111-129), and the wrapper always
 *    returns that promise.
 * An earlier `try` around this was therefore unreachable code that no test could
 * enter (it survived every mutation); the `.catch()` is the whole failure path.
 */
function buzz(): void {
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {
    /* no vibration API on this platform — the gesture still stands */
  });
}

export function useLongPress(
  cb: (e: PointerEvent) => void,
  { ms = DEFAULT_MS }: LongPressOptions = {},
): LongPressHandlers {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  let startX = 0;
  let startY = 0;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    onPointerdown(e: PointerEvent): void {
      fired = false;
      startX = e.clientX;
      startY = e.clientY;
      clear();
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        buzz();
        cb(e);
      }, ms);
    },
    onPointermove(e: PointerEvent): void {
      if (
        timer !== null &&
        (Math.abs(e.clientX - startX) > MOVE_TOLERANCE_PX ||
          Math.abs(e.clientY - startY) > MOVE_TOLERANCE_PX)
      ) {
        clear();
      }
    },
    onPointerup(): void {
      clear();
    },
    onPointerleave(): void {
      clear();
    },
    onPointercancel(): void {
      // The browser took over the gesture (pan/zoom) or the contact was aborted;
      // drop the pending timer so the long-press never fires after a cancel.
      clear();
    },
    onContextmenu(e: Event): void {
      e.preventDefault();
    },
    get fired(): boolean {
      return fired;
    },
  };
}
