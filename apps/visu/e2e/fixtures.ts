/**
 * e2e/fixtures — der gemeinsame Zugang zur geseedeten M5-Welt.
 *
 * `seed.py` schreibt `.seeded.json` (gitignoriert, ephemer) mit den erzeugten
 * Knoten-/Datenpunkt-IDs. Die Spezifikationen lesen die IDs hier, statt sie zu
 * raten: Namen sind fix, IDs sind es nicht.
 *
 * Die REST-Aufrufe der Regeltabelle gehen bewusst DIREKT an das Backend
 * (`OBS_BASE`), nicht über den Vite-Proxy des Visu-Dev-Servers — ein
 * Regelbeweis soll nicht an einer Proxy-Konfiguration hängen. Für die
 * UI-Szenarien gilt weiterhin `baseURL` aus `playwright.config.ts`.
 *
 * Alle Zugangsdaten sind Wegwerf-Werte einer ephemeren Testinstanz (siehe
 * e2e/README.md). Tokens werden nur im Speicher gehalten und wandern nie in
 * eine URL, einen Query-Parameter oder eine Log-Zeile.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Das Backend, gegen das die Regeltabelle geprüft wird. */
export const OBS_BASE = (process.env.OBS_BASE ?? 'http://127.0.0.1:8080').replace(/\/$/, '');

/**
 * Die Admin-GUI, in der der V2-Editor lebt (§2.4: Authoring liegt in `gui/`,
 * nicht in `apps/visu`). Nur die E-Szenarien nutzen sie; sie sind allesamt noch
 * `fixme`, bis C1-C6 liefern.
 */
export const EDITOR_BASE = (process.env.GUI_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');

/** Wegwerf-Owner der ephemeren E2E-Instanz (e2e/README.md Schritt 2). */
export const ADMIN = {
  username: process.env.OBS_ADMIN_USER ?? 'admin',
  password: process.env.OBS_ADMIN_PASSWORD ?? 'e2e-admin-pw',
};

export type M5Key =
  | 'global_a'
  | 'global_b'
  | 'include_ind'
  | 'home'
  | 'solo'
  | 'popup_positioned'
  | 'popup_centered'
  | 'popup_timed'
  | 'popup_modal'
  | 'popup_plain'
  | 'guard_user'
  | 'guard_readonly'
  | 'guard_pin'
  | 'guard_host';

export interface PopupDescriptorFixture {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  auto_close_ms?: number;
  modal?: boolean;
  animate?: boolean;
  shadow?: boolean;
  dim_backdrop?: boolean;
}

export interface M5Fixture {
  pin: string;
  names: Record<M5Key | 'location', string>;
  kinds: Record<M5Key, string>;
  orders: Record<M5Key, number>;
  widgets: Record<M5Key, string>;
  node_ids: Record<M5Key | 'location', string>;
  datapoint_ids: Record<M5Key, string>;
  includes: Partial<Record<M5Key, M5Key[]>>;
  ignore_global_includes: M5Key[];
  popups: Partial<Record<M5Key, PopupDescriptorFixture>>;
  /** Link-Kacheln je Wirtsseite: die Affordanz, die ein Popup öffnet (R7/R8/R11). */
  links: Partial<Record<M5Key, Array<{ widget: string; target: M5Key }>>>;
}

export interface SeededFixture {
  base: string;
  pin: string;
  resident: { username: string; password: string };
  operator: { username: string; password: string };
  pages: Record<string, string>;
  widgets: Record<string, string>;
  node_ids: Record<string, string>;
  datapoint_ids: Record<string, string>;
  m5: M5Fixture;
}

let cached: SeededFixture | null = null;

/**
 * Liest die Seed-Beschreibung. Fehlt sie, ist die Instanz nicht geseedet — das
 * ist ein harter Fehler mit Anleitung, keine stille Notlösung (ein Test, der
 * ohne Fixture grün wird, wäre eine Attrappe).
 */
export function seeded(): SeededFixture {
  if (cached) return cached;
  const path = join(HERE, '.seeded.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `Fixture ${path} fehlt — die Instanz ist nicht geseedet. ` +
        'Erst e2e/README.md Schritte 1-3 ausführen (seed.py gegen das laufende Backend).',
    );
  }
  const parsed = JSON.parse(raw) as SeededFixture;
  if (!parsed.m5?.node_ids?.home) {
    throw new Error(
      `Fixture ${path} stammt aus einem älteren Seed ohne M5-Welt — seed.py erneut ausführen.`,
    );
  }
  cached = parsed;
  return parsed;
}

/** Absolute Backend-URL (die Specs setzen nie eine relative API-URL ab). */
export function api(path: string): string {
  return `${OBS_BASE}/api/v1${path}`;
}

/**
 * Token-Zwischenspeicher je Worker. `POST /auth/login` ist auf 10 Anmeldungen
 * pro Minute begrenzt (`@limiter.limit` in `obs/api/auth.py`); ohne diesen
 * Zwischenspeicher liefe eine Regeltabelle mit einem Dutzend Szenarien in ein
 * 429 und wäre nicht wegen der Regel rot, sondern wegen der Bremse. Die Tokens
 * leben nur im Speicher des Testlaufs — nie in einer URL, Query oder Ausgabe.
 */
const tokenCache = new Map<string, Record<string, string>>();

async function login(
  request: APIRequestContext,
  user: { username: string; password: string },
  onError: (status: number) => string,
): Promise<Record<string, string>> {
  const cached = tokenCache.get(user.username);
  if (cached) return cached;
  const res = await request.post(api('/auth/login'), { data: user });
  if (!res.ok()) throw new Error(onError(res.status()));
  const body = (await res.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${body.access_token}` };
  tokenCache.set(user.username, headers);
  return headers;
}

/**
 * Ein Bearer-Header für den Wegwerf-Owner. Der Token bleibt im Speicher: er
 * wandert weder in eine URL noch in eine Ausgabe.
 */
export async function adminHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  return login(
    request,
    ADMIN,
    (status) =>
      `Admin-Login gegen ${OBS_BASE} fehlgeschlagen (${status}). ` +
      'OBS_ADMIN_USER/OBS_ADMIN_PASSWORD passend zur geseedeten Instanz setzen.',
  );
}

/** Ein Bearer-Header für einen geseedeten Nicht-Admin (resident/operator). */
export async function userHeaders(
  request: APIRequestContext,
  user: { username: string; password: string },
): Promise<Record<string, string>> {
  return login(request, user, (status) => `Login ${user.username} fehlgeschlagen (${status})`);
}

/** Die `PageConfig`-Form, wie `GET /visu/pages/{id}` sie liefert. */
export interface PageConfigResponse {
  grid_cols: number;
  grid_row_height: number;
  grid_cell_width: number;
  background: string | null;
  widgets: Array<{ id: string; name: string; type: string; datapoint_id: string | null }>;
  includes: string[];
  ignore_global_includes: boolean;
  popup: {
    x: number | null;
    y: number | null;
    w: number | null;
    h: number | null;
    auto_close_ms: number | null;
    modal: boolean;
    animate: boolean;
    shadow: boolean;
    dim_backdrop: boolean;
  } | null;
}

/** Die `VisuNodeSummary`-Form, wie `GET /visu/tree` und `/visu/nodes/{id}` sie liefern. */
export interface NodeSummary {
  id: string;
  parent_id: string | null;
  name: string;
  type: 'PAGE' | 'LOCATION';
  kind: 'normal' | 'popup' | 'globalInclude';
  order: number;
  access: string | null;
}
