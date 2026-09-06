import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * M4 · Issue #104 AC2 — „Safe-Area-Insets im Shell-Layout berücksichtigt".
 *
 * In jsdom ist `env(safe-area-inset-*)` gar nicht auswertbar, und in headless
 * Chromium ist es ohne Gerätekontext 0 — ein Test, der nur nachsieht, ob die
 * Regel im CSS steht, würde die Absicht prüfen, nicht die Wirkung.
 *
 * Chromium kann die Insets aber emulieren: `Emulation.setSafeAreaInsetsOverride`
 * (CDP) setzt genau die Werte, die `env(safe-area-inset-*)` dann liefert. Damit
 * ist das Kriterium hier VOLL messbar — an echter Geometrie, nicht an CSS-Text:
 * mit eingeschalteten Insets darf kein Bedienelement der Shell in den
 * beschnittenen Rand ragen.
 *
 * Was hier NICHT geprüft ist (und auf ein Gerät gehört): ob iOS/Android der
 * WebView überhaupt die richtigen Insets melden. Das hängt an `viewport-fit=cover`
 * (index.html) und der nativen Hülle, nicht am Layout — und Chromium kann es
 * nicht simulieren, weil es genau die Zahl ist, die hier gesetzt wird.
 */

/** Die Bedienelemente des Seitenmenüs — eine Konstante, damit „vorher" und
 *  „nachher" garantiert dieselbe Menge messen. */
const MENU_CONTROLS = 'ion-menu ion-item, ion-menu button, ion-menu input';

/** Frei gewählte, aber gerätetypische Insets (iPhone-Notch hochkant + Querformat-Ohren). */
const INSETS = { top: 47, left: 12, bottom: 34, right: 12 } as const;

/**
 * Setzt die Insets für diese Seite. Ohne Argument alle vier; mit `only` genau
 * eine Kante — das braucht es, um eine EINZELNE Regel differentiell zu messen:
 * schaltet man alle Kanten zugleich, verändert der seitliche Inset die Textumbrüche
 * und damit die Höhen, und die Differenz an der Unterkante misst nicht mehr nur
 * die untere Polsterung (gemessen: 49 px statt der erwarteten 34).
 */
async function withSafeAreas(page: Page, context: BrowserContext, only?: keyof typeof INSETS): Promise<void> {
  const insets = only ? { top: 0, right: 0, bottom: 0, left: 0, [only]: INSETS[only] } : { ...INSETS };
  const cdp = await context.newCDPSession(page);
  // Nicht im offiziellen Playwright-Typ enthalten (CDP-Domain direkt), daher der Cast.
  await (cdp.send as (m: string, p: unknown) => Promise<unknown>)('Emulation.setSafeAreaInsetsOverride', { insets });
}

/** Was `env(safe-area-inset-*)` in der Seite tatsächlich liefert. */
async function resolvedEnv(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);' +
      'padding-right:env(safe-area-inset-right,0px);padding-bottom:env(safe-area-inset-bottom,0px);' +
      'padding-left:env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft };
    probe.remove();
    return out;
  });
}

