import { test, expect, type Page } from '@playwright/test';
import { adminHeaders, api, seeded, type PageConfigResponse } from './fixtures';

/**
 * M5 Messlatte — Regeltabelle R9-R14 (CONTRIBUTING-visu-m5.md §1): die
 * Komposition. Genau EIN Szenario je Zeile, der Testname ist das Kriterium.
 *
 * R12 ist eine Backend-Validierung (400) und läuft heute. Alles andere in
 * diesem Block ist Host-Komposition: `apps/visu/src/core/obs/compose.ts` leitet
 * den Layer-Stack derzeit noch aus der `parent_id`-Näherung ab („W3b
 * approximation", im Modul selbst dokumentiert) und kennt weder
 * `kind=globalInclude` noch `PageConfig.includes`. Diese Szenarien sind deshalb
 * vollständig ausgeschrieben, aber `fixme` bis Teil B (#167) liefert — nicht
 * ausgelassen und nicht auf eine Attrappe abgesenkt.
 *
 * Die Selektoren sind die des Edomi-Skins (`obs-visu-skins/packages/skins/edomi/
 * src/page.ts`), des einzigen seitenbesitzenden Skins: `.edomi-layer` trägt
 * `data-layer` (die Quellseiten-ID) und `edomi-layer-{global|include|own}`
 * (`PageLayer.origin`).
 */

const BLOCKED_BY_B = {
  annotation: {
    type: 'blocked-by',
    description: 'Teil B Host-Komposition — Micsi/openbridgeserver#167 (compose.ts nutzt noch die parent_id-Näherung)',
  },
} as const;

async function openEdomiPage(page: Page, pageName: string) {
  await page.goto('/edomi');
  await page.locator('.edomi-nav-link', { hasText: pageName }).first().click();
  await expect(page.locator('.edomi-canvas')).toBeVisible();
}

async function clickLinkTile(page: Page, widgetName: string) {
  await page.locator('.edomi-item', { hasText: widgetName }).first().click();
}

/** Die `data-layer`-IDs der Layer eines Ursprungs, in Renderreihenfolge. */
async function layerIds(page: Page, origin: 'global' | 'include' | 'own'): Promise<string[]> {
  return page.locator(`.edomi-canvas .edomi-layer-${origin}`).evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-layer') ?? ''),
  );
}

test.describe('M5 Regeltabelle R12 · Backend-Validierung (läuft gegen das echte Backend)', () => {
  test('R12 Globale Inkludeseiten können keine weiteren Seiten inkludieren (eine Ebene)', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);

    const readCfg = async (id: string) =>
      (await (await request.get(api(`/visu/pages/${id}`), { headers })).json()) as PageConfigResponse;

    const globalCfg = await readCfg(fx.m5.node_ids.global_a);
    expect(globalCfg.includes).toEqual([]);

    // Verboten: eine globale Inkludeseite inkludiert selbst → 400.
    const rejected = await request.put(api(`/visu/pages/${fx.m5.node_ids.global_a}`), {
      headers,
      data: { ...globalCfg, includes: [fx.m5.node_ids.include_ind] },
    });
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).detail).toBe('Eine globale Inkludeseite kann selbst keine Seiten inkludieren');

    // Und die Ablehnung ist folgenlos: nichts wurde gespeichert.
    expect((await readCfg(fx.m5.node_ids.global_a)).includes).toEqual([]);

    // Gegenprobe (die erlaubte Seite der Bedingung): dieselbe Include-Liste auf
    // einer NORMALEN Seite wird angenommen — die Schranke gilt dem Seitentyp,
    // nicht der Liste.
    const homeCfg = await readCfg(fx.m5.node_ids.home);
    const accepted = await request.put(api(`/visu/pages/${fx.m5.node_ids.home}`), {
      headers,
      data: { ...homeCfg, includes: [fx.m5.node_ids.include_ind] },
    });
    expect(accepted.status()).toBe(204);
    expect((await readCfg(fx.m5.node_ids.home)).includes).toEqual([fx.m5.node_ids.include_ind]);
  });
});

