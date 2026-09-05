import { test, expect } from '@playwright/test';
import { EDITOR_BASE, adminHeaders, api, seeded } from './fixtures';
import { loginToEditor } from './editor-helpers';

/**
 * M5 Messlatte — Regeltabelle R16 (CONTRIBUTING-visu-m5.md §1): der
 * Editor-Round-Trip. Genau EIN Szenario, der Testname ist das Kriterium.
 *
 * R16 ist die harte Abnahme der Welle: „ohne grünen Round-Trip (R16) gegen
 * echten Server gilt M5 nicht als fertig" (§1). Er braucht zwei Hälften: die
 * Host-Komposition (Teil B, #167) und den V2-Editor in `gui/` (Teil C1, #168).
 *
 * STAND NACH TEIL C1 RUNDE 2 (gemessen an der laufenden Instanz, Zeile probeweise
 * aktiviert und danach zurückgesetzt):
 *
 *  - Schritt 1 (im Editor anlegen) und Schritt 2 (der Server trägt exakt die
 *    gesetzten Werte) laufen **grün** — die Editor-Hälfte steht. Zwei
 *    Affordanzen mussten dafür geschärft werden: die Anmeldung kommt jetzt aus
 *    `editor-helpers.ts`, und `getByLabel('X')` braucht `exact: true`, weil es
 *    als Teilstring sonst auch „Exklusi**x**… öffnen" trifft.
 *  - Schritt 3 scheitert **außerhalb** von C1: `/edomi?popup=<id>` öffnet das
 *    Popup nicht. Diese Adressform verlangt kein anderes Szenario, und im Host
 *    findet sich keine Auswertung von `?popup=` — die Popups von R7/R8 werden
 *    über ihre Link-Kachel geöffnet. Entweder liefert der Host den Deep-Link
 *    nach (Teil B #167), oder dieses Szenario öffnet die neue Seite so, wie R7/R8
 *    es tun. Beides ist eine Entscheidung über den HOST, nicht über den Editor,
 *    und wird deshalb hier nicht im Vorbeigehen getroffen.
 *
 * Der Ablauf steht vollständig da, damit die Lücke sichtbar bleibt und niemand
 * sie für erledigt hält.
 *
 * Der Editor lebt bewusst NICHT in `apps/visu`, sondern in der Admin-GUI
 * (§2.4). Er hat deshalb einen eigenen Ursprung; `GUI_BASE_URL` zeigt darauf
 * (Vorgabe: der Vite-Dev-Port 5173 der Admin-GUI).
 */

const BLOCKED_BY_EDITOR = {
  annotation: {
    type: 'blocked-by',
    description:
      'Teil B Host-Komposition — Micsi/openbridgeserver#167: der Host oeffnet kein per ?popup=<id> ' +
      'verlangtes Popup (Schritt 3). Die Editor-Haelfte (Teil C1 #168) ist geliefert; Schritt 1 und 2 ' +
      'sind gegen die laufende Instanz gruen gemessen. ZWEI Wege fuehren hier heraus, und nur der ' +
      'erste ist #167: entweder liefert der Host den Deep-Link nach, oder dieses Szenario oeffnet die ' +
      'neue Seite ueber eine Link-Kachel wie R7/R8 - die Kachel dorthin zu setzen verlangt aber den ' +
      'Canvas (Teil C2 #169 / C3 #170), denn auf eine frisch angelegte Seite verlinkt noch niemand.',
  },
} as const;

// Der Name, unter dem der Round-Trip seine Seite anlegt. Bewusst außerhalb des
// Seed-Namensraums („M5 …"), damit ein fehlgeschlagener Lauf die Beispielwelt
// nicht anfasst.
const RT_POPUP = 'RT Popup Round-Trip';

test.describe('M5 Regeltabelle R16 · Editor-Round-Trip (Editor steht; wartet auf den Popup-Deep-Link des Hosts)', () => {
  test.fixme(
    'R16 Editor-Round-Trip: im Editor angelegt → gespeichert → Edomi rendert per R1-R15',
    BLOCKED_BY_EDITOR,
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
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();

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
