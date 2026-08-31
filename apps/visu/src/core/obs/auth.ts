/**
 * core/obs/auth — the JWT token store for the obs Visu (guest-by-default).
 *
 * Mirrors the reference Visu (`frontend/src/api/client.ts`) token pattern:
 * `getJwt/setJwt/clearJwt` over `localStorage('visu_jwt')`. Login is **additive**
 * and optional — without a token everything behaves exactly as a guest (no
 * `Authorization` header). A JWT only unlocks per-user RBAC; it is NEVER required
 * for reading.
 *
 * The access token lives under `visu_jwt` (parity with `frontend/`); the refresh
 * token lives separately under `visu_refresh`. Every access is wrapped in
 * try/catch so a missing or broken `localStorage` (private mode, disabled storage,
 * a throwing accessor) degrades to "guest" instead of crashing the app.
 *
 * This module owns only the *storage* of tokens (data). The network flows that
 * obtain them (`login`/`refresh`/`logout`) and the `Authorization: Bearer` wiring
 * live in {@link ObsClient} (behavior).
 */

/** localStorage key for the short-lived access token (24h). Parity with frontend/. */
const ACCESS_KEY = 'visu_jwt';
/** localStorage key for the long-lived refresh token (30d), kept separate. */
const REFRESH_KEY = 'visu_refresh';

/** The stored access token, or null (missing/broken storage → treat as guest). */
export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

/** The stored refresh token, or null (missing/broken storage → treat as guest). */
export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the tokens returned by `/auth/login` or `/auth/refresh`. The refresh
 * token is optional: only written when present, so a refresh response that omits
 * it leaves the existing one untouched. A broken `localStorage` is swallowed —
 * the caller simply stays a guest rather than crashing.
 */
export function setTokens(accessToken: string, refreshToken?: string | null): void {
  try {
    localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {
    /* storage unavailable → stay guest, no crash */
  }
}

/** Drop both tokens (logout / failed refresh) → back to guest. Never throws. */
export function clear(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* storage unavailable → nothing to clear */
  }
}
