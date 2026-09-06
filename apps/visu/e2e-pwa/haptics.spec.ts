import { test, expect, type Page } from '@playwright/test';

/**
 * M4 · Issue #104 AC1 — „useLongPress-Buzz auf @capacitor/haptics umgestellt".
 *
 * Die Unit-Suite (src/core/useLongPress.spec.ts) misst das gegen einen Mock des
 * Plugins: sie belegt, DASS `Haptics.impact({ style: Light })` gerufen wird, aber
 * nicht, dass davon im ausgelieferten Bundle etwas ankommt. Genau das prüft
 * dieser Lauf — gegen den Produktionsbuild, mit dem ECHTEN Plugin:
 *
 *  1. Ein Long-Press auf einer Kachel erreicht `navigator.vibrate`, und zwar mit
 *     dem Muster, das die ausgelieferte Web-Implementierung des Plugins für
 *     `ImpactStyle.Light` vorsieht (node_modules/@capacitor/haptics/dist/esm/
 *     web.js → `patternForImpact`: Light ⇒ `[20]`). `[8]` wäre der alte
 *     `navigator.vibrate(8)`-Pfad, ein anderer Wert ein anderer ImpactStyle.
 *  2. Ohne Vibrations-API (Safari, Desktop-Firefox) wirft dieselbe
 *     Implementierung `unavailable('Browser does not support the vibrate API')`
 *     — und weil `impact()` async ist, wird daraus eine rejected Promise. Die
 *     darf weder unbehandelt bleiben noch die Geste abbrechen.
 *
 * Long-Press ⇒ `presets`, und eine Lampe hat keine Presets, also fällt der Host
 * auf die Detailfläche zurück (DetailModalHost) — das sichtbare `ion-modal` ist
 * deshalb der Beleg, dass die Geste wirklich durchgelaufen ist und nicht nur
 * nichts passiert ist.
 */

/** Die Kachel, auf der gedrückt wird: eine Lampe ⇒ Long-Press öffnet das Detail. */
const TILE = '.skin-host-cell[data-id="kueche-wand"]';
/** `useLongPress` feuert nach 420 ms; 700 ms halten lässt genug Luft. */
const PRESS_MS = 700;

/**
 * Vor dem Laden der Seite: `navigator.vibrate` durch eine Aufzeichnung ersetzen
 * (oder entfernen) und jede unbehandelte Promise-Rejection mitschreiben.
 * `vibrate` liegt auf `Navigator.prototype`, nicht auf der Instanz — ein
 * `delete navigator.vibrate` liefe deshalb ins Leere.
 */
async function instrument(page: Page, vibrateAvailable: boolean): Promise<void> {
  await page.addInitScript((available: boolean) => {
    const w = window as unknown as { __vibrations: unknown[]; __rejections: string[] };
    w.__vibrations = [];
    w.__rejections = [];
    window.addEventListener('unhandledrejection', (event) => w.__rejections.push(String(event.reason)));
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      writable: true,
      value: available
        ? (pattern: unknown): boolean => {
            w.__vibrations.push(pattern);
            return true;
          }
        : undefined,
    });
  }, vibrateAvailable);
}

/** Ein echter Long-Press auf der Kachel: pointerdown, halten, pointerup. */
async function longPress(page: Page): Promise<void> {
  const cell = page.locator(TILE);
  await expect(cell, `Kachel ${TILE} nicht im Produktionsbuild gefunden`).toHaveCount(1);
  const box = await cell.boundingBox();
  expect(box, 'Kachel hat keine Box — nichts zum Drücken').not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(PRESS_MS);
  await page.mouse.up();
}

test.describe('Haptik im Produktionsbuild (#104 AC1)', () => {
  test('der Long-Press-Buzz erreicht die Plattform-API über @capacitor/haptics', async ({ page }) => {
    await instrument(page, true);
    await page.goto('/', { waitUntil: 'load' });
    await longPress(page);

    // Die Geste ist wirklich durchgelaufen (sonst misst der Rest nichts).
    await expect(page.locator('ion-modal'), 'Long-Press hat keine Detailfläche geöffnet').toBeVisible();

    const vibrations = await page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
    expect(vibrations, 'kein Buzz beim Long-Press — die Haptik erreicht die Plattform-API nicht').toEqual([[20]]);
  });

  test('ohne Vibrations-API bricht weder die Geste noch die Seite', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await instrument(page, false);
    await page.goto('/', { waitUntil: 'load' });

    // Vorbedingung: die API ist in diesem Lauf tatsächlich weg. Ohne diese
    // Zusicherung liefe der Test auf einem Browser MIT Vibration und bewiese nichts.
    expect(
      await page.evaluate(() => typeof navigator.vibrate),
      'navigator.vibrate liess sich nicht entfernen — der Ausfallpfad wurde gar nicht betreten',
    ).toBe('undefined');

    await longPress(page);

    // Die Geste läuft trotz fehlgeschlagener Haptik zu Ende.
    await expect(page.locator('ion-modal'), 'Long-Press bricht ohne Vibrations-API ab').toBeVisible();

    const rejections = await page.evaluate(() => (window as unknown as { __rejections: string[] }).__rejections);
    expect(rejections, 'die fehlgeschlagene Haptik landet als unbehandelte Promise-Rejection').toEqual([]);
    expect(pageErrors, 'JS-Fehler durch die fehlgeschlagene Haptik').toEqual([]);
  });
});
