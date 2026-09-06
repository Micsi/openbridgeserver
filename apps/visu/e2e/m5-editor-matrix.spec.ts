import { test, expect, type Page } from '@playwright/test';
import { EDITOR_BASE, VISU_BASE, adminHeaders, api, seeded } from './fixtures';
import {
  C1,
  C2,
  C3,
  C4,
  C5,
  box,
  canvasSaved,
  el,
  openEditor,
  pagePropsSaved,
  savePageProps,
  saveCanvas,
} from './editor-helpers';

/**
 * M5 Messlatte — Editor-Matrix E1-E19 (CONTRIBUTING-visu-m5.md §1.1).
 *
 * Genau EIN Szenario je Zeile; der Testname IST die als Playwright-Kriterium
 * formulierte Fähigkeit aus dem Plan, damit die Zuordnung Zeile ↔ Szenario
 * eindeutig bleibt. E20-E22 stehen bewusst außerhalb des M5-Scopes (§1.1) und
 * haben deshalb hier kein Szenario.
 *
 * ALLE Zeilen sind heute `fixme`: der V2-Editor liegt in `gui/` (§2.4) und ist
 * noch nicht gebaut — die Teile C1-C6 (#168-#173) sind laut §6 auf „offen".
 * Jedes Szenario nennt in seiner Annotation den zuständigen Teil und dessen
 * Issue. Die Szenarien sind vollständig ausgeschrieben, damit C1-C6 gegen eine
 * konkrete Abnahme bauen und nicht gegen eine Beschreibung.
 *
 * Die hier verwendeten Bedien-Affordanzen (Rollen, Beschriftungen, die
 * `[data-el]`-Marke am Canvas-Element) sind die ANFORDERUNG des Harness an den
 * Editor. Wo C1-C6 sich für eine andere, gleichwertige Affordanz entscheiden,
 * zieht der Harness nach; die Behauptung des Szenarios bleibt. Sie stehen in
 * `editor-helpers.ts`, weil E14 in einer eigenen Datei liegt (Touch-Projekt).
 *
 * E14 (Touch-Drag) steht deshalb in `m5-editor-touch.spec.ts`: es braucht ein
 * Playwright-Projekt mit `hasTouch`, alle Szenarien hier brauchen ausdrücklich
 * das Gegenteil.
 */

