/**
 * e2e/editor-helpers: was sich die Editor-Szenarien teilen.
 *
 * Die Editor-Matrix liegt in zwei Dateien, weil E14 (Touch-Drag) ein
 * Playwright-Projekt mit `hasTouch` braucht und alle anderen Szenarien
 * ausdrücklich die Maus-Semantik behalten sollen (siehe `playwright.config.ts`).
 * Die Bedien-Affordanzen dürfen deshalb nicht zweimal beschrieben werden, denn sie
 * sind die ANFORDERUNG des Harness an den V2-Editor und müssen an einer Stelle
 * stehen, damit C1-C6 gegen eine Anforderung bauen und nicht gegen zwei.
 */

import { expect, type Page } from '@playwright/test';
import { ADMIN, EDITOR_BASE, noteBrowserLogin, waitForLoginSlot } from './fixtures';

/** Die `blocked-by`-Annotation: welcher Teil und welches Issue diese Zeile aufhält. */
export const blockedBy = (part: string, issue: number) =>
  ({
    annotation: {
      type: 'blocked-by',
      description: `Teil ${part} — Micsi/openbridgeserver#${issue} (V2-Editor in gui/ noch nicht gebaut)`,
    },
  }) as const;

export const C1 = blockedBy('C1 Editor Baum + Seiteneigenschaften', 168);
export const C2 = blockedBy('C2 Editor WYSIWYG-Canvas', 169);
export const C3 = blockedBy('C3 Editor Widget-Palette + Bindung', 170);
export const C4 = blockedBy('C4 Editor Vorschau-Brücke + Admin-Einbettung', 171);
export const C5 = blockedBy('C5 Editor Ergonomie', 172);
export const C6 = blockedBy('C6 Editor Dualität + Verlauf', 173);

/**
 * E19 wartet NICHT auf einen Editor-Teil, sondern auf ein FELD.
 *
 * Der Skin je Seite gehoert in die Seite: `PageConfig` (`obs/models/visu.py`)
 * hat heute kein Feld dafuer, `save_page` schreibt `config.model_dump_json()`,
 * und ein zusaetzliches Feld faellt still weg. Gemessen (Runde 1): nach dem
 * Speichern traegt `GET /visu/pages/{id}` keinen Skin, und ein zweiter
 * Browser-Kontext sieht die Vorgabe. Der Editor merkt sich die Wahl deshalb
 * einstweilen je Seite im `localStorage` (`gui/src/utils/visuSkins.js`) - das
 * ist ein Vorschau-Umschalter, keine Seiteneigenschaft, und faerbt diese Zeile
 * nicht gruen. Teil C2 ergaenzt `PageConfig` additiv um das Feld; die Naht im
 * Editor steht und schaltet sich selbst ein, sobald es da ist.
 *
 * NACH DEM MERGE VON C2 faellt an dieser Zeile GENAU EINE Handarbeit an:
 * `test.fixme` → `test` (und diese Annotation weg). Sonst nichts - gemessen
 * (Runde 2: `skin: str | None = None` probeweise in `PageConfig`, Backend neu
 * gestartet, E19 gruen ohne eine Zeile `gui/`). Auch der Hinweistext unter dem
 * Skin-Feld zieht sich selbst nach: er haengt an `store.skinSupported`, also an
 * derselben Erkennung wie die Naht (`gui/src/components/visu/
 * VisuPageProperties.vue`, gepinnt in `VisuPageProperties.spec.js` fuer BEIDE
 * Zustaende). Das Feld existiert bereits auf `integ/visu-m5-c2` (`cdbfe3e7`,
 * `obs/models/visu.py`) unter genau diesem Namen.
 */
export const C2_PAGE_SKIN = {
  annotation: {
    type: 'blocked-by',
    description:
      'Teil C2 — Micsi/openbridgeserver#169 (PageConfig bekommt das Feld fuer den Skin je Seite; bis dahin lebt die Wahl nur im Browser des Autors)',
  },
} as const;

