import { test, expect } from '@playwright/test';
import { EDITOR_BASE, seeded } from './fixtures';
import { el, openEditor } from './editor-helpers';

/**
 * Der Weg, den ein Mensch nimmt: Editor öffnen → Seite im Baum anklicken →
 * bearbeiten (Micsi/openbridgeserver#192).
 *
 * Die Editor-Matrix fährt jede Seite per Deep-Link an (`openEditor(page, id)`)
 * und hat diesen Weg deshalb nie gesehen: ein Klick im Baum füllte nur die
 * Seiteneigenschaften, der Canvas blieb leer und behauptete, er erscheine,
 * „sobald eine Seite ausgewählt ist". Dieses Szenario startet bewusst OHNE
 * Seiten-ID.
 */

const node = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`[data-node-id="${id}"] > div > .visu-node-label`);

test.describe('M5 Editor - der Klickweg im Seitenbaum (#192)', () => {
  // Zwei Anwendungen (Admin-GUI + Visu im Vorschaurahmen) und ein mögliches
  // Warten auf das Anmelde-Kontingent - dieselbe Begründung wie in der Matrix.
  test.describe.configure({ timeout: 150_000 });

  test('Klick auf eine Seite öffnet sie im Canvas, Klick auf einen Ordner schließt sie wieder', async ({ page }) => {
    const fx = seeded();
    await openEditor(page);

    // Die Kernaussage zuerst: der Klick allein muss die Seite öffnen.
    await node(page, fx.m5.node_ids.home).click();
    await expect(page).toHaveURL(`${EDITOR_BASE}/visu-editor/${fx.m5.node_ids.home}`);
    await expect(el(page, fx.m5.widgets.home)).toBeVisible();
    await expect(page.getByTestId('visu-editor-canvas-hint')).toHaveCount(0);

    await node(page, fx.m5.node_ids.location).click();
    await expect(page).toHaveURL(`${EDITOR_BASE}/visu-editor`);
    await expect(page.getByTestId('visu-editor-folder-hint')).toBeVisible();
    await expect(page.locator(`[data-node-id="${fx.m5.node_ids.location}"]`)).toHaveAttribute('aria-selected', 'true');

    // Die Zurück-Taste bringt die Seite samt Canvas wieder.
    await page.goBack();
    await expect(page).toHaveURL(`${EDITOR_BASE}/visu-editor/${fx.m5.node_ids.home}`);
    await expect(el(page, fx.m5.widgets.home)).toBeVisible();
  });
});
