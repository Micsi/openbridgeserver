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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Das Backend, gegen das die Regeltabelle geprüft wird. */
export const OBS_BASE = (process.env.OBS_BASE ?? 'http://127.0.0.1:8080').replace(/\/$/, '');

/**
 * Der Visu-Dev-Server. EINE Quelle für `playwright.config.ts` (baseURL) und für
 * die Szenarien, die sich einen zweiten Browser-Kontext aufmachen (E3): ein
 * eigener Kontext erbt `baseURL` NICHT aus `use`, und eine zweite Vorgabe in
 * einer zweiten Datei liefe irgendwann auseinander.
 */
export const VISU_BASE = (process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5175').replace(/\/$/, '');

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
 * Token-Zwischenspeicher. `POST /auth/login` ist auf **5 Anmeldungen pro Minute**
 * begrenzt (`@limiter.limit("5/minute")`, `obs/api/auth.py:471`), nicht auf 10,
 * wie hier bis Runde 1 stand. Ohne Zwischenspeicher liefe eine Regeltabelle mit
 * einem Dutzend Szenarien in ein 429 und wäre nicht wegen der Regel rot, sondern
 * wegen der Bremse.
 *
 * Der Speicher liegt bewusst NICHT nur im Modul: Playwright startet nach einem
 * fehlgeschlagenen Szenario einen neuen Worker, und ein modulglobaler Cache ist
 * damit weg. Genau dann, wenn der Harness gebraucht wird, also beim ersten roten
 * Szenario, liefen die Folgeszenarien sonst in die Rate-Limit-Sperre statt in
 * ihre eigentliche Aussage. Deshalb legen sich die Tokens zusätzlich in
 * `e2e/.auth/tokens.json` (gitignoriert, ephemer): ein Worker-Neustart findet
 * sie wieder, `global-setup.ts` füllt sie einmal vor dem Lauf.
 *
 * Tokens wandern weiterhin nie in eine URL, eine Query oder eine Ausgabe.
 */
const tokenCache = new Map<string, Record<string, string>>();

const AUTH_DIR = join(HERE, '.auth');
const TOKEN_STORE = join(AUTH_DIR, 'tokens.json');

/**
 * Die abgelegten Tokens. `obtained` ist der Zeitpunkt der Anmeldung; daran
 * rechnet `global-setup.ts` aus, wie viel vom Kontingent (5 Anmeldungen pro
 * Minute) noch frei ist. `seed.py` schreibt dieselbe Datei im selben Format:
 * der Speicher ist die EINE Stelle, an der der Harness sein Login-Budget führt.
 */
interface TokenStore {
  /** Gegen welches Backend die Tokens gelten; ein Wechsel entwertet sie. */
  base: string;
  tokens: Record<string, { token: string; obtained: number }>;
  /**
   * Zeitstempel JEDER Anmeldung, die der Harness ausgelöst hat, auch der, die
   * kein Token hinterlässt (die UI-Anmeldungen von `authz-roles.spec.ts`) und
   * der, die einen vorhandenen Eintrag überschreibt. Nur so stimmt die
   * Buchführung: das Kontingent zählt Anmeldungen, nicht Nutzernamen.
   */
  logins: number[];
}

/** Das Kontingent aus `obs/api/auth.py:471`, dort `@limiter.limit("5/minute")`. */
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 60_000;

/** Der `exp`-Anspruch eines JWT, ohne Bibliothek: das mittlere Segment ist base64url-JSON. */
function jwtExpiry(token: string): number | null {
  const segment = token.split('.')[1];
  if (!segment) return null;
  try {
    const json = Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function readStore(): TokenStore {
  try {
    const parsed = JSON.parse(readFileSync(TOKEN_STORE, 'utf8')) as TokenStore;
    if (parsed.base !== OBS_BASE || typeof parsed.tokens !== 'object') return { base: OBS_BASE, tokens: {}, logins: [] };
    return { ...parsed, logins: Array.isArray(parsed.logins) ? parsed.logins : [] };
  } catch {
    return { base: OBS_BASE, tokens: {}, logins: [] };
  }
}

function writeStore(store: TokenStore): void {
  try {
    mkdirSync(AUTH_DIR, { recursive: true });
    // Zeitstempel außerhalb des Fensters sind wertlos und würden die Datei nur wachsen lassen.
    store.logins = store.logins.filter((at) => at > Date.now() - LOGIN_WINDOW_MS).sort((a, b) => a - b);
    // Erst schreiben, dann umbenennen: zwei Worker dürfen sich hier nicht
    // gegenseitig eine halbe Datei hinterlassen.
    const tmp = `${TOKEN_STORE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
    renameSync(tmp, TOKEN_STORE);
  } catch {
    // Der Ablage-Fehler darf kein Szenario rot machen: der Speicher im Modul
    // trägt den Lauf weiter, nur ein Worker-Neustart kostet dann einen Login.
  }
}

/**
 * Bucht eine Anmeldung, die durch die echte Anmeldemaske gelaufen ist und
 * deshalb kein Token im Speicher hinterlässt (`authz-roles.spec.ts`). Ohne diese
 * Buchung hielte der nächste Lauf das Kontingent für freier, als es ist, und
 * liefe genau dann in ein 429, wenn zwei Läufe dicht aufeinander folgen.
 */
export function noteBrowserLogin(): void {
  const store = readStore();
  store.logins.push(Date.now());
  writeStore(store);
}

/**
 * Ein abgelegter Token wird nur benutzt, solange er noch mindestens eine Minute
 * gilt; sonst tauschte man das 429 gegen ein 401 ein.
 */
function storedToken(username: string): string | null {
  const entry = readStore().tokens[username];
  if (!entry?.token) return null;
  const exp = jwtExpiry(entry.token);
  if (exp === null || exp * 1000 <= Date.now() + 60_000) return null;
  return entry.token;
}

/**
 * Wie viele Anmeldungen der Harness im laufenden Minutenfenster schon verbraucht
 * hat: Seed und Specs zusammen, weil beide in denselben Speicher schreiben.
 */
export function loginsInWindow(now = Date.now()): number[] {
  return readStore()
    .logins.filter((at) => typeof at === 'number' && at > now - LOGIN_WINDOW_MS)
    .sort((a, b) => a - b);
}

function storeToken(username: string, token: string): void {
  const store = readStore();
  const now = Date.now();
  store.tokens[username] = { token, obtained: now };
  store.logins.push(now);
  writeStore(store);
}

async function login(
  request: APIRequestContext,
  user: { username: string; password: string },
  onError: (status: number) => string,
): Promise<Record<string, string>> {
  const memo = tokenCache.get(user.username);
  if (memo) return memo;

  const fromDisk = storedToken(user.username);
  if (fromDisk) {
    const headers = { Authorization: `Bearer ${fromDisk}` };
    tokenCache.set(user.username, headers);
    return headers;
  }

  const res = await request.post(api('/auth/login'), { data: user });
  if (!res.ok()) {
    if (res.status() === 429) {
      throw new Error(
        `Login ${user.username} lief in die Rate-Limit-Sperre (429). ` +
          '`POST /auth/login` erlaubt 5 Anmeldungen pro Minute (obs/api/auth.py). ' +
          'Eine Minute warten und erneut fahren; `e2e/.auth/tokens.json` hält die Tokens danach über Worker-Neustarts hinweg.',
      );
    }
    throw new Error(onError(res.status()));
  }
  const body = (await res.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${body.access_token}` };
  tokenCache.set(user.username, headers);
  storeToken(user.username, body.access_token);
  return headers;
}

/**
 * Wirft abgelegte Tokens weg, die das Backend nicht (mehr) kennt.
 *
 * Der Speicher überlebt einen DB-Reset der Testinstanz; ein Token aus der alten
 * Datenbank ist danach formal noch gültig, wird aber abgelehnt. Ohne diese
 * Prüfung liefe das erste Szenario in ein 401 und man suchte den Fehler bei der
 * Regel statt beim Zwischenspeicher. Kostet einen Aufruf, aber KEINE Anmeldung.
 */
async function dropTokensRejectedByBackend(request: APIRequestContext): Promise<void> {
  const store = readStore();
  let changed = false;
  for (const [username, entry] of Object.entries(store.tokens)) {
    const res = await request.get(api('/auth/me'), { headers: { Authorization: `Bearer ${entry.token}` } });
    if (res.status() === 401 || res.status() === 403) {
      delete store.tokens[username];
      changed = true;
      console.warn(`[global-setup] abgelegtes Token für ${username} verworfen (Backend lehnt es ab, ${res.status()})`);
    }
  }
  if (changed) writeStore(store);
}

/**
 * Holt die Tokens aller drei Principals EINMAL vor dem Lauf (`global-setup.ts`).
 * Damit kostet der eigentliche Lauf keine Anmeldung mehr, auch nicht nach einem
 * Worker-Neustart.
 *
 * Läuft es dabei in die Rate-Limit-Sperre, wird das Fenster EINMAL ausgesessen
 * statt aufgegeben: hier ist Warten billig (kein Test-Timeout läuft), und ein
 * Lauf, der stattdessen mit halbem Zwischenspeicher startet, verlagert das 429
 * nur in ein Szenario. Ist die Instanz noch nicht geseedet, bleibt es beim
 * Admin-Token; das meldet dann die erste Spec mit ihrer eigenen Meldung.
 */
export async function primeTokens(request: APIRequestContext): Promise<string[]> {
  const users = [ADMIN];
  try {
    const fx = seeded();
    users.push(fx.resident, fx.operator);
  } catch {
    // ohne `.seeded.json` bleibt es beim Admin-Token
  }

  await dropTokensRejectedByBackend(request);

  const primed: string[] = [];
  let waited = false;
  for (const user of users) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await login(request, user, (status) => `Login ${user.username} fehlgeschlagen (${status})`);
        primed.push(user.username);
        break;
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('429') && !waited) {
          waited = true;
          console.warn(`[global-setup] Rate-Limit-Sperre beim Vorabholen; sitze das Minutenfenster einmal aus.`);
          await new Promise((resolve) => setTimeout(resolve, LOGIN_WINDOW_MS + 1_000));
          continue;
        }
        console.warn(`[global-setup] Token für ${user.username} nicht vorab geholt: ${message}`);
        break;
      }
    }
  }
  return primed;
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
