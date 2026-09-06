import { test, expect, type Page } from '@playwright/test';

/**
 * M4 · Issue #104 AC3 — „Touch-Ziele ≥ 44 px, auch bei `cellScale`-Minimum".
 *
 * Gemessen wird mit `getBoundingClientRect()` im Produktionsbuild. In jsdom ginge
 * das nicht: dort gibt es kein Layout, jede Box ist 0×0, und ein Vitest darüber
 * wäre ein Scheintest.
 *
 * ## Wem gehört ein Bedienelement — POSITIV formuliert
 *
 * Der Host übergibt das Zeichnen an genau DREI Stellen an einen Skin, und jede
 * hat einen eigenen Container, den der Host selbst setzt:
 *   `.skin-host-cell`          — die Kachel im Raster   (skin-host/SkinHost.ts:369,500)
 *   `.skin-host-modal-body`    — die Detailfläche       (app/DetailModalHost.vue:325)
 *   `.skin-host-presets-body`  — das Preset-Popover     (app/DetailModalHost.vue:365)
 * Was INNERHALB einer dieser Flächen liegt, zeichnet der Skin (Repo
 * `obs-visu-skins`) — mit einer Ausnahme, und die ist ebenfalls im DOM sichtbar:
 * Host-Code, der in eine Skin-Fläche hineinrendert, trägt den Namensraum des
 * Hosts, `skin-host-*`. Das ist keine Prosa-Ausnahme, sondern die Konvention, der
 * heute JEDER solche Knoten folgt: `skin-host-link` (der gestreckte Seitenlink,
 * SkinHost.ts:142), `skin-host-link-dot` / `-bar`, `skin-host-missing`,
 * `skin-host-unsupported` und die generische Detailfläche `skin-host-default-*`
 * (DetailModalHost.vue:243-263).
 *
 * Also: **Skin-Element = in einer Skin-Fläche UND ausserhalb des `skin-host-*`-
 * Namensraums.** Alles andere gehört dem Host und muss den Boden halten.
 *
 * Was diese Regel NICHT kann — damit es niemand mehr behauptet: sie erkennt
 * Host-Code nicht am Ursprung, sondern an der Klasse. Ein neuer Host-Knopf, der
 * ohne `skin-host-`-Klasse in eine Zelle gerendert würde, liefe als Skin-Element
 * durch. Die Konvention wird hier vorausgesetzt, nicht bewiesen.
 *
 * Warum die Skin-Seite überhaupt aussen vor bleibt: App und Skin sind getrennte
 * Repos, die nur am Vertrag hängen (ARCHITECTURE.md §1), und die visu-CI checkt
 * den Skin aus `Micsi/obs-visu-skins@main` aus. Ein Wächter, der hier auf
 * Skin-Interna fiele, wäre in diesem Repo nicht reparierbar und bei jedem fremden
 * Skin-Commit rot.
 *
 * Die Zelle SELBST ist dagegen Host-Sache: `.skin-host-cell[data-id]` ist die
 * Fläche, auf der der Host Tap/Long-Press auflöst (`core/useDoubleTap →
 * tileIdFor`, `pages/OverviewGrid`). Dort greift `cellScale`, und dort wird
 * „auch bei cellScale-Minimum" gemessen.
 */

/** WCAG 2.5.5 (AAA) / Apple HIG / Material: 44 px in beiden Achsen. */
const MIN_TOUCH_PX = 44;

/**
 * Echte Bedienelemente — die Ionic-Custom-Elements ausdrücklich mit, denn genau
 * das war die Lücke: ohne `ion-button` in dieser Liste blieb
 * `ion-button.login-submit` (268×36) ungemessen.
 *
 * `[role=…]` und `[tabindex]` stehen bewusst NICHT drin: die tragen in dieser App
 * auch reine FLÄCHEN (die Kacheln des Skins, Ionics `ion-menu`, der gestreckte
 * `a.skin-host-link`), die kein eigenes Fingerziel sind. Die Gestenfläche des
 * Hosts wird stattdessen im dritten Test über ihren eigenen Selektor gemessen,
 * und `a.skin-host-link` ist per `position:absolute; inset:0` immer exakt so
 * gross wie die Zelle und zusätzlich `pointer-events: none`
 * (skin-host/link-affordance.css).
 */
