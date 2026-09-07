import { test, expect } from '@playwright/test';
import { EDITOR_BASE, adminHeaders, api, seeded } from './fixtures';
import { loginToEditor, pagePropsSaved, savePageProps } from './editor-helpers';

/**
 * M5 Messlatte — Regeltabelle R16 (CONTRIBUTING-visu-m5.md §1): der
 * Editor-Round-Trip. Genau EIN Szenario, der Testname ist das Kriterium.
 *
 * R16 ist die harte Abnahme der Welle: „ohne grünen Round-Trip (R16) gegen
 * echten Server gilt M5 nicht als fertig" (§1). Er brauchte zwei Hälften: die
 * Host-Komposition (Teil B, #167/#184) und den V2-Editor in `gui/` (Teil C1,
 * #168) — beide stehen jetzt.
 *
 * STAND NACH TEIL B / F3 (Micsi/openbridgeserver#184, gemessen gegen die
 * laufende Instanz):
 *
 *  - Schritt 1 (im Editor anlegen) und Schritt 2 (der Server trägt exakt die
 *    gesetzten Werte) liefen bereits **grün** seit Teil C1 Runde 2.
 *  - Schritt 3 scheiterte bis dahin **außerhalb** von C1: `/edomi?popup=<id>`
 *    öffnete das Popup nicht — im Host fehlte die Auswertung von `?popup=`.
 *    #184 ergänzt sie in `SkinHost.ts`, über dieselbe Stelle wie jede andere
 *    Popup-Öffnung (`store.navigate` prüft selbst `store.popupFor` und ruft
 *    `openPopup`) — keine zweite Bahn neben R7/R8. Damit läuft die ganze
 *    Kette grün und die Zeile ist aktiv.
 *
 * Der Editor lebt bewusst NICHT in `apps/visu`, sondern in der Admin-GUI
 * (§2.4). Er hat deshalb einen eigenen Ursprung; `GUI_BASE_URL` zeigt darauf
 * (Vorgabe: der Vite-Dev-Port 5173 der Admin-GUI).
 */

// Der Name, unter dem der Round-Trip seine Seite anlegt. Bewusst außerhalb des
// Seed-Namensraums („M5 …"), damit ein fehlgeschlagener Lauf die Beispielwelt
// nicht anfasst.
const RT_POPUP = 'RT Popup Round-Trip';

test.describe('M5 Regeltabelle R16 · Editor-Round-Trip', () => {
  test(
    'R16 Editor-Round-Trip: im Editor angelegt → gespeichert → Edomi rendert per R1-R15',
    async ({ page, request }) => {
      const fx = seeded();
      const headers = await adminHeaders(request);

      // ---- 1) im Editor anlegen (Admin-GUI, hinter dem Admin-Login) --------
      // Dieselbe Anmeldung wie in der Editor-Matrix, aus einer Hand
      // (`editor-helpers.ts`): mit dem Sprach-Pin der Admin-GUI und der
      // Wartebedingung auf die abgeschlossene Anmeldung. Beide sind gemessen
      // noetig; eine zweite, eigene Beschreibung derselben Anmeldung lief
      // auseinander (sie stand hier bis Runde 2 ohne beides).
      await loginToEditor(page);

      await page.goto(`${EDITOR_BASE}/visu-editor`);
      await page.getByRole('button', { name: 'Seite anlegen' }).click();
      await page.getByLabel('Name').fill(RT_POPUP);
      // E9/R1: der Seitentyp ist im Editor wählbar und wirksam.
      await page.getByLabel('Seitentyp').selectOption('popup');
      // R2/R3: Position und Maße in Pixeln. `exact: true`, weil `getByLabel`
      // sonst als Teilstring sucht: „X" trifft dann auch „Exklusiv öffnen"
      // (gemessen — Strict-Mode-Verstoß mit zwei Treffern).
      await page.getByLabel('X', { exact: true }).fill('140');
      await page.getByLabel('Y', { exact: true }).fill('90');
      await page.getByLabel('Breite').fill('260');
      await page.getByLabel('Höhe').fill('180');
      // R4/R5/R6: Zeitspanne, exklusiv öffnen, Schlagschatten.
      await page.getByLabel('Automatisch schließen (ms)').fill('2000');
      await page.getByLabel('Exklusiv öffnen').check();
      await page.getByLabel('Schlagschatten').check();
      await savePageProps(page).click();
      await expect(pagePropsSaved(page)).toBeVisible();

      // ---- 2) gespeichert: der Server trägt exakt die gesetzten Werte ------
      const treeRes = await request.get(api('/visu/tree'), { headers });
      const created = ((await treeRes.json()) as Array<{ id: string; name: string; kind: string }>).find(
        (n) => n.name === RT_POPUP,
      );
      expect(created, 'die im Editor angelegte Seite steht im Baum').toBeTruthy();

      try {
        expect(created!.kind).toBe('popup');

        const cfg = await (await request.get(api(`/visu/pages/${created!.id}`), { headers })).json();
        expect(cfg.popup).toMatchObject({
          x: 140,
          y: 90,
          w: 260,
          h: 180,
          auto_close_ms: 2000,
          modal: true,
          shadow: true,
          animate: false,
          dim_backdrop: false,
        });

        // ---- 3) Edomi rendert die Seite nach R1-R15 ------------------------
        // Die Vorschau des Editors ist derselbe Renderer (E3); hier wird der
        // Beweis bewusst in der ECHTEN Visu geführt, nicht im Editor-iframe.
        await page.goto('/edomi');
        await page.locator('.edomi-nav-link', { hasText: fx.m5.names.home }).first().click();
        await page.locator('.edomi-item', { hasText: 'M5 Open Positioned' }).first().click();
        await expect(page.locator(`.edomi-popup[data-popup="${fx.m5.node_ids.popup_positioned}"]`)).toBeVisible();

        // Das neue Popup rendert mit den im Editor gesetzten Eigenschaften:
        // modal (R5, exklusiv → dialog + der Rest inert) und Schlagschatten (R6).
        await page.goto(`/edomi?popup=${created!.id}`);
        const rendered = page.locator(`.edomi-popup[data-popup="${created!.id}"]`);
        await expect(rendered).toBeVisible();
        await expect(rendered).toHaveClass(/has-shadow/);
        await expect(rendered).toHaveAttribute('aria-modal', 'true');
        await expect(page.locator('.edomi-canvas')).toHaveAttribute('inert', '');
        // R9: ein Popup bekommt keine globalen Inkludeseiten.
        await expect(rendered.locator('.edomi-layer-global')).toHaveCount(0);
      } finally {
        // ---- 4) aufräumen: der Round-Trip hinterlässt die Welt wie er sie fand
        // Im `finally`, wie E9 und E15, also AUCH nach einem Fehlschlag. Bis
        // Runde 2 stand das Löschen im geraden Weg: eine probeweise aktivierte,
        // an Schritt 3 gescheiterte Zeile ließ „RT Popup Round-Trip" in der
        // Beispielwelt liegen (gemessen, von Hand nachgeräumt).
        if (created) await request.delete(api(`/visu/nodes/${created.id}`), { headers });
      }
    },
  );
});
