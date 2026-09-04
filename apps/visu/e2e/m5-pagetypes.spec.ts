import { test, expect, request as apiRequest, type Page } from '@playwright/test';
import { adminHeaders, api, seeded, type NodeSummary, type PageConfigResponse } from './fixtures';

/**
 * M5 Messlatte — Regeltabelle R1-R8 (CONTRIBUTING-visu-m5.md §1).
 *
 * Genau EIN Szenario je Zeile; der Testname IST das Kriterium aus dem Plan,
 * damit die Zuordnung Zeile ↔ Szenario eindeutig bleibt.
 *
 * R1-R6 laufen HEUTE gegen das echte Backend: Teil A (#166) hat den Seitentyp
 * und die `PopupConfig` geliefert, und der Deskriptor ist genau das, was Teil B
 * an den Skin durchreicht. Was diese Zeilen ZUSÄTZLICH an Darstellung fordern
 * (die Zentrierung bei fehlender Koordinate, der gerenderte Schatten), hängt an
 * der Host-Komposition und wird über R16 (Editor-Round-Trip) nachgewiesen —
 * siehe e2e/README.md.
 *
 * R7 und R8 sind reine Host-Verhaltensregeln (Timer, mehrere offene Popups).
 * Seit Teil B (#167) geliefert hat, laufen sie: `core/obs/compose.ts` übersetzt
 * `kind=popup`-Seiten in `PopupDescriptor`s, `store.navigate` öffnet sie als
 * Overlay über der aktuellen Seite, und der Offen-Zustand samt Auto-Close-Timer
 * gehört dem Store. Beide Szenarien stehen unverändert so da, wie sie vor der
 * Lieferung geschrieben wurden.
 */

/** Öffnet die Edomi-Seite (der einzige seitenbesitzende Skin) auf einer Wirtsseite. */
async function openEdomiPage(page: Page, pageName: string) {
  await page.goto('/edomi');
  await page.locator('.edomi-nav-link', { hasText: pageName }).first().click();
  await expect(page.locator('.edomi-canvas')).toBeVisible();
}

/** Klickt eine Link-Kachel (`config.target_node_id`) auf der aktuellen Seite. */
async function clickLinkTile(page: Page, widgetName: string) {
  await page.locator('.edomi-item', { hasText: widgetName }).first().click();
}

/**
 * R7 misst die Auto-Close-Frist zeitscharf, deshalb stehen beide Zahlen hier:
 *
 * `AUTO_CLOSE_MS` ist die Frist, die der Seed dem Popup `popup_timed` gibt
 * (`seed.py`: `auto_close_ms: 1500`).
 *
 * `TOLERANCE_MS` ist die zulässige Streuung darum herum. GEMESSEN auf dieser
 * Maschine über zehn Läufe: 1548-1587 ms, Streuung also 39 ms, Median
 * 1560 ms. Das ist reiner Verzug durch Klick-Zustellung, Timer-Auflösung und
 * DOM-Abbau. Die Toleranz muss zwei Bedingungen erfüllen: groß genug für
 * diese Streuung, und klein genug, dass die Frist eines beim Wiederöffnen NEU
 * gestarteten Timers (900 + 1500 = 2400 ms) außerhalb liegt. 400 ms erfüllen
 * beides mit Abstand nach beiden Seiten.
 */
const AUTO_CLOSE_MS = 1500;
const TOLERANCE_MS = 400;

/** Die Knoten, die R1 anlegt, damit das Backend sie ablehnt (siehe dort). */
const BOGUS_NODES = ['M5 Bogus Kind', 'M5 Bogus Folder'];