const CONTROLS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'ion-button',
  'ion-item[button]',
  'ion-menu-button',
  'ion-back-button',
  'ion-input',
  'ion-textarea',
  'ion-select',
  'ion-toggle',
  'ion-checkbox',
  'ion-radio',
  'ion-range',
  'ion-searchbar',
  'ion-segment-button',
  'ion-fab-button',
];
const INTERACTIVE = CONTROLS.join(', ');
/** Dieselben Controls, aber nur innerhalb einer bestimmten Fläche. */
const within = (root: string): string => CONTROLS.map((sel) => `${root} ${sel}`).join(', ');

interface Target {
  label: string;
  width: number;
  height: number;
  owner: 'host' | 'skin';
  /** Innenteil eines anderen Controls (`button.button-native`, `input.native-input`, …). */
  internal: boolean;
  /** Bei `internal`: liegt die Box vollständig im umschliessenden Control? */
  containedInOwner: boolean;
}

/**
 * Alle sichtbaren Bedienelemente mit Box, Eigentümer und Innenteil-Kennung.
 *
 * Ionic-Controls bringen ihr eigenes `<button>`/`<input>` mit — teils im
 * Shadow-Root (`ion-item`, `ion-button`, `ion-menu-button`), teils als
 * scoped-CSS im Light-DOM (`ion-input` → `input.native-input`, 240×18). Gemessen
 * wird, was der Finger trifft: das äussere Control. Der Innenteil wird nicht
 * einfach verworfen, sondern separat geprüft — er MUSS in der Box seines
 * Controls liegen, sonst sähe das Messen des Controls zu wenig. Der Aufstieg
 * quert Shadow-Grenzen (`getRootNode().host`), weil `closest()` dort endet.
 */
async function targets(page: Page, root?: string): Promise<Target[]> {
  return page.$$eval(
    root ? within(root) : INTERACTIVE,
    (els, selector) => {
      const SKIN_SURFACES = ['skin-host-cell', 'skin-host-modal-body', 'skin-host-presets-body'];
      const up = (node: Element): Element | null =>
        node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;

      const ownerOf = (start: Element): 'host' | 'skin' => {
        for (let node: Element | null = start; node; node = up(node)) {
          const cl = node.classList;
          if (!cl) continue;
          // Der Namensraum des Hosts gewinnt gegen die umgebende Skin-Fläche …
          if ([...cl].some((c) => c.startsWith('skin-host-') && !SKIN_SURFACES.includes(c))) return 'host';
          // … erst danach entscheidet die Fläche.
          if (SKIN_SURFACES.some((s) => cl.contains(s))) return 'skin';
        }
        return 'host';
      };

      /** Das nächste umschliessende Control (über Shadow-Grenzen hinweg), falls es eins gibt. */
      const enclosingControl = (start: Element): Element | null => {
        for (let node = up(start); node; node = up(node)) {
          if (node.matches(selector)) return node;
        }
        return null;
      };

      return els
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const outer = enclosingControl(el);
          const outerRect = outer?.getBoundingClientRect();
          const cls = el.getAttribute('class');
          return {
            label: `${el.tagName.toLowerCase()}${cls ? '.' + cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''}`,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            owner: ownerOf(el),
            internal: outer !== null,
            containedInOwner:
              outerRect === undefined
                ? true
                : rect.left >= outerRect.left - 0.5 &&
                  rect.right <= outerRect.right + 0.5 &&
                  rect.top >= outerRect.top - 0.5 &&
                  rect.bottom <= outerRect.bottom + 0.5,
            visible: rect.width > 0 && rect.height > 0,
          };
        })
        .filter((t) => t.visible);
    },
    INTERACTIVE,
  );
}

/** Öffnet das Seitenmenü und wartet, bis es wirklich eingefahren ist. */
async function openMenu(page: Page): Promise<void> {
  await page.locator('ion-menu-button').first().click();
  await expect(page.locator('ion-menu ion-list')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('ion-menu ion-content').boundingBox())?.x ?? null, {
      message: 'das Seitenmenü ist nicht eingefahren',
    })
    .toBe(0);
}

/** Long-Press auf einer Kachel — die Geste, die Detailfläche bzw. Popover öffnet. */
async function longPress(page: Page, deviceId: string): Promise<void> {
  const cell = page.locator(`.skin-host-cell[data-id="${deviceId}"]`);
  await expect(cell, `Kachel ${deviceId} nicht gefunden`).toHaveCount(1);
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  expect(box, `Kachel ${deviceId} hat keine Box`).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700); // useLongPress feuert nach 420 ms
  await page.mouse.up();
}

