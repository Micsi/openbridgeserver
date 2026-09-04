import { test, expect } from '@playwright/test';
import { seeded } from './fixtures';
import { C5, box, el, openEditor } from './editor-helpers';

/**
 * M5 Messlatte: Editor-Matrix E14 (CONTRIBUTING-visu-m5.md §1.1).
 *
 * Eigene Datei, weil E14 als einziges Szenario der Matrix eine echte
 * Touch-Eingabe braucht: `page.touchscreen` verweigert ohne `hasTouch` im
 * Kontext den Dienst („hasTouch must be enabled on the browser context before
 * using the touchscreen.", Playwright 1.62.1, nachgemessen in beiden
 * Projekten), und alle übrigen
 * Szenarien der Suite brauchen ausdrücklich das Gegenteil (Maus-Semantik für
 * die `.login-*`/`.access-gate*`-Klicks, siehe `playwright.config.ts`). Beides
 * in einem Projekt geht nicht.
 *
 * `playwright.config.ts` fährt deshalb ein zweites Projekt `chromium-touch`,
 * das genau diese Datei mit `hasTouch: true` fährt; das Projekt `chromium`
 * nimmt sie aus. Das `test.use` unten wiederholt die Anforderung in der Datei
 * selbst, damit sie auch dann gilt, wenn jemand diese Datei einmal aus einem
 * anderen Projekt heraus fährt.
 *
 * Ohne diese Vorkehrung wäre E14 ein `fixme`, das auch nach Lieferung von Teil
 * C5 nicht grün werden könnte: es scheiterte an der Konfiguration des Harness
 * statt an einer Aussage über den Editor, und nähme damit nichts ab.
 */

test.use({ hasTouch: true });

test.describe('M5 Editor-Matrix E14 · Touch-Eingabe (wartet auf Teil C5)', () => {
  test.fixme(
    'E14 Touch-Drag/-Resize eines Widgets im Editor bewegt es um dieselbe Distanz wie Maus-Drag (page.touchscreen)',
    C5,
    async ({ page }) => {
      const fx = seeded();
      await openEditor(page, fx.m5.node_ids.solo);

      // Erste Behauptung des Szenarios ist die über den Harness selbst: läuft es
      // ohne Touch-Fähigkeit, ist das Ergebnis wertlos, und das soll man an
      // dieser Zeile sehen und nicht an einer Meldung über `tap`.
      expect(await page.evaluate(() => navigator.maxTouchPoints > 0 || 'ontouchstart' in window)).toBe(true);

      const start = await box(page, fx.m5.widgets.solo);
      const handle = (await el(page, fx.m5.widgets.solo).boundingBox())!;
      const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      const DISTANCE = 60;

      // (a) Maus-Drag um 60 px, der Bezugswert, gegen den Touch gemessen wird.
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + DISTANCE, from.y, { steps: 10 });
      await page.mouse.up();
      const afterMouse = await box(page, fx.m5.widgets.solo);
      const mouseDelta = afterMouse.x - start.x;
      expect(mouseDelta).toBeGreaterThan(0);

      // (b) Zurück auf den Ausgangswert, damit beide Wege bei derselben Marke
      //     beginnen; sonst verglichen wir zwei verschiedene Startlagen.
      await page.keyboard.press('Control+z');
      expect(await box(page, fx.m5.widgets.solo)).toMatchObject({ x: start.x });

      // (c) Derselbe Zug per Finger. `page.touchscreen.tap` setzt den Finger auf
      //     das Element (das ist die Affordanz, die die Planzeile wörtlich
      //     nennt); die Bewegung selbst fährt als Touch-Sequenz über dasselbe
      //     Element, weil Playwrights Touchscreen-API kein Ziehen kennt.
      await page.touchscreen.tap(from.x, from.y);
      const target = el(page, fx.m5.widgets.solo);
      const touchPoint = (x: number) => ({ identifier: 0, clientX: x, clientY: from.y, pageX: x, pageY: from.y });
      await target.dispatchEvent('touchstart', {
        touches: [touchPoint(from.x)],
        changedTouches: [touchPoint(from.x)],
        targetTouches: [touchPoint(from.x)],
      });
      await target.dispatchEvent('touchmove', {
        touches: [touchPoint(from.x + DISTANCE)],
        changedTouches: [touchPoint(from.x + DISTANCE)],
        targetTouches: [touchPoint(from.x + DISTANCE)],
      });
      await target.dispatchEvent('touchend', {
        touches: [],
        changedTouches: [touchPoint(from.x + DISTANCE)],
        targetTouches: [],
      });

      // (d) Die Zeile selbst: dieselbe Distanz, nicht nur „auch bewegt".
      const afterTouch = await box(page, fx.m5.widgets.solo);
      expect(afterTouch.x - start.x).toBe(mouseDelta);
      expect(afterTouch).toMatchObject({ x: afterMouse.x, y: afterMouse.y });
    },
  );
});