test.describe('M5 Regeltabelle R9-R14 · Komposition im Host (wartet auf Teil B, #167)', () => {
  test.fixme(
    'R9 Globale Inkludeseite wird in jede normale Seite inkludiert, nicht in Popups',
    BLOCKED_BY_B,
    async ({ page }) => {
      const fx = seeded();

      // (a) jede normale Seite bekommt beide globalen Inkludeseiten …
      await openEdomiPage(page, fx.m5.names.home);
      expect(await layerIds(page, 'global')).toEqual([fx.m5.node_ids.global_a, fx.m5.node_ids.global_b]);

      await openEdomiPage(page, fx.m5.names.include_ind);
      expect(await layerIds(page, 'global')).toEqual([fx.m5.node_ids.global_a, fx.m5.node_ids.global_b]);

      // (b) … ein Popup dagegen nicht: es zeigt ausschließlich seine eigene Seite.
      await openEdomiPage(page, fx.m5.names.home);
      await clickLinkTile(page, 'M5 Open Positioned');
      const popup = page.locator(`.edomi-popup[data-popup="${fx.m5.node_ids.popup_positioned}"]`);
      await expect(popup).toBeVisible();
      await expect(popup.locator('.edomi-layer-global')).toHaveCount(0);
      await expect(popup.locator(`.edomi-layer[data-layer="${fx.m5.node_ids.popup_positioned}"]`)).toHaveCount(1);
    },
  );

  test.fixme('R10 Mehrere globale Includes: aufsteigend gestapelt, kleinste zuerst', BLOCKED_BY_B, async ({ page }) => {
    const fx = seeded();
    // Bewusste Abweichung von Edomi (§2.2): gestapelt wird nach Knoten-`order`,
    // nicht nach ID. Der Seed vergibt deshalb 10 (Global A) und 20 (Global B).
    expect(fx.m5.orders.global_a).toBeLessThan(fx.m5.orders.global_b);

    await openEdomiPage(page, fx.m5.names.home);
    expect(await layerIds(page, 'global')).toEqual([fx.m5.node_ids.global_a, fx.m5.node_ids.global_b]);

    // „Kleinste zuerst" heißt auch: zuunterst im Stapel. Der erste Layer im DOM
    // liegt unter dem zweiten (Renderreihenfolge = Stapelreihenfolge).
    const globals = page.locator('.edomi-canvas .edomi-layer-global');
    await expect(globals.nth(0)).toHaveAttribute('data-layer', fx.m5.node_ids.global_a);
    await expect(globals.nth(1)).toHaveAttribute('data-layer', fx.m5.node_ids.global_b);
  });

  test.fixme('R11 Direktaufruf einer globalen Inkludeseite zeigt die anderen globalen nicht', BLOCKED_BY_B, async ({ page }) => {
    const fx = seeded();
    await openEdomiPage(page, fx.m5.names.home);

    // Direktaufruf über die Link-Kachel auf „M5 Home".
    await clickLinkTile(page, 'M5 Open Global A');
    await expect(page.locator(`.edomi-canvas[data-page="${fx.m5.node_ids.global_a}"]`)).toBeVisible();

    // Die aufgerufene globale Seite zeigt sich selbst …
    await expect(page.locator(`.edomi-layer[data-layer="${fx.m5.node_ids.global_a}"]`)).toHaveCount(1);
    // … und die ANDERE globale Inkludeseite gerade nicht.
    await expect(page.locator(`.edomi-layer[data-layer="${fx.m5.node_ids.global_b}"]`)).toHaveCount(0);
    await expect(page.getByText(fx.m5.widgets.global_b, { exact: false })).toHaveCount(0);
  });

  test.fixme('R13 Normale Seite kann globale Includes ignorieren', BLOCKED_BY_B, async ({ page }) => {
    const fx = seeded();

    // Die Gegenprobe zuerst: ohne das Flag sind beide globalen Layer da.
    await openEdomiPage(page, fx.m5.names.home);
    expect(await layerIds(page, 'global')).toEqual([fx.m5.node_ids.global_a, fx.m5.node_ids.global_b]);

    // „M5 Solo" trägt `ignore_global_includes: true` → kein globaler Layer,
    // die eigene Seite bleibt vollständig.
    await openEdomiPage(page, fx.m5.names.solo);
    await expect(page.locator('.edomi-canvas .edomi-layer-global')).toHaveCount(0);
    await expect(page.getByText(fx.m5.widgets.global_a, { exact: false })).toHaveCount(0);
    await expect(page.getByText(fx.m5.widgets.solo, { exact: false })).toBeVisible();
  });

  test.fixme('R14 Individuelle Inkludeseite: gewählte Seite wird eingebettet', BLOCKED_BY_B, async ({ page }) => {
    const fx = seeded();
    await openEdomiPage(page, fx.m5.names.home);

    // „M5 Home" inkludiert „M5 Include Gamma" → ein `include`-Layer mit der ID
    // der Quellseite, unter dem eigenen Layer der Wirtsseite.
    expect(await layerIds(page, 'include')).toEqual([fx.m5.node_ids.include_ind]);
    expect(await layerIds(page, 'own')).toEqual([fx.m5.node_ids.home]);

    // Die Widgets der Quellseite erscheinen tatsächlich auf der Wirtsseite …
    await expect(page.getByText(fx.m5.widgets.include_ind, { exact: false })).toBeVisible();
    // … ohne Datenfork: sie tragen dieselbe Element-ID wie auf der Quellseite.
    const embedded = await page
      .locator(`.edomi-layer[data-layer="${fx.m5.node_ids.include_ind}"] .edomi-item`)
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''));
    await openEdomiPage(page, fx.m5.names.include_ind);
    const direct = await page
      .locator(`.edomi-layer[data-layer="${fx.m5.node_ids.include_ind}"] .edomi-item`)
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''));
    expect(embedded).toEqual(direct);
  });
});