/** Die gemeinsame Auswertung: Host-Boden, gefüllte Töpfe, Innenteile eingeschlossen. */
function assertTargets(all: Target[], where: string, minHost: number): void {
  const host = all.filter((t) => t.owner === 'host');
  const skin = all.filter((t) => t.owner === 'skin');

  // Leere Erhebung ist kein Grün — beide Töpfe müssen befüllt sein, sonst
  // bestünde der Test blind oder die Eigentümer-Zuordnung wäre gekippt.
  expect(host.length, `${where}: zu wenige Host-Bedienelemente erkannt`).toBeGreaterThanOrEqual(minHost);
  expect(skin.length, `${where}: kein Skin-Bedienelement erkannt — dann trennt die Grenze nichts`).toBeGreaterThan(0);

  // Innenteile werden nicht gemessen, aber ihre Auslassung wird belegt: liefe ein
  // Innenteil aus der Box seines Controls heraus, sähe das Messen des Controls zu
  // wenig — dann muss dieser Test fallen, nicht schweigen.
  const escaped = all.filter((t) => t.internal && !t.containedInOwner);
  expect(
    escaped.map((t) => t.label),
    `${where}: Innenteil ragt aus seinem Control heraus — die Auslassung ist dann nicht mehr gedeckt`,
  ).toEqual([]);

  const tooSmall = host.filter((t) => !t.internal && (t.width < MIN_TOUCH_PX || t.height < MIN_TOUCH_PX));
  expect(
    tooSmall.map((t) => `${t.label} ${t.width}×${t.height}`),
    `${where}: Host-Bedienelemente unter ${MIN_TOUCH_PX} px`,
  ).toEqual([]);
}

