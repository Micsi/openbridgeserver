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
import { ADMIN, EDITOR_BASE } from './fixtures';

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
 * Admin-Login + Visu-Editor auf einer geseedeten Seite öffnen.
 *
 * VORBEDINGUNG SPRACHE (M5 C2, Issue #169): die Editor-Szenarien sprechen ihre
 * Bedienelemente auf DEUTSCH an (`getByLabel('Rasterweite')`, `getByRole(…,
 * { name: 'Verteilen' })`) — die Admin-GUI wählt ihre Sprache aber aus
 * `navigator.language`, und `playwright.config.ts` pinnt den Kontext bewusst auf
 * `en-US`, damit die ENGLISCHEN Zusicherungen der Visu-Szenarien (auth-Texte, access-Texte)
 * deterministisch bleiben. Ohne Vorgabe stünde in der GUI also Englisch, und
 * jedes Editor-Szenario scheiterte an der Anmeldemaske statt an seiner Aussage.
 * Deshalb wird die Sprachwahl der GUI (`localStorage`-Schlüssel `obs-locale`,
 * siehe `gui/src/i18n.js`) hier gesetzt, bevor die erste Seite lädt. Das ist eine
 * VORBEDINGUNG, keine Erwartung: keine Behauptung eines Szenarios ändert sich.
 */
export async function openEditor(page: Page, pageId: string) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('obs-locale', 'de');
    } catch {
      // Ein Kontext ohne Storage ist kein Grund, das Szenario hier abzubrechen.
    }
  });
  await page.goto(`${EDITOR_BASE}/login`);
  await page.getByLabel('Benutzername').fill(ADMIN.username);
  await page.getByLabel('Passwort').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  // Erst wenn die Anmeldung GELANDET ist, darf navigiert werden: `click()` kehrt
  // zurück, sobald der Klick zugestellt ist, nicht wenn die Antwort da ist — ein
  // sofortiges `goto` bricht die laufende Anfrage ab, das Token liegt dann nie im
  // Speicher, und die Wache der admin-pflichtigen Route leitet auf die
  // Anmeldemaske zurück. Gemessen: ohne dieses Warten scheitert JEDES
  // Editor-Szenario an `.editor-canvas`, obwohl der Editor steht.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.goto(`${EDITOR_BASE}/visu-editor/${pageId}`);
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