/** Breite/Höhe eines PNG aus dem IHDR-Kopf, ohne Bibliothek und ohne Dekodierung. */
function pngSize(png: Buffer): { w: number; h: number } {
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

/**
 * Zählt die abweichenden Pixel zweier PNGs, und zwar im Browser, weil er den Dekoder
 * schon mitbringt und der Harness sich dafür keine Abhängigkeit einhandeln soll.
 * `data:`-Bilder färben die Canvas nicht ein, `getImageData` ist also erlaubt.
 * Rückgabe `-1` heißt „verschiedene Abmessungen"; dann ist die Frage nach der
 * Pixelgleichheit gar nicht erst gestellt worden.
 */
async function differingPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([left, right]) => {
      const load = (base64: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('PNG nicht dekodierbar'));
          img.src = `data:image/png;base64,${base64}`;
        });
      const pixels = (img: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [imgA, imgB] = await Promise.all([load(left!), load(right!)]);
      if (imgA.width !== imgB.width || imgA.height !== imgB.height) return -1;
      const dataA = pixels(imgA);
      const dataB = pixels(imgB);
      let differing = 0;
      for (let i = 0; i < dataA.length; i += 4) {
        if (dataA[i] !== dataB[i] || dataA[i + 1] !== dataB[i + 1] || dataA[i + 2] !== dataB[i + 2] || dataA[i + 3] !== dataB[i + 3]) {
          differing += 1;
        }
      }
      return differing;
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

test.describe('M5 Editor-Matrix E1-E19 ohne E14 (wartet auf die Editor-Teile C1-C6)', () => {
  /**
   * Diese Zeilen fahren ZWEI Anwendungen zugleich: die Admin-GUI mit dem Editor
   * und, im Vorschaurahmen, die echte Visu (Ionic + SkinHost + WebSocket). Beide
   * werden geladen, beide wieder abgebaut, und beides zählt in dasselbe Budget.
   * Gemessen auf der Maschine dieses Laufs: 11 bis 23 s je Zeile ruhig, mit den
   * drei parallel arbeitenden Worktrees riss regelmäßig EINE Zeile die
   * 30-Sekunden-Decke — und zwar im ABBAU des Browser-Kontexts („Tearing down
   * context exceeded the test timeout"), nicht in einer Aussage.
   *
   * Das Budget wird deshalb hier angehoben, nicht die Erwartungen: jede einzelne
   * `expect`-Zusicherung behält ihre eigene, kurze Frist aus `playwright.config.ts`
   * (7 s). Eine Zeile, die inhaltlich falsch ist, scheitert also weiterhin
   * schnell; nur die Summe aus Aufbau, zwei Anwendungen und Abbau darf länger
   * dauern.
   *
   * SEIT DER INTEGRATION VON TEIL C2 kommt ein zweiter Posten dazu, der kein
   * Test ist: das Warten auf das Anmelde-Kontingent (5/Minute,
   * `waitForLoginSlot` in `fixtures.ts`). Neun Szenarien melden sich hier durch
   * die echte Maske an - E19 gleich zweimal, weil es einen ZWEITEN
   * Browser-Kontext oeffnet -, und ein volles Fenster kostet bis zu einer
   * Minute Warten. Die Decke traegt deshalb 150 s: 90 s Arbeit wie bisher, plus
   * hoechstens ein Fenster. Wieder ist nur das BUDGET angehoben; jede
   * `expect`-Zusicherung behaelt ihre 7 s.
   */
  test.describe.configure({ timeout: 150_000 });

  test(
    'E1 Element per Drag auf Pixel-Koordinate x/y setzen, Snap rastet bei einstellbarer Rasterweite ein',
    C2,
    async ({ page }) => {
      const fx = seeded();
      await openEditor(page, fx.m5.node_ids.home);
      await page.getByLabel('Rasterweite', { exact: true }).fill('20');

      const target = el(page, fx.m5.widgets.home);
      const before = await box(page, fx.m5.widgets.home);
      const handle = await target.boundingBox();
      // 47 px nach rechts, 33 nach unten: bei Rasterweite 20 muss das Ergebnis
      // auf ein Vielfaches von 20 einrasten, nicht auf 47/33 landen.
      await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle!.x + handle!.width / 2 + 47, handle!.y + handle!.height / 2 + 33, { steps: 10 });
      await page.mouse.up();

      const after = await box(page, fx.m5.widgets.home);
      expect(after.x % 20).toBe(0);
      expect(after.y % 20).toBe(0);
      expect(after.x).toBe(before.x + 40);
      expect(after.y).toBe(before.y + 40);
    },
  );

  test(
    'E2 Reihenfolge/Gruppe eines Elements per Drag setzbar (kein x/y-Feld), Order-Array vor/nach Reload identisch',
    C2,
    async ({ page, request }) => {
      const fx = seeded();
      const headers = await adminHeaders(request);
      const pageUrl = api(`/visu/pages/${fx.m5.node_ids.home}`);
      // Der Layout-Modus ist eine SEITEN-Eigenschaft: dieses Szenario stellt die
      // Beispielseite dauerhaft um. Der Ausgangsstand wird deshalb vorher
      // GELESEN und am Ende zurückgeschrieben — nicht geraten —, damit E4 und E8
      // dieselbe Welt vorfinden wie E1. Das ist Aufbau, keine Zusicherung: keine
      // Aussage dieses Szenarios hängt daran.
      const before = await request.get(pageUrl, { headers }).then((r) => r.json());
      try {
        await openEditor(page, fx.m5.node_ids.home);
        // Der responsive Modus: die Seite trägt Reihenfolge statt Koordinaten
        // (Design-Invariante §1.1 — Pixel-Autorenschaft ist ein Angebot).
        await page.getByLabel('Layout-Modus', { exact: true }).selectOption('responsive');
        await expect(page.getByLabel('X', { exact: true })).toHaveCount(0);

        const order = () => page.locator('.editor-canvas [data-el]').evaluateAll((els) => els.map((e) => e.getAttribute('data-el')));
        const vorher = await order();
        // Das letzte Element an die erste Stelle ziehen.
        await page.locator('.editor-canvas [data-el]').last().dragTo(page.locator('.editor-canvas [data-el]').first());
        const nachher = await order();
        expect(nachher).not.toEqual(vorher);
        expect([...nachher].sort()).toEqual([...vorher].sort());

        // Ohne „Speichern": die Reihenfolge überlebt den Reload.
        await page.reload();
        await expect(page.locator('.editor-canvas')).toBeVisible();
        expect(await order()).toEqual(nachher);

        // Und die Invariante selbst, am GESPEICHERTEN Zustand statt am
        // Eingabefeld. Sie lautet seit Runde 3: im responsiven Modus WIRKT keine
        // Koordinate — durchgesetzt im Host über `layout_mode`, nicht dadurch,
        // dass jemand die Zahlen aus der Spalte nimmt. Denn V1 (`frontend/`)
        // liest dieselbe Seite und rechnet `w.x * CELL_W`; aus `null` wird dort
        // `0`, und jede Kachel kollabiert auf `left:0px; width:0px` (R17).
        // Geprüft wird beides — was der Editor SCHICKT und was der Server HÄLT.
        // Die Lage jeder Kachel, nach Id — die Reihenfolge hat sich oben durch
        // das Umsortieren geaendert, die LAGE darf sich davon nicht ruehren.
        const boxesById = (widgets: Record<string, unknown>[]) =>
          Object.fromEntries(widgets.map((w) => [String(w.id), [w.x, w.y, w.w, w.h]]));
        const lageVorher = boxesById(before.widgets);
        expect(Object.keys(lageVorher).length).toBeGreaterThan(1);
        await page.getByLabel('Layout-Modus', { exact: true }).selectOption('responsive');
        const gesendet = page.waitForRequest(
          (req) => req.method() === 'PUT' && req.url().includes(`/visu/pages/${fx.m5.node_ids.home}`),
        );
        await saveCanvas(page).click();
        await expect(canvasSaved(page)).toBeVisible();
        const nutzlast = JSON.parse((await gesendet).postData() ?? '{}');
        expect(nutzlast.layout_mode).toBe('responsive');
        for (const w of nutzlast.widgets ?? []) {
          expect(typeof w.x, 'der Editor nimmt der Seite keine Koordinate mehr ab').toBe('number');
          expect(typeof w.y).toBe('number');
          expect(typeof w.w).toBe('number');
          expect(typeof w.h).toBe('number');
        }
        const gespeichert = await request.get(pageUrl, { headers }).then((r) => r.json());
        expect(gespeichert.layout_mode).toBe('responsive');
        expect(gespeichert.widgets.length).toBeGreaterThan(0);
        for (const w of gespeichert.widgets) {
          for (const [name, wert] of Object.entries({ x: w.x, y: w.y, w: w.w, h: w.h })) {
            expect(typeof wert, `R17: V1 liest ${name} als number, nie als null`).toBe('number');
          }
        }
        // Der Rückweg erfindet nichts: dieselbe Seite auf `pixel` gestellt trägt
        // wieder genau die Lage, die vor dem Wechsel in der Spalte stand. Bis
        // Runde 2 stand hier `0/0/2/2` für JEDE Kachel, übereinander.
        await page.reload();
        await expect(page.locator('.editor-canvas')).toBeVisible();
        await page.getByLabel('Layout-Modus', { exact: true }).selectOption('pixel');
        await saveCanvas(page).click();
        await expect(canvasSaved(page)).toBeVisible();
        const zurueck = await request.get(pageUrl, { headers }).then((r) => r.json());
        expect(zurueck.layout_mode).toBe('pixel');
        expect(boxesById(zurueck.widgets)).toEqual(lageVorher);
      } finally {
        await request.put(pageUrl, { headers, data: before });
      }
    },
  );

  test.fixme(
    'E3 Editor-Vorschau = Live-Renderer, Pixel-Diff Editor- vs. Live-Screenshot = 0 abweichende Pixel außerhalb Editor-Chrome',
    C4,
    async ({ page, browser }) => {
      const fx = seeded();
      await openEditor(page, fx.m5.node_ids.home);
      // Die Vorschau ist die echte Visu in einem iframe (§2.4), kein zweiter
      // Renderer — deshalb muss ihr Inhalt pixelgleich zur Live-Visu sein.
      const preview = page.frameLocator('iframe.editor-preview');
      await expect(preview.locator('.edomi-canvas')).toBeVisible();

      // „Ausserhalb des Editor-Chrome" IST hier der Ausschnitt: fotografiert
      // wird auf BEIDEN Seiten ausschliesslich `.edomi-root`, also der Bereich,
      // den der Live-Renderer zeichnet. Werkzeugleiste, Eigenschaften-Panel und
      // der iframe-Rahmen liegen ausserhalb dieses Ausschnitts und werden
      // deshalb gar nicht erst mitverglichen: nicht wegmaskiert, sondern nie
      // aufgenommen.
      const inEditor = await preview.locator('.edomi-root').screenshot();

      // Die Live-Visu bekommt exakt das Fenster der Vorschau. Ohne das
      // vergleicht man zwei Layouts verschiedener Breite und nicht zwei
      // Renderer; ein Pixel-Diff koennte dann nie 0 werden.
      const frameViewport = await page.locator('iframe.editor-preview').evaluate((node) => ({
        width: Math.round((node as HTMLIFrameElement).clientWidth),
        height: Math.round((node as HTMLIFrameElement).clientHeight),
      }));
      const liveCtx = await browser.newContext({
        baseURL: VISU_BASE,
        viewport: frameViewport,
        deviceScaleFactor: 1,
        locale: 'en-US',
      });
      // Der zweite Kontext gehört diesem Szenario, nicht dem Lauf: `finally`
      // schließt ihn auch dann, wenn die Live-Seite unterwegs scheitert.
      // (`browser` ist eine Worker-Fixture; Playwright räumt nur den Kontext der
      // `page`-Fixture ab, nicht einen selbst geöffneten.)
      const inLive = await (async () => {
        const live = await liveCtx.newPage();
        await live.goto('/edomi');
        await live.locator('.edomi-nav-link', { hasText: fx.m5.names.home }).first().click();
        await expect(live.locator('.edomi-canvas')).toBeVisible();
        return live.locator('.edomi-root').screenshot();
      })().finally(() => liveCtx.close());

      // Gleiche Abmessung ist Vorbedingung, nicht Ergebnis: sie wird getrennt
      // behauptet, damit ein Groessenunterschied als solcher gemeldet wird und
      // nicht als „Millionen abweichender Pixel".
      expect(pngSize(inLive)).toEqual(pngSize(inEditor));
      // Und dann die Zeile selbst: NULL abweichende Pixel in diesem Ausschnitt.
      expect(await differingPixels(page, inEditor, inLive)).toBe(0);
    },
  );

  test(
    'E4 Ausrichtlinie bei Kantendeckung ≤4px, "Verteilen" bei ≥3 Elementen, "gleiche Größe" übernimmt Maße',
    C2,
    async ({ page }) => {
      const fx = seeded();
      await openEditor(page, fx.m5.node_ids.home);

      // (a) Ausrichtlinie erscheint, sobald zwei Kanten auf ≤4px zusammenliegen.
      const first = el(page, fx.m5.widgets.home);
      const handle = await first.boundingBox();
      await page.mouse.move(handle!.x + 4, handle!.y + 4);
      await page.mouse.down();
      await page.mouse.move(handle!.x + 4, handle!.y + 7, { steps: 5 });
      await expect(page.locator('.editor-guide')).toBeVisible();
      await page.mouse.up();

      const xs = () =>
        page.locator('.editor-canvas [data-el]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-x'))));

      // (b) Der ZWEIER-Fall: „Verteilen" ist bei zwei Elementen keine Aussage
      // (es gibt nur einen Abstand) und wird deshalb gar nicht erst angeboten.
      // Er steht hier ausdrücklich, weil Ctrl+A ihn nie erreicht — und ohne ihn
      // bliebe „ab drei" eine Behauptung des Codes statt einer geprüften Regel.
      const alle = page.locator('.editor-canvas [data-el]');
      await alle.nth(0).click();
      await alle.nth(1).click({ modifiers: ['Shift'] });
      await expect(page.locator('.editor-canvas [data-el].is-selected')).toHaveCount(2);
      const verteilen = page.getByRole('button', { name: 'Verteilen' });
      await expect(verteilen).toBeDisabled();
      const vorZwei = await xs();
      await verteilen.click({ force: true });
      expect(await xs()).toEqual(vorZwei);

      // (c) „Verteilen" braucht mindestens drei Elemente und macht die Abstände gleich.
      await page.keyboard.press('Control+a');
      await verteilen.click();
      const nachher = await xs();
      const abstaende = nachher.slice(1).map((x, i) => x - nachher[i]);
      expect(abstaende.length).toBeGreaterThanOrEqual(2);
      expect(new Set(abstaende).size).toBe(1);

      // (c) „Gleiche Größe" überträgt die Maße des zuerst gewählten Elements.
      await page.getByRole('button', { name: 'Gleiche Größe' }).click();
      const sizes = await page
        .locator('.editor-canvas [data-el]')
        .evaluateAll((els) => els.map((e) => `${e.getAttribute('data-w')}x${e.getAttribute('data-h')}`));
      expect(new Set(sizes).size).toBe(1);
    },
  );

  test.fixme('E5 Mehrfachauswahl per Rahmen, Gruppenverschieben, Gruppieren-Aktion', C5, async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.home);

    // Rahmen über den ganzen Canvas ziehen → alles ausgewählt.
    const canvas = (await page.locator('.editor-canvas').boundingBox())!;
    await page.mouse.move(canvas.x + 2, canvas.y + 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width - 2, canvas.y + canvas.height - 2, { steps: 10 });
    await page.mouse.up();
    const selected = page.locator('.editor-canvas [data-el].is-selected');
    expect(await selected.count()).toBeGreaterThan(1);

    // Gruppenverschieben: alle Elemente wandern um DIESELBE Distanz.
    const before = await page.locator('.editor-canvas [data-el]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-x'))));
    await page.keyboard.press('ArrowRight');
    const after = await page.locator('.editor-canvas [data-el]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-x'))));
    expect(after).toEqual(before.map((x) => x + 1));

    // Gruppieren-Aktion fasst die Auswahl zu einer Gruppe zusammen.
    await page.getByRole('button', { name: 'Gruppieren' }).click();
    await expect(page.locator('.editor-canvas [data-group]')).toHaveCount(1);
  });

  test.fixme('E6 Copy/Paste/Duplizieren eines Elements, auch seitenübergreifend', C5, async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.home);

    // Duplizieren auf derselben Seite.
    await el(page, fx.m5.widgets.home).click();
    const before = await page.locator('.editor-canvas [data-el]').count();
    await page.keyboard.press('Control+d');
    await expect(page.locator('.editor-canvas [data-el]')).toHaveCount(before + 1);

    // Kopieren und auf einer ANDEREN Seite einfügen.
    await page.keyboard.press('Control+c');
    await page.goto(`${EDITOR_BASE}/visu-editor/${fx.m5.node_ids.solo}`);
    await expect(page.locator('.editor-canvas')).toBeVisible();
    const targetBefore = await page.locator('.editor-canvas [data-el]').count();
    await page.keyboard.press('Control+v');
    await expect(page.locator('.editor-canvas [data-el]')).toHaveCount(targetBefore + 1);
    await expect(el(page, fx.m5.widgets.home)).toBeVisible();
  });

  test.fixme('E7 Undo/Redo-Stack, Pfeiltasten nudgen selektiertes Element pixelweise', C5, async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.home);
    await el(page, fx.m5.widgets.home).click();

    const before = await box(page, fx.m5.widgets.home);
    // Nudging: eine Pfeiltaste = ein Pixel.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await box(page, fx.m5.widgets.home)).toMatchObject({ x: before.x + 2, y: before.y + 1 });

    // Undo stellt EXAKT den Ausgangszustand wieder her (jeder Schritt einzeln).
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await box(page, fx.m5.widgets.home)).toMatchObject({ x: before.x, y: before.y });

    // Redo führt sie wieder aus.
    await page.keyboard.press('Control+Shift+z');
    expect(await box(page, fx.m5.widgets.home)).toMatchObject({ x: before.x + 1, y: before.y });
  });

  test('E8 Z-Ordnung änderbar (nach vorne/hinten), Element sperr-/ausblendbar', C2, async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.home);
    const target = el(page, fx.m5.widgets.home);
    await target.click();

    // Nach vorne: das Element ist danach das letzte Kind (oberste Ebene).
    await page.getByRole('button', { name: 'Nach vorne' }).click();
    await expect(page.locator('.editor-canvas [data-el]').last()).toHaveAttribute('data-el', await target.getAttribute('data-el') ?? '');
    await page.getByRole('button', { name: 'Nach hinten' }).click();
    await expect(page.locator('.editor-canvas [data-el]').first()).toHaveAttribute('data-el', await target.getAttribute('data-el') ?? '');

    // Sperren: das Element nimmt keine Änderung mehr an — weder per DRAG noch
    // per Tastatur. Beide Wege stehen hier, weil sie im Editor zwei verschiedene
    // Pfade sind: ein gesperrtes Element, das sich ziehen lässt, wäre ungesperrt,
    // auch wenn die Pfeiltaste nichts tut.
    //
    // Davor noch einmal „Nach vorne": das Element liegt nach der Prüfung oben
    // GANZ UNTEN, und ein Zeiger trifft dort das Element DARÜBER statt seiner.
    // Der Drag ginge dann ins Leere und die Sperre bliebe unbelegt (gemessen:
    // mit der Sperre im Drag-Pfad ausgebaut blieb dieses Szenario grün).
    await page.getByRole('button', { name: 'Nach vorne' }).click();
    await page.getByLabel('Gesperrt', { exact: true }).check();
    const locked = await box(page, fx.m5.widgets.home);
    // Und in den sichtbaren Bereich rollen: das Ankreuzfeld „Gesperrt" steht
    // unter dem Canvas, auf dem 393x851-Gerät des Harness rollt das Fenster dafür
    // — ein Zeiger auf eine Koordinate außerhalb des Fensters trifft nichts.
    await target.scrollIntoViewIfNeeded();
    const griff = (await target.boundingBox())!;
    await page.mouse.move(griff.x + griff.width / 2, griff.y + griff.height / 2);
    await page.mouse.down();
    await page.mouse.move(griff.x + griff.width / 2 + 40, griff.y + griff.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    expect(await box(page, fx.m5.widgets.home)).toMatchObject({ x: locked.x, y: locked.y });
    await page.keyboard.press('ArrowRight');
    expect(await box(page, fx.m5.widgets.home)).toMatchObject({ x: locked.x });

    // Ausblenden: das Element verschwindet aus der Vorschau, bleibt aber im Baum.
    //
    // ZUERST muss es dort STEHEN. Ohne diese Zeile ist „verschwindet" eine
    // Behauptung über einen Rahmen, in dem ohnehin nichts von der Visu steht —
    // sie wäre auch dann grün, wenn die Vorschau gar nichts rendert. Sie setzt
    // voraus, dass unter `VITE_VISU_PREVIEW_URL` wirklich die Visu liegt (siehe
    // README, „Vorschau der Editor-Szenarien"); genau dafür ist sie da.
    const inPreview = page
      .frameLocator('iframe.editor-preview')
      .locator(`[data-id="${await target.getAttribute('data-el')}"]`);
    await expect(
      inPreview.first(),
      'die Vorschau muss den Entwurf rendern — VITE_VISU_PREVIEW_URL/VITE_PREVIEW_ALLOWED_ORIGINS setzen (e2e/README.md)',
    ).toBeVisible();
    await page.getByLabel('Ausgeblendet', { exact: true }).check();
    await expect(inPreview).toHaveCount(0);
    await expect(target).toBeVisible();
  });

  test('E9 Seitentypen normal/Include/globalInclude/Popup wählbar und wirksam', C1, async ({ page, request }) => {
    // EIGENE, BEGRUENDETE ZEITGRENZE: nicht die Decke gehoben, sondern diese
    // zwei Zeilen ausgenommen (E9 und E15, sonst keine).
    //
    // Die 30-s-Vorgabe (`playwright.config.ts`) ist an Szenarien geeicht, die
    // die Anwendung EINMAL laden. E9 und E15 belegen als einzige BEIDE Haelften
    // ihrer Planzeile (Form UND Wirkung) und laden die Admin-SPA dafuer dreimal:
    // Anmeldung, die geseedete Seite, und nach dem Speichern die neu angelegte
    // Seite als Gegenprobe (der letzte Ladevorgang IST die Aussage „der Editor
    // liest den gespeicherten Stand zurueck, nicht seinen eigenen"). Gemessen
    // waren es bis Runde 2 fuenf Ladevorgaenge; entschlackt sind es drei: der
    // Sprach-Pin kommt jetzt als Init-Skript statt als `evaluate` + `reload`
    // (`editor-helpers.ts`), und der Zwischen-Ladevorgang auf die neue Seite
    // entfaellt, weil der Store sie nach dem Speichern ohnehin frisch vom
    // Server liest.
    //
    // GEMESSEN an drei Laeufen auf derselben Instanz, unter der Parallellast
    // dieses Projekts (drei Nachbar-Agenten, load 4-7):
    //   * warmer Stapel:  E9 24,6 / 33,6 / 38,1 s, E15 16,6 / 35,6 / 54,9 s;
    //   * KALTER Admin-GUI-Dev-Server (erster Lauf): E9 78 s, E15 66 s.
    // Der Sprung ist keine Aussage ueber den Editor, sondern die
    // Vite-Transpilierung der Editor-Route: `global-setup.ts` waermt `/login`
    // der Admin-GUI vor, die Route `/visu-editor` laesst sich ohne Anmeldung
    // aber nicht mitwaermen, und ihre Einmal-Kosten traegt das ERSTE
    // Editor-Szenario des Laufs. Unter der 30-s-Vorgabe waeren SECHS dieser
    // acht Messungen rot gewesen, und zwar mit „Tearing down context exceeded
    // the test timeout" statt einer gescheiterten Erwartung: eine Aussage ueber
    // die Maschine, nicht ueber den Editor.
    //
    // Die Grenze steht deshalb bei 120 s: ueber der schlechtesten gemessenen
    // Zeit, mit Rand, und immer noch weit unter dem, was ein echter Stillstand
    // braeuchte. Sie gilt NUR fuer diese beiden Zeilen; jede andere bleibt bei
    // 30 s. KEINE Erwartung ist dafuer gesenkt worden.
    // 120 s Arbeit (gemessen, s. oben) plus hoechstens ein Anmelde-Fenster:
    // dieselbe Rechnung wie an der Decke des `describe` seit dem Merge von C2.
    test.setTimeout(180_000);

    const fx = seeded();
    const headers = await adminHeaders(request);
    await openEditor(page, fx.m5.node_ids.popup_positioned);

    // Wählbar: alle vier Seitentypen stehen zur Auswahl …
    const kind = page.getByLabel('Seitentyp');
    await expect(kind.locator('option')).toHaveText([/normal/i, /Inkludeseite/i, /globale Inkludeseite/i, /Popup/i]);
    await expect(kind).toHaveValue('popup');

    // … die Popup-Eigenschaften erscheinen nur beim Typ „Popup",
    // und verbotene Kombinationen werden VOR dem Speichern abgefangen (C1-Gate).
    await expect(page.getByLabel('Automatisch schließen (ms)')).toBeVisible();
    await kind.selectOption('globalInclude');
    await expect(page.getByLabel('Automatisch schließen (ms)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Seite inkludieren' }).click();
    await expect(page.getByText('Eine globale Inkludeseite kann selbst keine Seiten inkludieren')).toBeVisible();
    await expect(savePageProps(page)).toBeDisabled();

    // … UND WIRKSAM heißt: gespeichert und im `GET` wiederzufinden. Ohne diesen
    // zweiten Teil überlebte die Mutation „`kind` fällt aus dem PATCH-Rumpf"
    // dieses Szenario (gemessen, Runde 1). Der Beweis läuft auf einer EIGENEN
    // Seite außerhalb des Seed-Namensraums: ein Typwechsel an der Beispielwelt
    // wäre ein Eingriff in fremdes Beweismaterial.
    const NAME = 'E9 Seitentyp wirksam';
    const nodeOf = async () =>
      ((await (await request.get(api('/visu/tree'), { headers })).json()) as Array<{
        id: string;
        name: string;
        kind: string;
      }>).find((n) => n.name === NAME);

    // „Seite anlegen" steht im Seitenbaum derselben Ansicht: der Entwurf wird
    // dabei verworfen (gespeichert wurde nichts), und der Lauf spart einen
    // vollen Ladevorgang der Admin-SPA.
    await page.getByRole('button', { name: 'Seite anlegen' }).click();
    await page.getByLabel('Name').fill(NAME);
    await savePageProps(page).click();
    // `exact: true`, und zwar aus einem gemessenen Grund: die Einleitung des
    // Editors enthält den Satz „Gespeichert wird dabei nichts", und ein
    // Teilstring-Treffer darauf war schon erfüllt, BEVOR gespeichert wurde.
    // Die Erfolgsmeldung ist der einzige Knoten, dessen ganzer Text
    // „Gespeichert" lautet — nur er ist die Schranke, hinter der der Server
    // wirklich geschrieben hat (Runde 2 am Trace nachgewiesen: der Lesevorgang
    // lief zwischen zwei Schreib-Anfragen).
    await expect(pagePropsSaved(page)).toBeVisible();

    const created = await nodeOf();
    expect(created, 'die im Editor angelegte Seite steht im Baum').toBeTruthy();
    try {
      expect(created!.kind).toBe('normal');

      // Der Typwechsel an einer BESTEHENDEN Seite geht als `PATCH` hinaus.
      // OHNE Zwischen-Ladevorgang: `save()` schliesst mit `load()` + `select()`
      // ab (`gui/src/stores/visuEditor.js`), das Formular steht also schon auf
      // der neu angelegten Seite, und zwar mit dem Stand des SERVERS. Ein
      // `goto` hierher lud dieselben Daten ein zweites Mal.
      await expect(page.getByLabel('Seitentyp')).toHaveValue('normal');
      await page.getByLabel('Seitentyp').selectOption('popup');
      await page.getByLabel('Automatisch schließen (ms)').fill('2000');
      await savePageProps(page).click();
      await expect(pagePropsSaved(page)).toBeVisible();

      // … und steht danach am Server, nicht nur im Formular (§3: „jede
      // Eigenschaft setzen → `GET` zeigt sie").
      expect((await nodeOf())!.kind).toBe('popup');
      const cfg = await (await request.get(api(`/visu/pages/${created!.id}`), { headers })).json();
      expect(cfg.popup).toMatchObject({ auto_close_ms: 2000 });

      // Und der Editor liest den gespeicherten Stand zurück, nicht seinen
      // eigenen: frisch geladene SPA, Seite über den Deep-Link geöffnet.
      await page.goto(`${EDITOR_BASE}/visu-editor/${created!.id}`);
      await expect(page.getByLabel('Seitentyp')).toHaveValue('popup');
      await expect(page.getByLabel('Automatisch schließen (ms)')).toHaveValue('2000');

      // Der vierte Typ ist eine ROLLE, keine Einstellung: „Inkludeseite" entsteht
      // dort, wo inkludiert wird (A0-Entscheid — das Backend kennt dafür keinen
      // Spaltenwert). Bis Runde 1 quittierte der Editor die Wahl mit
      // „Gespeichert" und fiel nach dem Reload still auf „normal" zurück
      // (gemessen); jetzt sagt er es vorher und speichert nichts.
      await page.getByLabel('Seitentyp').selectOption('include');
      await expect(page.getByText('sobald eine andere Seite sie inkludiert')).toBeVisible();
      await expect(savePageProps(page)).toBeDisabled();
    } finally {
      // Aufräumen: das Szenario hinterlässt die Welt, wie es sie fand.
      if (created) await request.delete(api(`/visu/nodes/${created.id}`), { headers });
    }
  });

  test.fixme(
    'E10 Änderung an zentraler Vorlage propagiert automatisch in referenzierende Instanzen ohne manuellen Re-Import',
    C3,
    async ({ page }) => {
      const fx = seeded();
      // Die zentrale Vorlage = die individuelle Inkludeseite; „M5 Home"
      // referenziert sie (R14). Eine Änderung dort muss ohne Zutun ankommen.
      await openEditor(page, fx.m5.node_ids.include_ind);
      await el(page, fx.m5.widgets.include_ind).click();
      await page.getByLabel('Name').fill('M5 Gamma Umbenannt');
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Gespeichert', { exact: true })).toBeVisible();

      await page.goto(`${EDITOR_BASE}/visu-editor/${fx.m5.node_ids.home}`);
      await expect(page.frameLocator('iframe.editor-preview').getByText('M5 Gamma Umbenannt')).toBeVisible();

      // Aufräumen: der Name der Beispielwelt bleibt, wie der Seed ihn setzt.
      await page.goto(`${EDITOR_BASE}/visu-editor/${fx.m5.node_ids.include_ind}`);
      await el(page, 'M5 Gamma Umbenannt').click();
      await page.getByLabel('Name').fill(fx.m5.widgets.include_ind);
      await page.getByRole('button', { name: 'Speichern' }).click();
    },
  );

  test.fixme('E11 Datenpunkt-Bindung mit Suche/Filter, Live-Wert erscheint in Editor-Vorschau', C3, async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.solo);
    await el(page, fx.m5.widgets.solo).click();

    // Suche/Filter im Datenpunkt-Picker.
    await page.getByRole('button', { name: 'Datenpunkt wählen' }).click();
    await page.getByLabel('Datenpunkt suchen').fill('dp-m5-solo');
    const hits = page.locator('.dp-picker-item');
    await expect(hits).toHaveCount(1);
    await hits.first().click();

    // Der Live-Wert (der Seed setzt 21.5) erscheint in der Vorschau — die
    // Vorschau bezieht Werte vom echten Backend, nicht aus einer Attrappe.
    await expect(page.frameLocator('iframe.editor-preview').getByText('21.5')).toBeVisible();
  });

  // Teil C6 (Micsi/openbridgeserver#173) hat Verlauf und Wiederherstellen
  // geliefert; die `blocked-by`-Annotation faellt damit weg, keine Zeile des
  // Szenarios ist angefasst.
  test('E12 Seitenversionen einsehbar, frühere Version wiederherstellbar', async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.solo);
    const before = await box(page, fx.m5.widgets.solo);

    await el(page, fx.m5.widgets.solo).click();
    await page.keyboard.press('ArrowRight');
    await saveCanvas(page).click();
    await expect(canvasSaved(page)).toBeVisible();

    // Der Verlauf listet die Versionen …
    await page.getByRole('button', { name: 'Verlauf' }).click();
    const versions = page.locator('.editor-version');
    expect(await versions.count()).toBeGreaterThanOrEqual(2);

    // … und die vorherige lässt sich wiederherstellen: der Zustand ist exakt der alte.
    await versions.nth(1).getByRole('button', { name: 'Wiederherstellen' }).click();
    expect(await box(page, fx.m5.widgets.solo)).toMatchObject({ x: before.x, y: before.y });
  });

  // Ebenfalls aus Teil C6: die Textansicht steht als zweiter Reiter neben dem
  // Canvas. Annotation weg, Szenario unveraendert.
  test('E13 Seite als JSON/Text UND visuell editierbar, beide Ansichten synchron', async ({ page }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.solo);

    // visuell → Text: eine Verschiebung erscheint sofort im JSON.
    await el(page, fx.m5.widgets.solo).click();
    await page.keyboard.press('ArrowRight');
    const moved = await box(page, fx.m5.widgets.solo);
    await page.getByRole('tab', { name: 'JSON' }).click();
    const json = page.locator('.editor-json');
    expect(JSON.parse(await json.inputValue()).widgets[0].x).toBe(moved.x);

    // Text → visuell: eine Änderung im JSON schlägt auf den Canvas durch.
    const doc = JSON.parse(await json.inputValue());
    doc.widgets[0].x = moved.x + 7;
    await json.fill(JSON.stringify(doc));
    await page.getByRole('tab', { name: 'Visuell' }).click();
    expect((await box(page, fx.m5.widgets.solo)).x).toBe(moved.x + 7);
  });

  test(
    'E15 Zugriff/Zielgruppe direkt in Seiteneigenschaften setzbar (mind. Admin-only/Nutzer-Sichtbarkeit)',
    C1,
    async ({ page, request }) => {
      // Eigene, begruendete Zeitgrenze - die Begruendung und die Messwerte
      // stehen bei E9 (oben): dieselbe Bauart, dieselben drei Ladevorgaenge der
      // Admin-SPA, dieselbe Fehlerform unter Parallellast. Keine Erwartung ist
      // dafuer gesenkt.
      // 120 s Arbeit (gemessen, s. oben) plus hoechstens ein Anmelde-Fenster:
      // dieselbe Rechnung wie an der Decke des `describe` seit dem Merge von C2.
      test.setTimeout(180_000);

      const fx = seeded();
      const headers = await adminHeaders(request);
      await openEditor(page, fx.m5.node_ids.guard_user);

      // Das OBS-eigene 4-Stufen-Modell steht vollständig zur Wahl (Owner-Latte
      // über der HA-Referenz), und die Zielgruppe hängt daran.
      const access = page.getByLabel('Zugriff');
      await expect(access.locator('option')).toHaveText([/public/i, /readonly/i, /protected/i, /user/i]);
      await expect(access).toHaveValue('user');
      await expect(page.getByLabel('Zielgruppe')).toContainText(fx.resident.username);
      await expect(page.getByLabel('Zielgruppe')).not.toContainText(fx.operator.username);

      // Zielgruppe ist nur bei `user` sinnvoll — der Editor fängt das ab, statt
      // den 422 des Backends durchzureichen.
      await access.selectOption('public');
      await expect(page.getByLabel('Zielgruppe')).toBeDisabled();
      await access.selectOption('protected');
      await expect(page.getByLabel('PIN')).toBeVisible();
      // Und NUR dort: bei jeder anderen Stufe ist das Feld gar nicht erst da,
      // statt einen Wert zu tragen, den `update_node` mit 400 ablehnt.
      await access.selectOption('readonly');
      await expect(page.getByLabel('PIN')).toHaveCount(0);

      // SETZBAR heißt: gespeichert und im `GET` wiederzufinden. Ohne diesen Teil
      // überlebte die Mutation „`access` fällt aus dem PATCH-Rumpf" dieses
      // Szenario (gemessen, Runde 1). Gearbeitet wird auf einer EIGENEN Seite:
      // die geseedete Zugriffs-Welt gehört den authz-Szenarien.
      const NAME = 'E15 Zugriff wirksam';
      const nodeOf = async () =>
        ((await (await request.get(api('/visu/tree'), { headers })).json()) as Array<{
          id: string;
          name: string;
          access: string | null;
        }>).find((n) => n.name === NAME);

      // „Seite anlegen" steht im Seitenbaum derselben Ansicht (s. E9).
      await page.getByRole('button', { name: 'Seite anlegen' }).click();
      await page.getByLabel('Name').fill(NAME);
      await savePageProps(page).click();
      await expect(pagePropsSaved(page)).toBeVisible();

      const created = await nodeOf();
      expect(created, 'die im Editor angelegte Seite steht im Baum').toBeTruthy();
      try {
        // Der Zugriffswechsel an einer BESTEHENDEN Seite: erben ab, `user` an,
        // Zielgruppe dazu, und gespeichert. Ohne Zwischen-Ladevorgang (s. E9):
        // `save()` schliesst mit `load()` + `select()` ab, das Formular steht
        // also bereits auf der neuen Seite, mit dem Stand des Servers.
        await page.getByLabel('Vom Elternknoten erben').uncheck();
        await page.getByLabel('Zugriff').selectOption('user');
        await page.getByLabel('Nutzer hinzufügen').selectOption(fx.resident.username);
        await savePageProps(page).click();
        await expect(pagePropsSaved(page)).toBeVisible();

        // Der Server trägt beide Hälften: die Stufe am Knoten …
        expect((await nodeOf())!.access).toBe('user');
        // … und die Zielgruppe an der Seite.
        const audience = await (
          await request.get(api(`/visu/nodes/${created!.id}/users`), { headers })
        ).json();
        expect(audience).toEqual([fx.resident.username]);

        // Und der Editor liest den gespeicherten Stand zurück, nicht seinen
        // eigenen: frisch geladene SPA, Seite über den Deep-Link geöffnet.
        await page.goto(`${EDITOR_BASE}/visu-editor/${created!.id}`);
        await expect(page.getByLabel('Zugriff')).toHaveValue('user');
        await expect(page.getByLabel('Zielgruppe')).toContainText(fx.resident.username);
      } finally {
        if (created) await request.delete(api(`/visu/nodes/${created.id}`), { headers });
      }
    },
  );

  test.fixme('E16 Element bedingt sichtbar/unsichtbar je nach Datenpunktwert', C3, async ({ page, request }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.solo);
    await el(page, fx.m5.widgets.solo).click();

    await page.getByRole('button', { name: 'Sichtbarkeitsregel' }).click();
    await page.getByLabel('Datenpunkt').fill('dp-m5-solo');
    await page.getByLabel('Bedingung').selectOption('gt');
    await page.getByLabel('Schwelle').fill('30');
    await page.getByRole('button', { name: 'Speichern' }).click();

    const preview = page.frameLocator('iframe.editor-preview');
    // Seed-Wert 21.5 → Bedingung nicht erfüllt → unsichtbar.
    await expect(preview.locator(`[data-id]`, { hasText: fx.m5.widgets.solo })).toHaveCount(0);

    // Wert über die Schwelle heben → das Element erscheint (Live-Wert, kein Reload).
    const headers = await adminHeaders(request);
    await request.post(api(`/datapoints/${fx.m5.datapoint_ids.solo}/value`), { headers, data: { value: 42 } });
    await expect(preview.locator(`[data-id]`, { hasText: fx.m5.widgets.solo })).toBeVisible();
  });

  test('E17 Responsive-Breakpoints in Seiteneigenschaften konfigurierbar', C2, async ({ page, request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);
    const pageUrl = api(`/visu/pages/${fx.m5.node_ids.solo}`);

    // AUSGANGSSTAND: die Vorgaben. Das ist Aufbau, keine Zusicherung, und es ist
    // nötig, weil derselbe Lauf zweimal gegen dieselbe Instanz fährt: ohne
    // Rücksetzen stünden die gleich getippten Werte beim zweiten Mal schon da,
    // und das Szenario könnte „gespeichert" nicht von „stand schon so" trennen.
    const stand = await request.get(pageUrl, { headers }).then((r) => r.json());
    await request.put(pageUrl, { headers, data: { ...stand, breakpoints: [480, 768, 1024], grid: 8 } });

    await openEditor(page, fx.m5.node_ids.solo);

    // Die Werte liegen ABSEITS der Vorgabe (die ist `480, 768, 1024` bzw. `8`).
    // Genau daran hing der Beweis: mit den Vorgabewerten blieb dieses Szenario
    // auch dann grün, wenn das Speichern der Seiteneigenschaften vollständig
    // abgeschaltet war — der Reload las dieselben Zahlen aus der Vorgabe zurück.
    await page.getByLabel('Breakpoints', { exact: true }).fill('360, 900');
    await page.getByLabel('Rasterweite', { exact: true }).fill('24');
    await saveCanvas(page).click();
    await expect(canvasSaved(page)).toBeVisible();

    // Die Vorschau folgt dem gewählten Breakpoint …
    await page.getByLabel('Vorschau-Breite', { exact: true }).selectOption('360');
    await expect(page.locator('iframe.editor-preview')).toHaveJSProperty('clientWidth', 360);

    // … die Werte stehen in den SEITENEIGENSCHAFTEN (nicht in den Widgets) …
    const gespeichert = await request.get(pageUrl, { headers }).then((r) => r.json());
    expect(gespeichert.breakpoints).toEqual([360, 900]);
    expect(gespeichert.grid).toBe(24);

    // … und überleben den Reload, nicht bloß den flüchtigen Editor-Zustand.
    await page.reload();
    await expect(page.getByLabel('Breakpoints', { exact: true })).toHaveValue('360, 900');
    await expect(page.getByLabel('Rasterweite', { exact: true })).toHaveValue('24');
  });

  // Ebenfalls aus Teil C6: Export und Import liegen als Knoepfe neben dem
  // Seitenbaum.
  //
  // ZWEIMAL GESCHAERFT gegenueber der ersten Fassung, und beide Male, weil die
  // alte Zusicherung `expect(page.getByText(name)).toHaveCount(2)` zu wenig
  // behauptete (Kritik Runde 1, §1):
  //
  //  1. **Sie prueft jetzt den INHALT, nicht nur den Namen.** Ein Export, der
  //     `page_config` komplett weglaesst, liess das Szenario gruen - der Baum
  //     trug den Namen ja zweimal, nur stand nichts in der Seite. „Dieselbe
  //     Seite" haengt damit nicht mehr allein an den Unit-Tests des Backends.
  //  2. **Sie ist wiederholbar.** Jeder Lauf liess eine `(Kopie n)` stehen, und
  //     weil `getByText` per Teilzeichenkette trifft, zaehlte die Kopie mit: ab
  //     Lauf 2 war die Zusicherung schon VOR dem Import erfuellt. Jetzt wird vor
  //     und nach dem Lauf aufgeraeumt (auch nach einem Abbruch), und jede
  //     Zaehlung ist exakt und auf den Baum eingegrenzt.
  test('E18 Seite/Vorlage als Datei export-/importierbar', async ({ page, request }) => {
    const fx = seeded();
    const headers = await adminHeaders(request);
    const name = fx.m5.names.include_ind;
    const kopie = `${name} (Kopie 1)`;
    // Die Kachel, die auf dieser Seite steht (`apps/visu/e2e/seed.py`) - der
    // INHALT, an dem gemessen wird, ob wirklich dieselbe Seite ankam.
    const inhalt = 'M5 Gamma Item';

    const knoten = async () =>
      (await (await request.get(api('/visu/tree'), { headers })).json()) as Array<{
        id: string;
        name: string;
      }>;

    /** Jede Import-Kopie dieser Seite wieder aus dem Baum nehmen. */
    const aufraeumen = async () => {
      for (const eintrag of (await knoten()).filter((k) => k.name.startsWith(`${name} (Kopie`))) {
        await request.delete(api(`/visu/nodes/${eintrag.id}`), { headers });
      }
    };

    // VOR dem Lauf und nicht nur danach: ein abgebrochener Vorlauf soll den
    // naechsten nicht faelschen, und `(Kopie 1)` ist nur dann der freie Name.
    await aufraeumen();
    try {
      await openEditor(page, fx.m5.node_ids.include_ind);
      // Ausgangsbefund: die Quelle traegt ihre Kachel. Ohne ihn saehe der
      // Vergleich unten auch dann gruen aus, wenn schon das Original leer waere.
      await expect(el(page, inhalt)).toBeVisible();

      const download = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Exportieren' }).click(),
      ]).then(([d]) => d);
      const file = await download.path();
      expect(file).toBeTruthy();

      // Reimport in dieselbe Instanz: die Datei ist eine vollstaendige Seite und
      // kein Verweis auf die bestehende.
      await page.goto(`${EDITOR_BASE}/visu-editor`);
      const baum = page.locator('.visu-page-tree');
      await expect(baum.getByText(name, { exact: true })).toHaveCount(1);
      await expect(baum.getByText(kopie, { exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Importieren' }).click();
      await page.getByLabel('Datei').setInputFiles(file!);
      await page.getByRole('button', { name: 'Import starten' }).click();

      // (a) Der Baum traegt die Seite ein ZWEITES Mal - exakt einmal je Name,
      //     nicht „irgendwo zweimal dieselbe Zeichenkette".
      await expect(baum.getByText(kopie, { exact: true })).toHaveCount(1);
      await expect(baum.getByText(name, { exact: true })).toHaveCount(1);

      // (b) Und die zweite Zeile ist wirklich DIESELBE SEITE: sie traegt
      //     dieselbe Kachel, und zwar genau diese eine.
      const importiert = (await knoten()).find((k) => k.name === kopie);
      expect(importiert).toBeTruthy();
      await page.goto(`${EDITOR_BASE}/visu-editor/${importiert!.id}`);
      await expect(el(page, inhalt)).toBeVisible();
      await expect(page.locator('.editor-canvas [data-el]')).toHaveCount(1);
    } finally {
      // Das Szenario hinterlaesst die Welt, wie es sie fand - sonst belegt der
      // zweite Pflichtlauf nichts mehr.
      await aufraeumen();
    }
  });

  // Seit dem Merge von Teil C2 traegt `PageConfig` das Feld `skin`
  // (`obs/models/visu.py`) - genau die Vorbedingung, auf die {@link C2_PAGE_SKIN}
  // wartete. Die Annotation faellt damit weg, keine Zeile des Szenarios ist
  // angefasst.
  test('E19 Skin/Theme pro Seite oder global wählbar', C2, async ({ page, browser }) => {
    const fx = seeded();
    await openEditor(page, fx.m5.node_ids.solo);

    // Pro Seite: die Vorschau wechselt den Renderer, ohne die Seite zu ändern.
    const preview = page.frameLocator('iframe.editor-preview');
    const skin = page.getByLabel('Skin');
    await skin.selectOption('edomi');
    // `.edomi-root` ist einmalig, weil es GAR NICHT edomis `rootClass` ist:
    // der ist `visu-root` (`apps/visu/src/skin-host/skins.ts`), und `.edomi-root`
    // kommt aus edomis eigenem Seiten-Renderer.
    await expect(preview.locator('.edomi-root')).toBeVisible();

    await skin.selectOption('terminal');
    // Der `rootClass` des aktiven Skins steht ZWEIMAL im Baum, und zwar bei
    // JEDEM Skin: einmal an der Schale (`AppShell.vue` haengt ihn per
    // `classList.add` an `.app-shell-page`) und einmal am Seiten-Wurzelknoten
    // (`SkinPage.vue` → `.overview-root`). Das ist die festgeschriebene
    // Zwei-Knoten-Bauart der Schale, keine Eigenheit des terminal-Skins - auf
    // einer edomi-Seite trifft `.visu-root` sogar dreimal. Gewählt wird deshalb
    // der AUSSAGEKRÄFTIGE Knoten, der Seiten-Wurzelknoten, und nicht der
    // erstbeste: dass die Schale ihre Klasse trägt, sagt über den Renderer der
    // Seite nichts.
    await expect(preview.locator('.overview-root.t-root')).toBeVisible();

    // Und die Wahl gehört der SEITE, nicht dem Browser des Autors: sie steht
    // nach dem Speichern in der Seiten-Konfiguration, und wer dieselbe Seite in
    // einem ZWEITEN Kontext öffnet, sieht sie ebenso. `page.reload()` allein
    // bewiese das NICHT — ein Browser-Speicher überlebt den Reload per
    // Definition, und genau daran hat sich Runde 1 vorbeigemogelt.
    await savePageProps(page).click();
    await expect(pagePropsSaved(page)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Skin')).toHaveValue('terminal');

    const zweiterKontext = await browser.newContext({ locale: 'en-US' });
    try {
      const zweiterBrowser = await zweiterKontext.newPage();
      await openEditor(zweiterBrowser, fx.m5.node_ids.solo);
      await expect(zweiterBrowser.getByLabel('Skin')).toHaveValue('terminal');
    } finally {
      await zweiterKontext.close();
    }
  });
});