test.describe('Touch-Ziele ≥ 44 px (#104 AC3)', () => {
  test('jedes Bedienelement der Host-Oberfläche misst mindestens 44 px', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Alle Host-Flächen aufklappen, sonst bleibt der halbe Bestand ungemessen —
    // das Login-Formular eingeschlossen, denn dort sass der zuletzt gefundene
    // Verstoss (`ion-button.login-submit`, 268×36).
    await page.locator('.overview-tweaks-toggle').click();
    await expect(page.locator('.tweaks-panel')).toBeVisible();
    await openMenu(page);
    await page.locator('.login-open').click();
    await expect(page.locator('.login-form')).toBeVisible();

    const all = await targets(page);
    expect(all.length, 'gar keine Bedienelemente gefunden').toBeGreaterThan(0);
    // Vorbedingung: das Login-Formular ist wirklich im Bestand.
    expect(
      all.map((t) => t.label).filter((label) => label.includes('login-submit')),
      'der Login-Absenden-Knopf ist nicht im Bestand — das Formular war nicht offen',
    ).not.toHaveLength(0);

    assertTargets(all, 'Menü + Login + Tweaks', 12);
  });

  test('auch die Detailfläche und das Preset-Popover halten den Boden', async ({ page }) => {
    // Diese beiden Flächen waren in Runde 1 eine Prosa-Ausnahme („nicht
    // abgedeckt"). Hier werden sie geöffnet und AUF DIE FLÄCHE EINGESCHRÄNKT
    // gemessen — ohne die Einschränkung würden die Kacheln dahinter jede
    // „ist nicht leer"-Zusicherung erfüllen und der Test wäre blind.
    const MODAL = 'ion-modal .skin-host-modal-body';
    const POPOVER = 'ion-popover .skin-host-presets-body';
    const tooSmall = (list: Target[]): string[] =>
      list
        .filter((t) => t.owner === 'host' && !t.internal && (t.width < MIN_TOUCH_PX || t.height < MIN_TOUCH_PX))
        .map((t) => `${t.label} ${t.width}×${t.height}`);

    await page.goto('/', { waitUntil: 'load' });

    // 1. SKIN-gezeichnete Detailfläche: eine Lampe hat keine Presets, der
    //    Long-Press fällt also auf `openDetail` zurück, und der ionic-Skin bringt
    //    für `light` einen eigenen Renderer mit (src/details/LightDetail.ts).
    await longPress(page, 'kueche-wand');
    await expect(page.locator(MODAL), 'keine Detailfläche geöffnet').toBeVisible();
    const skinDetail = await targets(page, MODAL);
    expect(skinDetail.length, 'in der Detailfläche wurde nichts gemessen').toBeGreaterThan(0);
    expect(
      skinDetail.filter((t) => t.owner === 'skin').length,
      'die Lampen-Detailfläche wird vom Skin gezeichnet — hier muss die Zuordnung „skin" greifen',
    ).toBeGreaterThan(0);
    expect(tooSmall(skinDetail), 'Detailfläche (skin-gezeichnet): Host-Bedienelemente unter 44 px').toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL)).toHaveCount(0);

    // 2. HOST-gezeichnete Detailfläche: für `scene` bringt der ionic-Skin KEINEN
    //    Detail-Renderer mit (src/details/ hat nur light/switch/blind/jalousie/
    //    climate), also greift die generische Fläche des Hosts
    //    (DetailModalHost → defaultDetail, `skin-host-default-*`). Genau deshalb
    //    steht dieser Fall hier: er ist der Beleg, dass die Regel Host-Code INNEN
    //    findet, statt die ganze Fläche pauschal dem Skin zuzuschlagen.
    await longPress(page, 'szene-abend');
    await expect(page.locator(MODAL), 'keine Szenen-Detailfläche geöffnet').toBeVisible();
    const hostDetail = await targets(page, MODAL);
    expect(
      hostDetail.filter((t) => t.owner === 'host').length,
      'die generische Detailfläche ist Host-Code — hier muss die Zuordnung „host" greifen',
    ).toBeGreaterThan(0);
    expect(tooSmall(hostDetail), 'Detailfläche (host-gezeichnet): Host-Bedienelemente unter 44 px').toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.locator(MODAL)).toHaveCount(0);

    // 3. Preset-Popover: ein Rollladen trägt Presets, der Long-Press öffnet sie.
    await longPress(page, 'kueche-roll');
    await expect(page.locator(POPOVER), 'kein Preset-Popover geöffnet').toBeVisible();
    const presets = await targets(page, POPOVER);
    expect(presets.length, 'im Preset-Popover wurde nichts gemessen').toBeGreaterThan(0);
    expect(tooSmall(presets), 'Preset-Popover: Host-Bedienelemente unter 44 px').toEqual([]);
  });

  test('die Kachel bleibt auch bei minimaler Rasterdichte ein 44-px-Ziel', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.locator('.overview-tweaks-toggle').click();

    const slider = page.locator('.tweaks-panel__row[data-tweak="cellScale"] input[type="range"]');
    await expect(slider, 'kein cellScale-Regler — der Skin deklariert den Tweak nicht mehr').toHaveCount(1);
    const min = await slider.getAttribute('min');
    expect(min, 'der cellScale-Regler deklariert kein Minimum').toBeTruthy();

    // Über die Tastatur ans Minimum: `Home` ist bei einem Range-Input genau das,
    // ohne den Wert von aussen ins DOM zu schreiben.
    await slider.focus();
    await page.keyboard.press('Home');

    // Vorbedingung: der Regler steht wirklich am Anschlag. Ohne diese Zusicherung
    // liefe die Messung unten womöglich beim Default-Wert 1.0 — also da, wo die
    // Kacheln ohnehin gross sind, und das Kriterium wäre nicht geprüft.
    await expect(slider, 'der Regler steht nicht am Minimum').toHaveValue(min!);
    const cellPx = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.overview-root')!).getPropertyValue('--vz-cell').trim(),
    );
    expect(cellPx, 'die Rasterdichte ist nicht in --vz-cell angekommen').toMatch(/^\d+px$/);

    const cells = await page.$$eval('.skin-host-cell[data-id]', (els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-id')!,
            width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10,
          };
        })
        .filter((c) => c.width > 0 && c.height > 0),
    );
    expect(cells.length, 'keine Kacheln gefunden — der Test hätte nichts gesehen').toBeGreaterThan(0);

    const tooSmall = cells.filter((c) => c.width < MIN_TOUCH_PX || c.height < MIN_TOUCH_PX);
    expect(
      tooSmall.map((c) => `${c.id} ${c.width}×${c.height}`),
      `Kacheln unter ${MIN_TOUCH_PX} px bei cellScale=${min} (--vz-cell: ${cellPx})`,
    ).toEqual([]);
  });
});