/**
 * Die Sprache der Admin-GUI, in der die Editor-Szenarien ihre Affordanzen
 * suchen.
 *
 * BEGRUENDUNG (M5 C1, #168): jede Beschriftung in diesen Szenarien ist deutsch
 * („Benutzername", „Seitentyp", „Zugriff", „Skin", „Speichern"). Die Admin-GUI
 * waehlt ihre Sprache aber aus `navigator.language`, und `playwright.config.ts`
 * pinnt die auf `en-US` — damit die ENGLISCHEN Seed-Strings der Visu
 * (`auth.*`/`access.*`) deterministisch bleiben. Ohne diese Zeile scheiterten
 * die Editor-Szenarien an der Sprache statt an ihrer Behauptung.
 *
 * Gesetzt wird der Speicher der GUI-Herkunft (`obs-locale`), NICHT der der Visu
 * (`obs-visu-locale`, eigener Schluessel und eigener Origin) — die Visu bleibt
 * englisch, und keine Erwartung eines Szenarios ist angefasst.
 */
const GUI_LOCALE = 'de';

/**
 * Die Anmeldung an der Admin-GUI - EINE Stelle fuer JEDES Editor-Szenario.
 *
 * Auch der Round-Trip R16 (`m5-editor-roundtrip.spec.ts`) meldet sich hierueber
 * an: dieselbe Maske, derselbe Sprach-Pin, dieselbe Wartebedingung. Zwei
 * Beschreibungen derselben Anmeldung laufen unweigerlich auseinander - genau das
 * war sie bis Runde 2 (dort ohne Sprach-Pin und ohne Warten).
 */
