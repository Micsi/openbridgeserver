import { test, expect, type Locator } from '@playwright/test';
import { seeded } from './fixtures';
import { C5, box, el, openEditor, resizeHandle } from './editor-helpers';

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
      const DISTANCE = 60;

      /**
       * Ein Zug per Finger über `DISTANCE` Pixel nach rechts.
       *
       * `page.touchscreen.tap` setzt den Finger auf (das ist die Affordanz, die
       * die Planzeile wörtlich nennt); die Bewegung selbst fährt als
       * Touch-Sequenz auf demselben Element, weil Playwrights Touchscreen-API
       * kein Ziehen kennt. Beide Hälften der Zeile (Ziehen und Größerziehen)
       * benutzen genau diesen einen Weg, damit sie sich nicht in zwei
       * verschiedenen Nachbildungen unterscheiden.
       */
      async function touchDragRight(target: Locator, from: { x: number; y: number }) {
        const at = (x: number) => ({ identifier: 0, clientX: x, clientY: from.y, pageX: x, pageY: from.y });
        await page.touchscreen.tap(from.x, from.y);
        await target.dispatchEvent('touchstart', { touches: [at(from.x)], changedTouches: [at(from.x)], targetTouches: [at(from.x)] });
        await target.dispatchEvent('touchmove', {
          touches: [at(from.x + DISTANCE)],
          changedTouches: [at(from.x + DISTANCE)],
          targetTouches: [at(from.x + DISTANCE)],
        });
        await target.dispatchEvent('touchend', { touches: [], changedTouches: [at(from.x + DISTANCE)], targetTouches: [] });
      }

      /** Ein Maus-Zug über dieselbe Distanz: der Bezugswert, gegen den gemessen wird. */
      async function mouseDragRight(from: { x: number; y: number }) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + DISTANCE, from.y, { steps: 10 });
        await page.mouse.up();
      }

      /* ------------------------------------------------ (I) Touch-DRAG */

      const tile = el(page, fx.m5.widgets.solo);
      const tileBox = (await tile.boundingBox())!;
      const onTile = { x: tileBox.x + tileBox.width / 2, y: tileBox.y + tileBox.height / 2 };

      // (a) Maus-Drag um 60 px, der Bezugswert.
      await mouseDragRight(onTile);
      const afterMouseDrag = await box(page, fx.m5.widgets.solo);
      const mouseDelta = afterMouseDrag.x - start.x;
      expect(mouseDelta).toBeGreaterThan(0);

      // (b) Zurück auf den Ausgangswert, damit beide Wege bei derselben Marke
      //     beginnen; sonst verglichen wir zwei verschiedene Startlagen.
      await page.keyboard.press('Control+z');
      expect(await box(page, fx.m5.widgets.solo)).toMatchObject({ x: start.x });

      // (c) Derselbe Zug per Finger …
      await touchDragRight(tile, onTile);

      // (d) … und die Zeile selbst: dieselbe Distanz, nicht nur „auch bewegt".
      const afterTouchDrag = await box(page, fx.m5.widgets.solo);
      expect(afterTouchDrag.x - start.x).toBe(mouseDelta);
      expect(afterTouchDrag).toMatchObject({ x: afterMouseDrag.x, y: afterMouseDrag.y });

      /* ---------------------------------------------- (II) Touch-RESIZE */
      // Die zweite Hälfte der Planzeile. Ohne sie behauptete E14 nur das Ziehen,
      // und ein Editor, der per Finger zwar schieben, aber nicht größer ziehen
      // lässt, käme durch.

      // Zurück auf den Ausgangswert, und zwar auch das Maß, nicht nur die Lage.
      await page.keyboard.press('Control+z');
      expect(await box(page, fx.m5.widgets.solo)).toMatchObject({ x: start.x, w: start.w, h: start.h });

      const grip = resizeHandle(page, fx.m5.widgets.solo);
      const gripBox = (await grip.boundingBox())!;
      const onGrip = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };

      // (e) Maus-Resize um dieselben 60 px, der Bezugswert.
      await mouseDragRight(onGrip);
      const afterMouseResize = await box(page, fx.m5.widgets.solo);
      const mouseGrowth = afterMouseResize.w - start.w;
      expect(mouseGrowth).toBeGreaterThan(0);
      // Das Größerziehen an der Ecke verschiebt das Element nicht.
      expect(afterMouseResize).toMatchObject({ x: start.x, y: start.y });

      await page.keyboard.press('Control+z');
      expect(await box(page, fx.m5.widgets.solo)).toMatchObject({ w: start.w, h: start.h });

      // (f) Derselbe Zug am selben Griff, per Finger.
      await touchDragRight(grip, onGrip);

      // (g) Und dieselbe Aussage wie beim Ziehen: dieselbe Distanz, dieselbe Box.
      const afterTouchResize = await box(page, fx.m5.widgets.solo);
      expect(afterTouchResize.w - start.w).toBe(mouseGrowth);
      expect(afterTouchResize).toMatchObject({ w: afterMouseResize.w, h: afterMouseResize.h, x: start.x, y: start.y });
    },
  );
});