/** Sichtbare Boxen zu einem Selektor, als reine Zahlen. */
async function boxes(
  page: Page,
  selector: string,
): Promise<{ label: string; x: number; y: number; right: number; bottom: number }[]> {
  return page.$$eval(selector, (els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()}${el.getAttribute('class') ? '.' + el.getAttribute('class')!.split(/\s+/)[0] : ''}`;
        return { label, x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      })
      .filter((b) => b.w > 0 && b.h > 0),
  );
}

/** Scrollt eine `ion-content` bis ans Ende und wartet, bis die Position steht. */
async function scrollToBottom(page: Page, selector: string): Promise<void> {
  await page.evaluate(async (sel) => {
    const content = document.querySelector(sel) as (HTMLElement & { getScrollElement(): Promise<HTMLElement> }) | null;
    if (!content) throw new Error(`kein ${sel} zum Scrollen gefunden`);
    const el = await content.getScrollElement();
    el.scrollTop = el.scrollHeight;
  }, selector);
  await page.waitForTimeout(300);
}

test.describe('Safe-Area-Insets im Shell-Layout (#104 AC2)', () => {
  test('die Inset-Emulation greift — sonst misst der Rest dieser Datei nichts', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Ohne Override ist alles 0: das belegt, dass der Wert wirklich von der
    // Emulation kommt und nicht zufällig schon dastand.
    expect(await resolvedEnv(page)).toEqual({ top: '0px', right: '0px', bottom: '0px', left: '0px' });

    await withSafeAreas(page, context);
    await expect
      .poll(() => resolvedEnv(page), { message: 'Emulation.setSafeAreaInsetsOverride hat keine Wirkung' })
      .toEqual({
        top: `${INSETS.top}px`,
        right: `${INSETS.right}px`,
        bottom: `${INSETS.bottom}px`,
        left: `${INSETS.left}px`,
      });
  });

  test('die Kopfzeile liegt vollständig unter dem oberen Inset', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'load' });
    await withSafeAreas(page, context);

    const viewport = page.viewportSize()!;
    const header = await boxes(page, '.shell-header ion-menu-button, .shell-header .clock-pill, .shell-header-title');
    expect(header.length, 'keine Kopfzeilen-Elemente gefunden — der Test hätte nichts gesehen').toBeGreaterThan(0);

    for (const box of header) {
      expect(box.y, `${box.label} liegt unter dem Notch (y=${box.y} < ${INSETS.top})`).toBeGreaterThanOrEqual(
        INSETS.top,
      );
      expect(box.x, `${box.label} ragt in das linke Inset (x=${box.x} < ${INSETS.left})`).toBeGreaterThanOrEqual(
        INSETS.left,
      );
      expect(
        box.right,
        `${box.label} ragt in das rechte Inset (right=${box.right} > ${viewport.width - INSETS.right})`,
      ).toBeLessThanOrEqual(viewport.width - INSETS.right);
    }
  });

  test('die Kopfzeile zählt das Inset genau EINMAL und läuft nicht über den Rand', async ({ page, context }) => {
    // „Liegt unterhalb des Insets" ist zu wenig: wer das Inset zweimal aufaddiert
    // (einmal selbst, einmal durch Ionics Toolbar) besteht diese Prüfung mit einem
    // doppelt so breiten toten Band, und wer padding auf einen bereits vollbreiten
    // Kasten legt, schiebt ihn aus dem Viewport heraus. Beides wird hier gemessen:
    // die VERSCHIEBUNG gegenüber demselben Layout ohne Insets muss exakt der Inset
    // sein, und der Kopfzeilen-Kasten muss im Viewport bleiben.
    const geometry = (): Promise<{ header: DOMRect; content: DOMRect }> =>
      page.evaluate(() => ({
        header: (document.querySelector('.app-shell-header') as HTMLElement).getBoundingClientRect().toJSON(),
        content: (document.querySelector('.shell-header') as HTMLElement).getBoundingClientRect().toJSON(),
      }));

    await page.goto('/', { waitUntil: 'load' });
    const before = await geometry();

    await withSafeAreas(page, context);
    await expect
      .poll(async () => (await geometry()).content.y, { message: 'die Insets sind im Layout nicht angekommen' })
      .toBeGreaterThan(before.content.y);
    const after = await geometry();

    const viewport = page.viewportSize()!;
    expect(
      after.header.x,
      `die Kopfzeile beginnt links ausserhalb des Viewports (x=${after.header.x})`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      after.header.right,
      `die Kopfzeile läuft rechts aus dem Viewport (right=${after.header.right} > ${viewport.width}) — ` +
        'padding auf einem bereits vollbreiten Kasten',
    ).toBeLessThanOrEqual(viewport.width);

    expect(
      after.content.y - before.content.y,
      `der obere Inset wird nicht einmal, sondern ${(after.content.y - before.content.y) / INSETS.top}× gezählt`,
    ).toBe(INSETS.top);
    expect(after.content.x - before.content.x, 'der linke Inset wird nicht genau einmal gezählt').toBe(INSETS.left);
    expect(before.content.right - after.content.right, 'der rechte Inset wird nicht genau einmal gezählt').toBe(
      INSETS.right,
    );
  });

  test('die Marken-Titelbar bekäme dieselbe Behandlung wie die Kopfzeile', async ({ page, context }) => {
    // `.app-shell-titlebar` teilte sich mit `.app-shell-header` die entfernte
    // Padding-Regel, ist aber im ausgelieferten Stand NICHT erreichbar:
    // `showTitlebar` ist per `useShellState.ts:76` aus, und keine Seite schaltet
    // ihn ein (`grep -rn showTitlebar apps/visu/src` findet nur Definition und
    // Verwendung, keinen Setzer). Es gibt also kein Element zu messen.
    //
    // Messbar ist trotzdem die eigentliche Frage: trägt der Klassenname noch
    // eine Regel, die den Inset ein zweites Mal aufaddieren oder den Kasten aus
    // dem Viewport schieben würde? Dafür bekommt die REALE Kopfzeile — dasselbe
    // Konstrukt `ion-header > ion-toolbar`, dasselbe scoped-CSS — die Klasse
    // zusätzlich verpasst; die Geometrie darf sich davon nicht rühren.
    //
    // Was das NICHT zeigt: die Titelbar hält Uhr-Pille UND Header-Slot in EINER
    // Toolbar. Sobald eine Seite sie einschaltet, gehört ihre Geometrie eigens
    // gemessen.
    await page.goto('/', { waitUntil: 'load' });
    await withSafeAreas(page, context);

    const contentBox = (): Promise<DOMRect> =>
      page.evaluate(() => (document.querySelector('.shell-header') as HTMLElement).getBoundingClientRect().toJSON());
    const headerBox = (): Promise<DOMRect> =>
      page.evaluate(() =>
        (document.querySelector('.app-shell-header') as HTMLElement).getBoundingClientRect().toJSON(),
      );

    await expect
      .poll(async () => (await contentBox()).y, { message: 'die Insets sind im Layout nicht angekommen' })
      .toBe(INSETS.top);
    const before = { content: await contentBox(), header: await headerBox() };

    const applied = await page.evaluate(() => {
      const header = document.querySelector('.app-shell-header') as HTMLElement;
      header.classList.add('app-shell-titlebar');
      return header.classList.contains('app-shell-titlebar');
    });
    expect(applied, 'die Titelbar-Klasse liess sich nicht setzen — nichts gemessen').toBe(true);

    const after = { content: await contentBox(), header: await headerBox() };
    expect(after.content.y, 'die Titelbar-Klasse verschiebt den Inhalt — eine zweite Inset-Regel?').toBe(
      before.content.y,
    );
    expect(after.header.right, 'die Titelbar-Klasse schiebt den Kasten aus dem Viewport').toBe(before.header.right);
    expect(after.header.height, 'die Titelbar-Klasse ändert die Kopfhöhe').toBe(before.header.height);
  });

  test('der Seiteninhalt bleibt seitlich und am unteren Rand frei', async ({ page, context }) => {
    await page.goto('/', { waitUntil: 'load' });
    await withSafeAreas(page, context);

    const viewport = page.viewportSize()!;
    const cells = await boxes(page, '.skin-host-cell');
    expect(cells.length, 'keine Kacheln gefunden — der Test hätte nichts gesehen').toBeGreaterThan(0);

    for (const box of cells) {
      expect(box.x, `Kachel ragt in das linke Inset (x=${box.x})`).toBeGreaterThanOrEqual(INSETS.left);
      expect(box.right, `Kachel ragt in das rechte Inset (right=${box.right})`).toBeLessThanOrEqual(
        viewport.width - INSETS.right,
      );
    }

    // Ganz nach unten scrollen: erst dort entscheidet sich, ob das letzte
    // Element über dem Home-Indicator endet oder darunter verschwindet.
    await scrollToBottom(page, '.app-shell-content');
    const afterScroll = await boxes(page, '.skin-host-cell, .overview-tweaks-toggle');
    const lowest = afterScroll.reduce((a, b) => (b.bottom > a.bottom ? b : a));
    expect(
      lowest.bottom,
      `${lowest.label} endet unter dem Home-Indicator (bottom=${lowest.bottom} > ${viewport.height - INSETS.bottom})`,
    ).toBeLessThanOrEqual(viewport.height - INSETS.bottom);
  });

  test('der Inhaltskasten zählt die seitlichen Insets genau einmal', async ({ page, context }) => {
    // „Kachel bleibt rechts vom Inset" ist zu schwach: die Kacheln haben eigene
    // Ränder und liegen ohnehin weit innen, also überlebt `--padding-start`/`-end`
    // auf `.app-shell-content` seine Entfernung. Gemessen wird deshalb der
    // VOLLBREITE Inhaltskasten selbst und die VERSCHIEBUNG gegenüber demselben
    // Layout ohne Insets — dieselbe Technik wie beim Kopfzeilen-Test.
    const body = (): Promise<DOMRect> =>
      page.evaluate(() => (document.querySelector('.app-shell-body') as HTMLElement).getBoundingClientRect().toJSON());

    await page.goto('/', { waitUntil: 'load' });
    const before = await body();
    expect(before.width, 'der Inhaltskasten ist nicht vollbreit — dann misst die Differenz nichts').toBe(
      page.viewportSize()!.width,
    );

    await withSafeAreas(page, context);
    await expect
      .poll(async () => (await body()).x, { message: 'die Insets sind im Inhaltskasten nicht angekommen' })
      .toBeGreaterThan(before.x);
    const after = await body();

    expect(after.x - before.x, 'der linke Inset schlägt sich nicht genau einmal im Inhalt nieder').toBe(INSETS.left);
    expect(before.right - after.right, 'der rechte Inset schlägt sich nicht genau einmal im Inhalt nieder').toBe(
      INSETS.right,
    );
  });

  test('das Seitenmenü bleibt links und am unteren Rand frei', async ({ page, context }) => {
    // Kurzer Viewport, damit das Menü WIRKLICH scrollt — sonst endet die Liste
    // ohnehin weit über dem unteren Inset und die Prüfung bestünde grundlos.
    await page.setViewportSize({ width: 393, height: 420 });
    await page.goto('/', { waitUntil: 'load' });

    await page.locator('ion-menu-button').first().click();
    await expect(page.locator('ion-menu ion-list')).toBeVisible();
    // Das Menü fährt animiert ein. Wird währenddessen gemessen, steht es noch
    // links ausserhalb des Viewports und JEDER Wert wäre falsch — also warten,
    // bis die Panel-Kante wirklich am linken Rand steht.
    await expect
      .poll(async () => (await page.locator('ion-menu ion-content').boundingBox())?.x ?? null, {
        message: 'das Seitenmenü ist nicht eingefahren',
      })
      .toBe(0);

    // Referenzmessung OHNE Insets. „Die Unterkante bleibt über dem
    // Home-Indicator" allein ist zu schwach: die Liste endet in diesem Viewport
    // mit ~100 px Luft, also überlebt `--padding-bottom` auf der Menü-Fläche
    // seine Entfernung. Erst die VERSCHIEBUNG gegen denselben Zustand ohne
    // Insets bindet die Regel fest — dieselbe Technik wie beim Kopfzeilen-Test.
    await scrollToBottom(page, 'ion-menu ion-content');
    const lowestWithout = (await boxes(page, MENU_CONTROLS)).reduce((a, b) => (b.bottom > a.bottom ? b : a));

    // Erst NUR die untere Kante: so ist die Differenz allein die Polsterung der
    // Menü-Scrollfläche und nicht zusätzlich ein geänderter Textumbruch.
    await withSafeAreas(page, context, 'bottom');
    await expect
      .poll(
        async () => {
          await scrollToBottom(page, 'ion-menu ion-content');
          return (await boxes(page, MENU_CONTROLS)).reduce((a, b) => (b.bottom > a.bottom ? b : a)).bottom;
        },
        { message: 'der untere Inset ist im Menü nicht angekommen' },
      )
      .toBeLessThan(lowestWithout.bottom);
    const lowestBottomOnly = (await boxes(page, MENU_CONTROLS)).reduce((a, b) => (b.bottom > a.bottom ? b : a));
    expect(
      lowestWithout.bottom - lowestBottomOnly.bottom,
      `der untere Inset schlägt sich im Menü nicht genau einmal nieder ` +
        `(ohne Insets ${lowestWithout.bottom}, mit ${lowestBottomOnly.bottom})`,
    ).toBe(INSETS.bottom);

    await withSafeAreas(page, context);
    await expect
      .poll(async () => (await boxes(page, 'ion-menu ion-item')).map((b) => b.x)[0] ?? null, {
        message: 'die Insets sind im Menü nicht angekommen',
      })
      .toBe(INSETS.left);

    const viewport = page.viewportSize()!;
    const items = await boxes(page, MENU_CONTROLS);
    expect(items.length, 'keine Menü-Bedienelemente gefunden — der Test hätte nichts gesehen').toBeGreaterThan(0);

    for (const box of items) {
      expect(
        box.x,
        `${box.label} im Menü ragt in das linke Inset (x=${box.x} < ${INSETS.left})`,
      ).toBeGreaterThanOrEqual(INSETS.left);
    }

    await scrollToBottom(page, 'ion-menu ion-content');
    const scrolled = await boxes(page, MENU_CONTROLS);
    const lowest = scrolled.reduce((a, b) => (b.bottom > a.bottom ? b : a));
    // Vorbedingung: das Menü ist tatsächlich am Anschlag, also war etwas zu scrollen.
    const scrollInfo = await page.evaluate(async () => {
      const content = document.querySelector('ion-menu ion-content') as HTMLElement & {
        getScrollElement(): Promise<HTMLElement>;
      };
      const el = await content.getScrollElement();
      return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    expect(
      scrollInfo.scrollHeight,
      'das Menü scrollt in diesem Viewport gar nicht — die untere Kante wäre nicht geprüft',
    ).toBeGreaterThan(scrollInfo.clientHeight);
    expect(
      lowest.bottom,
      `${lowest.label} im Menü endet unter dem Home-Indicator (bottom=${lowest.bottom} > ${viewport.height - INSETS.bottom})`,
    ).toBeLessThanOrEqual(viewport.height - INSETS.bottom);
  });
});