test.describe('M5 Regeltabelle R1-R6 · Seitentyp + Popup-Deskriptor (läuft gegen das echte Backend)', () => {
  // R1 legt zwei Knoten an, die das Backend ABLEHNEN soll. Bleibt die Ablehnung
  // aus (etwa unter einer Mutationsprobe), steht der Knoten anschließend in der
  // Welt und verfälscht jede Zählung des nächsten Laufs. Ein Harness räumt
  // hinter sich auf, auch und gerade dann, wenn er gerade etwas gefunden hat.
  test.afterAll(async () => {
    const request = await apiRequest.newContext();
    try {
      const headers = await adminHeaders(request);
      const tree = (await (await request.get(api('/visu/tree'), { headers })).json()) as NodeSummary[];
      for (const node of tree.filter((n) => BOGUS_NODES.includes(n.name))) {
        await request.delete(api(`/visu/nodes/${node.id}`), { headers });
      }
    } catch {
      // Aufräumen darf keinen Lauf umbringen; der nächste Seed-Lauf meldet den Rest.
    } finally {
      await request.dispose();
    }
  });

  test('R1 Seitentyp: normal / Inkludeseite / globale Inkludeseite / Popup', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);

    // (a) Alle vier Seitentypen der Referenz existieren im Baum mit dem
    //     erwarteten `kind`. „Inkludeseite" ist dabei keine eigene Enum-Stufe:
    //     eine individuelle Inkludeseite IST eine normale Seite, die woanders in
    //     `includes` steht (§2.1) — genau so wird sie hier belegt.
    const treeRes = await request.get(api('/visu/tree'), { headers });
    expect(treeRes.status()).toBe(200);
    const tree = (await treeRes.json()) as NodeSummary[];
    const byId = new Map(tree.map((n) => [n.id, n]));

    expect(byId.get(fx.m5.node_ids.home)?.kind).toBe('normal');
    expect(byId.get(fx.m5.node_ids.global_a)?.kind).toBe('globalInclude');
    expect(byId.get(fx.m5.node_ids.global_b)?.kind).toBe('globalInclude');
    expect(byId.get(fx.m5.node_ids.popup_positioned)?.kind).toBe('popup');

    const includeSource = byId.get(fx.m5.node_ids.include_ind);
    expect(includeSource?.kind).toBe('normal');
    const homeCfg = (await (await request.get(api(`/visu/pages/${fx.m5.node_ids.home}`), { headers })).json()) as PageConfigResponse;
    expect(homeCfg.includes).toEqual([fx.m5.node_ids.include_ind]);

    // (b) Das Enum ist geschlossen: ein erfundener Seitentyp wird abgelehnt …
    const bogus = await request.post(api('/visu/nodes'), {
      headers,
      data: { name: BOGUS_NODES[0], type: 'PAGE', kind: 'inkludeseite', order: 900, access: 'public' },
    });
    expect(bogus.status()).toBe(422);

    // … und ein Ordner trägt keinen Seitentyp (400, §2.1 `_validate_node_kind`).
    const folder = await request.post(api('/visu/nodes'), {
      headers,
      data: { name: BOGUS_NODES[1], type: 'LOCATION', kind: 'popup', order: 901, access: 'public' },
    });
    expect(folder.status()).toBe(400);
  });

  test('R2 Popup: X/Y-Position in px; fehlt eine Angabe → zentriert', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);

    // Beide Koordinaten gesetzt → der Deskriptor trägt eine vollständige Position.
    const positioned = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_positioned}`), { headers })
    ).json()) as PageConfigResponse;
    expect(positioned.popup).not.toBeNull();
    expect(positioned.popup?.x).toBe(120);
    expect(positioned.popup?.y).toBe(80);

    // Eine Angabe fehlt → sie bleibt `null` und wird NICHT auf 0 vervollständigt.
    // Genau daran erkennt der Host „keine Position" und zentriert (edomi/page.ts:
    // `const centered = !desc.position`). Ein stiller 0-Default würde die Regel
    // unbemerkt in „linksbündig" verwandeln — deshalb ist das die scharfe Kante.
    const centered = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_centered}`), { headers })
    ).json()) as PageConfigResponse;
    expect(centered.popup?.x).toBe(120);
    expect(centered.popup?.y).toBeNull();
  });

  test('R3 Popup: Breite/Höhe in px', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);
    const cfg = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_positioned}`), { headers })
    ).json()) as PageConfigResponse;
    expect(cfg.popup?.w).toBe(300);
    expect(cfg.popup?.h).toBe(200);

    // Gegenprobe: die Maße sind je Popup eigenständig, kein geteilter Default.
    const other = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_plain}`), { headers })
    ).json()) as PageConfigResponse;
    expect(other.popup?.w).toBe(200);
    expect(other.popup?.h).toBe(120);
  });

  test('R4 Popup: automatisch schließen nach Zeitspanne', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);
    const timed = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_timed}`), { headers })
    ).json()) as PageConfigResponse;
    expect(timed.popup?.auto_close_ms).toBe(1500);

    // Beide Seiten der Bedingung: ein Popup ohne Zeitspanne trägt `null`, nicht 0
    // (0 wäre „sofort schließen" und damit eine stille Verhaltensänderung).
    const plain = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_plain}`), { headers })
    ).json()) as PageConfigResponse;
    expect(plain.popup?.auto_close_ms).toBeNull();
  });

  test('R5 Popup: exklusiv öffnen = modal, Rest inert', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);
    const modal = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_modal}`), { headers })
    ).json()) as PageConfigResponse;
    expect(modal.popup?.modal).toBe(true);

    const plain = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_plain}`), { headers })
    ).json()) as PageConfigResponse;
    expect(plain.popup?.modal).toBe(false);
  });

  test('R6 Popup: Animation, Schlagschatten, Hintergrund abdunkeln', async ({ request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);

    const modal = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_modal}`), { headers })
    ).json()) as PageConfigResponse;
    expect(modal.popup?.animate).toBe(true);
    expect(modal.popup?.dim_backdrop).toBe(true);

    // Die drei Flags sind unabhängig: dieses Popup trägt NUR den Schatten.
    const positioned = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_positioned}`), { headers })
    ).json()) as PageConfigResponse;
    expect(positioned.popup?.shadow).toBe(true);
    expect(positioned.popup?.animate).toBe(false);
    expect(positioned.popup?.dim_backdrop).toBe(false);

    // und dieses gar keines.
    const plain = (await (
      await request.get(api(`/visu/pages/${fx.m5.node_ids.popup_plain}`), { headers })
    ).json()) as PageConfigResponse;
    expect(plain.popup?.shadow).toBe(false);
  });
});

