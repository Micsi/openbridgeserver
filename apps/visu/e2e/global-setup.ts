/**
 * e2e/global-setup: nimmt zwei Einmal-Kosten aus dem Zeitbudget der Szenarien.
 *
 * 1. **Warmlauf des Visu-Dev-Servers.** Vite transpiliert beim allerersten
 *    Seitenaufruf on demand; gemessen kostet das die ersten Browser-Szenarien
 *    26 bis 48 s, während dieselben Szenarien gegen denselben, bereits
 *    warmgelaufenen Dev-Server 1,0 bis 2,9 s brauchen. Diese Kosten gehören
 *    nicht in die Zeitmessung eines Szenarios: sie sagen nichts über die Visu
 *    und verschieben nur die Timeout-Decke nach oben. Hier laufen sie einmal,
 *    außerhalb jedes Test-Timeouts.
 *
 * 2. **Ein Login je Principal.** `POST /auth/login` erlaubt 5 Anmeldungen pro
 *    Minute (`obs/api/auth.py`). Drei Anmeldungen hier, abgelegt in
 *    `e2e/.auth/tokens.json`, und der Lauf selbst braucht keine mehr, auch
 *    nicht nach einem Worker-Neustart, den Playwright nach jedem roten
 *    Szenario vornimmt.
 *
 * Beide Schritte sind bewusst NACHSICHTIG: schlägt einer fehl, wird das
 * sichtbar gemeldet und der Lauf beginnt trotzdem. Die Szenarien selbst sind
 * die Instanz, die Fehlerbilder beurteilt; ein globales Setup, das den ganzen
 * Lauf mit einer Zeile abbricht, verdeckt mehr, als es meldet.
 */

import { chromium, request as apiRequest, type FullConfig } from '@playwright/test';
import { EDITOR_BASE, LOGIN_LIMIT, LOGIN_WINDOW_MS, OBS_BASE, VISU_BASE, loginsInWindow, primeTokens } from './fixtures';

/**
 * Anmeldungen, die der Lauf noch braucht und die KEIN Zwischenspeicher abfangen
 * kann: `authz-roles.spec.ts` meldet resident und operator durch die echte
 * Anmeldemaske an, und das ist die Aussage dieser Szenarien, nicht ihr Beiwerk.
 * Das Kontingent muss für sie frei bleiben.
 */
const UI_LOGINS_RESERVED = 2;

/**
 * Die Routen, die die UI-Szenarien anfassen: nur was warm sein muss.
 *
 * `/preview` steht hier seit Runde 2 (Teil C1): der Editor der Admin-GUI laedt
 * diese Route in seinem `iframe` (E3/E9/E15/E19), sie wird also von einem
 * Szenario angefasst - nur eben aus einem anderen Ursprung heraus, weshalb sie
 * bis dahin uebersehen wurde. Ohne den Warmlauf zahlt das erste Editor-Szenario
 * ihre Transpilierung mit.
 */
const WARM_ROUTES = ['/', '/edomi', '/preview'];

/**
 * Die Admin-GUI hat ihren EIGENEN Dev-Server (§2.4: der V2-Editor lebt in
 * `gui/`) und damit ihre eigene Vite-Transpilierung. Gemessen (Runde 2, Teil
 * C1): das erste Editor-Szenario zahlte sie mit ~25 s und lag damit knapp unter
 * der 30-s-Decke - eine Zahl ueber den Dev-Server, nicht ueber den Editor.
 * Deshalb dieselbe Vorkehrung wie fuer die Visu, nur fuer die Anmeldemaske:
 * `/login` zieht die App-Schale samt Abhaengigkeiten herein und kostet KEINE
 * Anmeldung (das Kontingent von 5/Minute bleibt unberuehrt).
 */
const WARM_EDITOR_ROUTES = ['/login'];

async function warmDevServer(baseURL: string, routes: string[]): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    for (const route of routes) {
      const started = Date.now();
      await page.goto(route, { waitUntil: 'networkidle', timeout: 120_000 });
      console.log(`[global-setup] Warmlauf ${baseURL}${route}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? VISU_BASE;

  try {
    await warmDevServer(baseURL, WARM_ROUTES);
  } catch (err) {
    console.warn(
      `[global-setup] Warmlauf gegen ${baseURL} fehlgeschlagen: ${(err as Error).message}\n` +
        '  Läuft der Visu-Dev-Server (e2e/README.md Schritt 4)? Der Lauf startet trotzdem, ' +
        'die ersten Browser-Szenarien tragen dann wieder die Vite-Transpilierung.',
    );
  }

  try {
    await warmDevServer(EDITOR_BASE, WARM_EDITOR_ROUTES);
  } catch (err) {
    console.warn(
      `[global-setup] Warmlauf gegen ${EDITOR_BASE} fehlgeschlagen: ${(err as Error).message}\n` +
        '  Läuft der Admin-GUI-Dev-Server (e2e/README.md Schritt 4b)? Der Lauf startet trotzdem; ' +
        'die Editor-Szenarien (E9, E15) tragen dann die Vite-Transpilierung der Admin-GUI.',
    );
  }

  const request = await apiRequest.newContext();
  try {
    const primed = await primeTokens(request);
    console.log(`[global-setup] Tokens vorab geholt (${OBS_BASE}): ${primed.join(', ') || 'keine'}`);
  } finally {
    await request.dispose();
  }

  await waitForLoginBudget();
}

/**
 * Übergibt erst dann an die Szenarien, wenn im Minutenfenster noch Platz für die
 * UI-Anmeldungen ist.
 *
 * Der Warmlauf hat den Lauf schneller gemacht als das Fenster der Bremse: was
 * sich früher über zwei bis drei Minuten verteilte, fällt jetzt in dieselbe
 * Minute. Ohne diese Übergabe liefe der Harness genau in den Fehler, gegen den
 * er gebaut ist: ein 429 statt einer Aussage. Gewartet wird nur, wenn wirklich
 * zu viel verbraucht ist (im Normalfall: Seed 1 + zwei vorgeholte Tokens 2 +
 * zwei UI-Anmeldungen = 5, also kein Warten), und höchstens ein Fenster lang.
 */
async function waitForLoginBudget(): Promise<void> {
  const used = loginsInWindow();
  const missing = used.length + UI_LOGINS_RESERVED - LOGIN_LIMIT;
  if (missing <= 0) return;
  // So lange warten, bis so viele Anmeldungen aus dem Fenster gefallen sind, wie
  // fehlen; die Liste ist aufsteigend, die `missing`-te ist die entscheidende.
  const freeAt = used[missing - 1]! + LOGIN_WINDOW_MS + 1_000;
  const waitMs = Math.min(Math.max(freeAt - Date.now(), 0), LOGIN_WINDOW_MS + 1_000);
  if (waitMs <= 0) return;
  console.log(
    `[global-setup] ${used.length} von ${LOGIN_LIMIT} Anmeldungen im laufenden Minutenfenster verbraucht; ` +
      `warte ${(waitMs / 1000).toFixed(0)} s, damit die ${UI_LOGINS_RESERVED} UI-Anmeldungen nicht in ein 429 laufen.`,
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
