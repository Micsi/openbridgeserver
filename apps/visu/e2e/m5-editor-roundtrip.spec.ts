import { test, expect } from '@playwright/test';
import { ADMIN, EDITOR_BASE, adminHeaders, api, seeded } from './fixtures';

/**
 * M5 Messlatte — Regeltabelle R16 (CONTRIBUTING-visu-m5.md §1): der
 * Editor-Round-Trip. Genau EIN Szenario, der Testname ist das Kriterium.
 *
 * R16 ist die harte Abnahme der Welle: „ohne grünen Round-Trip (R16) gegen
 * echten Server gilt M5 nicht als fertig" (§1). Er braucht beides — den
 * V2-Editor in `gui/` (Teil C1, #168) und die Host-Komposition (Teil B, #167).
 * Beides fehlt heute, deshalb `fixme`: der Ablauf steht vollständig, damit die
 * Lücke sichtbar bleibt und niemand sie für erledigt hält.
 *
 * Der Editor lebt bewusst NICHT in `apps/visu`, sondern in der Admin-GUI
 * (§2.4). Er hat deshalb einen eigenen Ursprung; `GUI_BASE_URL` zeigt darauf
 * (Vorgabe: der Vite-Dev-Port 5173 der Admin-GUI).
 */

const BLOCKED_BY_EDITOR = {
  annotation: {
    type: 'blocked-by',
    description:
      'Teil C1 Editor Baum+Seiteneigenschaften — Micsi/openbridgeserver#168, und Teil B Host-Komposition — Micsi/openbridgeserver#167',
  },
} as const;

// Der Name, unter dem der Round-Trip seine Seite anlegt. Bewusst außerhalb des
// Seed-Namensraums („M5 …"), damit ein fehlgeschlagener Lauf die Beispielwelt
// nicht anfasst.
const RT_POPUP = 'RT Popup Round-Trip';

test.describe('M5 Regeltabelle R16 · Editor-Round-Trip (wartet auf Teil C1 #168 + Teil B #167)', () => {
  test.fixme(
    'R16 Editor-Round-Trip: im Editor angelegt → gespeichert → Edomi rendert per R1-R15',
    BLOCKED_BY_EDITOR,
    async ({ page, request }) => {
      const fx = seeded();
      const headers = await adminHeaders(request);

      // ---- 1) im Editor anlegen (Admin-GUI, hinter dem Admin-Login) --------
      await page.goto(`${EDITOR_BASE}/login`);
      await page.getByLabel('Benutzername').fill(ADMIN.username);
      await page.getByLabel('Passwort').fill(ADMIN.password);
      await page.getByRole('button', { name: 'Anmelden' }).click();

      await page.goto(`${EDITOR_BASE}/visu-editor`);
      await page.getByRole('button', { name: 'Seite anlegen' }).click();
      await page.getByLabel('Name').fill(RT_POPUP);
      // E9/R1: der Seitentyp ist im Editor wählbar und wirksam.
      await page.getByLabel('Seitentyp').selectOption('popup');
      // R2/R3: Position und Maße in Pixeln.
      await page.getByLabel('X').fill('140');
      await page.getByLabel('Y').fill('90');
      await page.getByLabel('Breite').fill('260');
      await page.getByLabel('Höhe').fill('180');
      // R4/R5/R6: Zeitspanne, exklusiv öffnen, Schlagschatten.
      await page.getByLabel('Automatisch schließen (ms)').fill('2000');
      await page.getByLabel('Exklusiv öffnen').check();
      await page.getByLabel('Schlagschatten').check();
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Gespeichert')).toBeVisible();

      // ---- 2) gespeichert: der Server trägt exakt die gesetzten Werte ------
      const treeRes = await request.get(api('/visu/tree'), { headers });
      const created = ((await treeRes.json()) as Array<{ id: string; name: string; kind: string }>).find(
        (n) => n.name === RT_POPUP,
      );
      expect(created, 'die im Editor angelegte Seite steht im Baum').toBeTruthy();
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

      // ---- 3) Edomi rendert die Seite nach R1-R15 --------------------------
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

      // ---- 4) aufräumen: der Round-Trip hinterlässt die Welt wie er sie fand
      const del = await request.delete(api(`/visu/nodes/${created!.id}`), { headers });
      expect(del.status()).toBe(204);
    },
  );
});