test.describe('M5 Regeltabelle R7-R8 · Popup-Verhalten im Host (läuft gegen den Host aus Teil B)', () => {
  test('R7 Auto-Close-Zeit wird beim erneuten Öffnen nicht verlängert', async ({ page }) => {
    const fx = seeded();
    await openEdomiPage(page, fx.m5.names.home);

    const popup = page.locator(`.edomi-popup[data-popup="${fx.m5.node_ids.popup_timed}"]`);

    // Öffnen startet den Timer (auto_close_ms = 1500). Die Uhr läuft ab HIER,
    // also vor dem Klick: die gemessene Frist fällt dadurch eher zu groß aus
    // als zu klein, nie umgekehrt.
    const openedAt = Date.now();
    await clickLinkTile(page, 'M5 Open Timed');
    await expect(popup).toBeVisible();

    // Nach der Hälfte der Zeitspanne erneut öffnen: der Timer darf NICHT neu
    // starten. Die Deadline bleibt die des ersten Öffnens (Edomi-Regel).
    await page.waitForTimeout(900);
    await clickLinkTile(page, 'M5 Open Timed');
    await expect(popup).toBeVisible();

    // Und jetzt ZEITSCHARF: nicht „irgendwann weg“, sondern „zur ursprünglichen
    // Frist weg“. Der Deckel wird ab dem ERSTEN Öffnen gerechnet, nicht ab hier;
    // ein beim Wiederöffnen neu gestarteter Timer (Frist 900 + 1500 = 2400 ms)
    // läuft in diesen Deckel und macht das Szenario rot. Bewusst `waitFor` statt
    // einer retrienden `expect`-Erwartung: die trüge das 7-Sekunden-Fenster aus
    // playwright.config.ts und verschluckte jede Verlängerung bis rund 8,6 s.
    const budgetMs = AUTO_CLOSE_MS + TOLERANCE_MS - (Date.now() - openedAt);
    expect(budgetMs, 'das Hinführen zum Wiederöffnen war langsamer als die Frist').toBeGreaterThan(0);
    await popup.waitFor({ state: 'detached', timeout: budgetMs });
    const closedAfterMs = Date.now() - openedAt;

    // Die untere Schranke faengt ein Wiederoeffnen, das den Timer SOFORT ausloest.
    // Sie ist bewusst keine allgemeine Aussage gegen jedes Verkuerzen: eine Frist,
    // die schon vor dem Wiederoeffnen ablaeuft, zieht danach einen frischen Timer
    // auf und landet wieder im Fenster (gemessenes Blindband rund 0,1 bis 0,89 s).
    // Die Planzeile R7 verlangt nur, dass die Frist nicht VERLAENGERT wird; genau
    // das faengt die obere Schranke ab rund 350 ms Verschiebung.
    expect(closedAfterMs).toBeGreaterThanOrEqual(AUTO_CLOSE_MS - TOLERANCE_MS);
    expect(closedAfterMs).toBeLessThanOrEqual(AUTO_CLOSE_MS + TOLERANCE_MS);
  });

  test('R8 Beliebig viele verschiedene Popups gleichzeitig', async ({ page }) => {
    const fx = seeded();
    await openEdomiPage(page, fx.m5.names.home);

    await clickLinkTile(page, 'M5 Open Positioned');
    await expect(page.locator(`.edomi-popup[data-popup="${fx.m5.node_ids.popup_positioned}"]`)).toBeVisible();

    // Ein zweites, VERSCHIEDENES Popup verdrängt das erste nicht.
    await clickLinkTile(page, 'M5 Open Plain');
    await expect(page.locator(`.edomi-popup[data-popup="${fx.m5.node_ids.popup_plain}"]`)).toBeVisible();
    await expect(page.locator(`.edomi-popup[data-popup="${fx.m5.node_ids.popup_positioned}"]`)).toBeVisible();
    await expect(page.locator('.edomi-popup')).toHaveCount(2);

    // Dasselbe Popup ein zweites Mal zu öffnen erzeugt keine Dublette
    // („verschiedene" Popups, nicht beliebig viele Kopien).
    await clickLinkTile(page, 'M5 Open Plain');
    await expect(page.locator('.edomi-popup')).toHaveCount(2);
  });
});
