/**
 * app/appSettings — the host's own persisted app settings (A7, Issue #144).
 *
 * The Visu had no place for an APP setting: skin tweaks live per page (A6,
 * TweaksPanel), shell chrome flags live per mount (`useShellState`), device
 * state lives in the store — none of them is "a preference for this panel that
 * outlives the session". A7 needs exactly one such preference, so this is the
 * minimal store for it, and the shape the next one joins.
 *
 * Deliberately NOT part of the contract (Goldene Regel 7): this is App-/Host
 * behaviour, not a skin belang. A skin neither reads nor writes it, and the
 * contract does not know the feature exists.
 *
 * Persistence follows the pattern already in the app (`i18n.ts` locale,
 * `core/obs/auth.ts` tokens): a namespaced `localStorage` key, every access
 * wrapped in try/catch so private mode or disabled storage degrades to
 * in-memory-only instead of breaking the app.
 *
 * Daten=JSON, Verhalten=Code: the stored value is a plain number; the only code
 * here is the normaliser and the reactive holder.
 */

import { ref, type Ref } from 'vue';

/** localStorage key — namespaced to the Visu app, one key per setting. */
export const IDLE_RETURN_HOME_STORAGE_KEY = 'obs-visu-idle-return-home-seconds';

/** The disabled value, and the DEFAULT: a panel never jumps away unasked. */
export const IDLE_RETURN_HOME_OFF = 0;
/**
 * Shortest configurable span. Below this the return would fire while somebody is
 * still reading the page they just opened, which reads as a fault, not a feature.
 */
export const IDLE_RETURN_HOME_MIN_SECONDS = 10;
/** Longest configurable span (60 min) — beyond that the feature has no purpose. */
export const IDLE_RETURN_HOME_MAX_SECONDS = 3600;

/**
 * Normalise anything a field, a URL or a storage entry may hand us into a valid
 * setting: whole seconds, either OFF or inside the window.
 *
 * An unparseable or negative value becomes OFF rather than some guessed span —
 * the safe direction for a wall panel is "does not move by itself". A positive
 * value outside the window is clamped rather than rejected, so a typo yields the
 * nearest sensible timeout instead of silently disabling the feature.
 */
export function normalizeIdleReturnHomeSeconds(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return IDLE_RETURN_HOME_OFF;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return IDLE_RETURN_HOME_OFF;
  const seconds = Math.round(n);
  if (seconds < IDLE_RETURN_HOME_MIN_SECONDS) return IDLE_RETURN_HOME_MIN_SECONDS;
  if (seconds > IDLE_RETURN_HOME_MAX_SECONDS) return IDLE_RETURN_HOME_MAX_SECONDS;
  return seconds;
}

/** Read the stored setting; a broken/absent storage reads as OFF. */
function readIdleReturnHomeSeconds(): number {
  try {
    return normalizeIdleReturnHomeSeconds(localStorage.getItem(IDLE_RETURN_HOME_STORAGE_KEY));
  } catch {
    return IDLE_RETURN_HOME_OFF;
  }
}

/**
 * The single reactive holder. Module-level on purpose: the shell (which runs the
 * timer) and the settings panel (which edits it) must see ONE value, and the
 * setting is app-wide, not per component tree.
 */
const idleReturnHomeSeconds: Ref<number> = ref(readIdleReturnHomeSeconds());

/** The app settings surface: read the refs, write through the setters. */
export interface AppSettings {
  /** Seconds of no interaction before the host returns to the start page; 0 = off. */
  readonly idleReturnHomeSeconds: Ref<number>;
  /** Set + persist the idle return span (normalised; 0/empty/garbage = off). */
  setIdleReturnHomeSeconds(value: unknown): void;
}

export function useAppSettings(): AppSettings {
  return { idleReturnHomeSeconds, setIdleReturnHomeSeconds };
}

function setIdleReturnHomeSeconds(value: unknown): void {
  const seconds = normalizeIdleReturnHomeSeconds(value);
  idleReturnHomeSeconds.value = seconds;
  try {
    localStorage.setItem(IDLE_RETURN_HOME_STORAGE_KEY, String(seconds));
  } catch {
    // Storage unavailable (private mode, disabled): the setting still applies
    // for this session — a panel that cannot remember is better than one that
    // crashes on a preference write.
  }
}

/**
 * Re-read every setting from storage — what a fresh app start does. Exists so a
 * test can prove the value actually PERSISTED rather than only sitting in the
 * module ref.
 */
export function reloadAppSettings(): void {
  idleReturnHomeSeconds.value = readIdleReturnHomeSeconds();
}