export async function loginToEditor(page: Page) {
  // Der Sprach-Pin geht als INIT-SKRIPT hinaus, nicht als `evaluate` + `reload`.
  // Grund, gemessen: die Admin-GUI liest `obs-locale` beim Hochfahren
  // (`gui/src/i18n.js`), ein spaeter gesetzter Wert braucht also einen zweiten
  // vollen Ladevorgang der SPA - und der ist in dieser Suite der teuerste
  // Einzelposten. `addInitScript` laeuft VOR jedem Seitenskript und spart ihn.
  // Es gilt fuer alle Rahmen der Seite, also auch fuer den Vorschau-iframe der
  // Visu; die hat einen eigenen Schluessel (`obs-visu-locale`) und bleibt davon
  // unberuehrt - keine Erwartung eines Szenarios ist angefasst.
  await page.addInitScript((code) => {
    try {
      localStorage.setItem('obs-locale', code as string);
    } catch {
      /* Ein Rahmen ohne Speicherzugriff ist keiner, der die Admin-GUI zeigt. */
    }
  }, GUI_LOCALE);
  // Das Anmelde-Kontingent (5/Minute) VOR der Maske pruefen und notfalls
  // aussitzen - und die Anmeldung danach buchen, so wie `authz-roles.spec.ts`
  // es fuer seine beiden Masken-Anmeldungen tut. Ohne die Buchung haelt der
  // Speicher das Fenster fuer freier, als es ist, und das naechste Szenario
  // laeuft in ein 429, das dann wie ein kaputter Editor aussieht
  // („Login fehlgeschlagen", gemessen im Integrationslauf von Teil C2).
  await waitForLoginSlot();
  await page.goto(`${EDITOR_BASE}/login`);
  await page.getByLabel('Benutzername').fill(ADMIN.username);
  await page.getByLabel('Passwort').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  noteBrowserLogin();
  // Auf die abgeschlossene Anmeldung warten, BEVOR die naechste Adresse geladen
  // wird: `click()` kehrt zurueck, sobald der Klick zugestellt ist, und ein
  // sofortiges `goto` startet die SPA neu, waehrend das Token noch unterwegs ist
  // - die Wache der Admin-Routen leitet dann korrekt zur Anmeldung zurueck
  // (gemessen). Das ist eine Wartebedingung des Harness, keine Erwartung.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

/**
 * Admin-Login + Visu-Editor oeffnen. OHNE `pageId` steht der Editor ohne
 * ausgewaehlte Seite da - der Zustand, in dem eine neue Seite angelegt wird
 * (R16, und die Wirkungshaelfte von E9/E15).
 */
export async function openEditor(page: Page, pageId?: string) {
  await loginToEditor(page);
  await page.goto(`${EDITOR_BASE}/visu-editor${pageId ? `/${pageId}` : ''}`);
  await expect(page.locator('.editor-canvas')).toBeVisible();
}

/** Ein platziertes Element auf dem Editor-Canvas (Marke: `[data-el]`). */
export function el(page: Page, name: string) {
  return page.locator('.editor-canvas [data-el]', { hasText: name }).first();
}

/**
 * Der Anfasser, an dem ein Element größer gezogen wird (Marke:
 * `[data-resize="se"]`, die untere rechte Ecke des ausgewählten Elements).
 *
 * Steht bei den übrigen Bedien-Affordanzen und nicht in der Spec-Datei, die ihn
 * heute allein benutzt (E14): auch das Größerziehen ist eine ANFORDERUNG des
 * Harness an den V2-Editor, und die gehört an dieselbe eine Stelle wie
 * {@link el} und {@link box}.
 */
export function resizeHandle(page: Page, name: string) {
  return el(page, name).locator('[data-resize="se"]');
}

/** Die Box eines Canvas-Elements in Autoren-Einheiten (x/y/w/h aus dem Modell). */
export async function box(page: Page, name: string) {
  return el(page, name).evaluate((node) => ({
    x: Number(node.getAttribute('data-x')),
    y: Number(node.getAttribute('data-y')),
    w: Number(node.getAttribute('data-w')),
    h: Number(node.getAttribute('data-h')),
  }));
}

/**
 * ZWEI „SPEICHERN" IN EINER ANSICHT - und je eines gehört einer anderen Hälfte.
 *
 * Seit C2 neben C1 steht, trägt der Editor beides gleichzeitig: die
 * Seiteneigenschaften (C1: Name, Seitentyp, Zugriff, Includes, Skin) mit ihrem
 * „Speichern", und die Werkzeugleiste des Canvas (C2: Modus, Rasterweite,
 * Breakpoints, Lage) mit ihrem eigenen. Beide Knöpfe heißen für den Autor
 * dasselbe, weil beide dasselbe tun - nur an verschiedenen Eigenschaften
 * derselben Seite.
 *
 * Ein blosses `getByRole('button', { name: 'Speichern' })` trifft deshalb zwei
 * Elemente, und Playwright bricht mit „strict mode violation" ab - eine Aussage
 * über die Ansicht, nicht über das Kriterium der Zeile. Jede Zeile sagt hier
 * darum AUSDRÜCKLICH, welche Hälfte sie meint. Die Beschriftung bleibt Teil der
 * Erwartung (`getByRole` über den zugänglichen Namen), nur der Suchbereich ist
 * eingegrenzt; keine Behauptung ist gesenkt.
 */
export const savePageProps = (page: Page) =>
  page.locator('.visu-page-properties').getByRole('button', { name: 'Speichern' });

/** Die Quittung der Seiteneigenschaften - dieselbe Eingrenzung wie oben. */
export const pagePropsSaved = (page: Page) =>
  page.locator('.visu-page-properties').getByText('Gespeichert', { exact: true });

/** „Speichern" der Canvas-Werkzeugleiste (C2: Modus, Raster, Breakpoints, Lage). */
export const saveCanvas = (page: Page) =>
  page.getByTestId('visu-editor-canvas').getByRole('button', { name: 'Speichern' });

/** Die Quittung des Canvas - dieselbe Eingrenzung wie oben. */
export const canvasSaved = (page: Page) =>
  page.getByTestId('visu-editor-canvas').getByText('Gespeichert', { exact: true });
