import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * preview/PreviewParity - der Gleichheitsbeweis fuer Messlatte E3 (C4, #171).
 *
 * E3 sagt: die Vorschau IST die Live-Visu, kein zweiter Renderer, "0 abweichende
 * Pixel ausserhalb des Editor-Chromes". Derselbe Renderer allein reicht dafuer
 * NICHT: die Flaechen- und Kachel-Tokens des ionic-Skins haengen an den
 * Wurzel-Attributen (`.visu-root[data-theme=…]`, `[data-stil=…]`) und an den
 * `--vz-*`-Variablen, die der Host aus den Tweak-Werten rechnet. Traegt die
 * Vorschau-Wurzel sie nicht, rendert dieselbe Komponentenkette eine andere Seite.
 * Und die Wurzel ist nur die Haelfte: der Rahmen um sie (Titel, Nav-Markierung,
 * Skin-Flaeche) kommt aus dem geteilten Shell-Kanal, die Aktiv-Anzeige und die
 * Namen der Links aus den Bindungen des Rasters.
 *
 * Diese Spec vergleicht deshalb nicht "irgendein Attribut ist da", sondern die
 * BEIDEN Seiten gegeneinander: dieselbe Seite, einmal ueber den echten Weg
 * (`SkinPage`, wie der Nutzer sie sieht) und einmal ueber die Bruecke
 * (`PreviewPage` + `postMessage`-Entwurf). Verglichen wird auf vier Ebenen:
 *
 *   1. die Skin-Wurzel  - Klassen, `data-*`, `--vz-*`; mehrere Tweak-Saetze,
 *                         alle drei Themes, drei Skins
 *   2. der Shell-Kanal  - Titel, Nav-Zustand, Wurzel-Bindung, Skin-Flaeche
 *   3. die Bindungen    - was Host und Raster an Theme, aktiver Seite und
 *                         Linknamen gereicht bekommen
 *   4. die Ausnahmen    - was bewusst abweicht, ausdruecklich benannt statt
 *                         stillschweigend ausgelassen (das Editor-Chrome)
 */

// Ionic-Webkomponenten sind nicht jsdom-freundlich (gleiches Muster wie
// OverviewPage.spec): auf durchreichende Elemente stubben, damit BEIDE Seiten
// unter exakt denselben Bedingungen montiert werden.
vi.mock('@ionic/vue', () => {
  const passthrough = (tag: string) =>
    defineComponent({
      name: tag,
      setup(_props, { slots }) {
        return () => h(tag, {}, slots.default ? slots.default() : []);
      },
    });
  return {
    IonApp: passthrough('ion-app'),
    IonContent: passthrough('ion-content'),
    IonHeader: passthrough('ion-header'),
    IonMenu: passthrough('ion-menu'),
    IonList: passthrough('ion-list'),
    IonItem: passthrough('ion-item'),
    IonLabel: passthrough('ion-label'),
    IonPage: passthrough('ion-page'),
    IonRouterOutlet: passthrough('ion-router-outlet'),
    IonToolbar: passthrough('ion-toolbar'),
    IonTitle: passthrough('ion-title'),
    IonModal: passthrough('ion-modal'),
    IonPopover: passthrough('ion-popover'),
    IonButtons: passthrough('ion-buttons'),
    IonMenuButton: passthrough('ion-menu-button'),
    IonRange: passthrough('ion-range'),
    IonSegment: passthrough('ion-segment'),
    IonSegmentButton: passthrough('ion-segment-button'),
    menuController: { close: vi.fn().mockResolvedValue(undefined) },
  };
});

import SkinPage from '../pages/SkinPage.vue';
import TweaksPanel from '../app/TweaksPanel.vue';
import DetailModalHost from '../app/DetailModalHost.vue';
import OverviewGrid from '../pages/OverviewGrid';
import PreviewPage from './PreviewPage.vue';
import de from '../locales/de.json';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { PAGES } from '../pages/pages';
import { SHELL_CONTEXT_KEY, type ShellContext } from '../app/shell/shellContext';
import { PREVIEW_CHANNEL, PREVIEW_MESSAGE, PREVIEW_PROTOCOL_VERSION } from './protocol';

const ADMIN_ORIGIN = window.location.origin;
const TOKEN = 'parity-session-token-5a1c';

const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } });
const tr = (key: string): string => i18n.global.t(key);

/**
 * Der Entwurfsbaum, den der Editor schickt: dieselbe SEITENMENGE wie die echte
 * Visu, mit denselben Titeln. Der Editor haelt die Seiten des Autors; hier sind
 * das genau die ausgelieferten `PAGES`, damit Titel, Nav-Zustand und Linknamen
 * beider Seiten ueberhaupt vergleichbar sind. Verglichen wird die BINDUNG, nicht
 * der Geraeteboden - der ist per Konstruktion verschieden (s. Ausnahmen unten).
 */
const DRAFT_NODES = PAGES.map((p) => ({
  id: p.id,
  parent_id: null,
  name: tr(p.titleKey),
  type: 'PAGE',
  kind: 'normal',
  page_config: { widgets: [] },
}));

/**
 * Die Tweak-Saetze, gegen die beide Seiten gefahren werden. Bewusst NICHT nur
 * die Defaults: jeder Satz bewegt Attribute UND Variablen, zusammen decken sie
 * alle drei Themes (`light`/`dark`/`image`), alle drei `stil`- und
 * `accentStyle`-Werte, `roomGroup: 'off'` (das `--vz-room-gap` auf 0 zwingt),
 * die optionalen `accent`/`photo` (die `applyTweaks` nur bedingt setzt) und die
 * Klemmung der Slider an ihren Manifest-Grenzen ab.
 */
const SCENARIOS: readonly {
  name: string;
  tweaks?: Record<string, unknown>;
  /** Das `data-theme`, das an der Wurzel stehen MUSS - sonst prueft der Satz nichts. */
  theme: string;
}[] = [
  // Kein Tweak: der Manifest-Boden. `applyTweaks` setzt hier `theme: image`.
  { name: 'Boden ohne Tweaks', theme: 'image' },
  {
    name: 'dark, ios, glow, Raumabstand',
    theme: 'dark',
    tweaks: {
      stil: 'ios',
      accentStyle: 'glow',
      theme: 'dark',
      glassBlur: 8,
      tileAlpha: 0.42,
      cellScale: 1.3,
      edge: 20,
      glow: 0.4,
      roomGroup: 'gap',
      roomGap: 30,
      showTitlebar: true,
    },
  },
  {
    // `image` ist der Live-Default und der einzige Wert, der die Bildflaeche
    // zieht; `photo`/`accent` sind die beiden Variablen, die `applyTweaks` nur
    // bedingt schreibt - eine gefilterte Weitergabe faellt genau hier auf.
    name: 'image, md, ring, Foto und Akzent, Raumtrennung aus',
    theme: 'image',
    tweaks: {
      stil: 'md',
      accentStyle: 'ring',
      theme: 'image',
      roomGroup: 'off',
      roomGap: 44,
      showTitlebar: false,
      accent: '#ff8800',
      photo: "/media/Kid's room.jpg",
    },
  },
  {
    // Werte ausserhalb der Manifest-Bereiche: beide Seiten muessen dieselbe
    // Klemmung sehen, nicht die eine den Rohwert und die andere den Rand.
    name: 'light, glass, bar, geklemmte Extremwerte',
    theme: 'light',
    tweaks: {
      stil: 'glass',
      accentStyle: 'bar',
      theme: 'light',
      glassBlur: -5,
      tileAlpha: 0.01,
      cellScale: 9,
      edge: -3,
      glow: 99,
      roomGroup: 'labels',
      roomGap: 0,
      showTitlebar: true,
    },
  },
];

/**
 * Was an einer Skin-Wurzel ueberhaupt Pixel bestimmt: die Klassen, die
 * `data-*`-Attribute (ohne die reinen Vorschau-Marker) und die
 * CSS-Custom-Properties aus dem `style`-Attribut.
 */
function rootFacts(el: Element): {
  classes: string[];
  attrs: Record<string, string>;
  vars: Record<string, string>;
} {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (!a.name.startsWith('data-')) continue;
    // Marker, die es nur im Vorschau-Modus gibt und die kein Stylesheet liest.
    if (a.name === 'data-testid' || a.name === 'data-preview-page') continue;
    // Der Scoped-CSS-Marker von Vue ist je Komponente verschieden - er gehoert
    // zum `<style scoped>` der jeweiligen Seite, nicht zur Skin-Wurzel.
    if (a.name.startsWith('data-v-')) continue;
    attrs[a.name] = a.value;
  }
  const vars: Record<string, string> = {};
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const name = decl.slice(0, i).trim();
    if (name.length === 0) continue;
    vars[name] = decl.slice(i + 1).trim();
  }
  return { classes: (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort(), attrs, vars };
}

/** Ein Elternfenster-Doppel (die Bruecke spricht nur mit `window.parent`). */
function fakeParent() {
  const sent: { message: unknown; targetOrigin: string }[] = [];
  return {
    sent,
    postMessage(message: unknown, targetOrigin: string): void {
      sent.push({ message, targetOrigin });
    },
  };
}

function emit(data: unknown, origin: string, source: unknown): void {
  window.dispatchEvent(Object.assign(new Event('message'), { data, origin, source }));
}

const message = (type: string, extra: Record<string, unknown> = {}) => ({
  channel: PREVIEW_CHANNEL,
  type,
  protocol: PREVIEW_PROTOCOL_VERSION,
  ...extra,
});

/** Element-Kennung fuer den Ausnahmen-Vergleich: `tag.klasse1.klasse2`. */
function signature(el: Element): string {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  return [el.tagName.toLowerCase(), ...classes].join('.');
}

/**
 * Was ausser der Skin-Wurzel noch in der Host-Flaeche haengt. Die Detail-Flaeche
 * des Hosts selbst (`ion-modal`/`ion-popover`) liegt auf beiden Seiten gleich -
 * sie ist hier nicht das Thema.
 */
function extrasBesideRoot(root: Element): string[] {
  const shell = root.querySelector('.skin-host-detail-shell');
  if (!shell) return ['<keine Host-Flaeche>'];
  return Array.from(shell.children)
    .filter((el) => !el.classList.contains('overview-root'))
    .filter((el) => !el.tagName.toLowerCase().startsWith('ion-'))
    .map(signature);
}

describe('preview - dieselbe Seite wie die echte Visu (E3)', () => {
  let parent: ReturnType<typeof fakeParent>;

  beforeEach(() => {
    setActivePinia(createPinia());
    parent = fakeParent();
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: 0 }) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
  });

  /**
   * Die echte Seite, wie der Nutzer sie sieht - optional mit Tweaks des Autors.
   * Der Shell-Kanal wird bereitgestellt wie in der laufenden App (`App.vue`),
   * damit sichtbar wird, was die Seite dem Rahmen ueberhaupt sagt.
   */
  async function mountLive(pageId: string, tweaks?: Record<string, unknown>) {
    // Der statische Boden der Live-Seite kommt aus der Demo-Quelle (wie main.ts).
    await useDeviceStore().init(new MockDataSource());
    const ctx = reactive<ShellContext>({});
    const wrapper = mount(SkinPage, {
      props: { pageId },
      global: { plugins: [i18n], provide: { [SHELL_CONTEXT_KEY as symbol]: ctx } },
    });
    await flushPromises();
    if (tweaks) {
      // Ueber den echten Weg: der Autor oeffnet den Tweak-Editor und stellt ein.
      await wrapper.find('.overview-tweaks-toggle').trigger('click');
      wrapper.findComponent(TweaksPanel).vm.$emit('update:modelValue', tweaks);
      await flushPromises();
    }
    return { wrapper, ctx };
  }

  /** Dieselbe Seite ueber die Bruecke: Handshake, dann der Entwurf. */
  async function mountPreview(
    skin: string,
    pageId: string,
    draftExtra: Record<string, unknown> = {},
  ) {
    const ctx = reactive<ShellContext>({});
    const wrapper = mount(PreviewPage, {
      global: { plugins: [i18n], provide: { [SHELL_CONTEXT_KEY as symbol]: ctx } },
    });
    await flushPromises();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    emit(
      message(PREVIEW_MESSAGE.draft, {
        draft: { skin, pageId, nodes: DRAFT_NODES, ...draftExtra },
      }),
      ADMIN_ORIGIN,
      parent,
    );
    await flushPromises();
    return { wrapper, ctx };
  }

  describe('die Skin-Wurzel', () => {
    for (const scenario of SCENARIOS) {
      it(`traegt dieselben Attribute und --vz-Variablen: ${scenario.name}`, async () => {
        const live = await mountLive('overview', scenario.tweaks);
        const liveFacts = rootFacts(live.wrapper.find('.overview-root').element);
        const liveHost = live.wrapper.findComponent(DetailModalHost);
        const liveTheme = liveHost.props('theme');
        const liveRootBind = liveHost.props('rootBind');
        live.wrapper.unmount();

        const preview = await mountPreview(
          'ionic',
          'overview',
          scenario.tweaks ? { tweaks: scenario.tweaks } : {},
        );
        const canvas = preview.wrapper.find('[data-testid="preview-canvas"]');
        expect(canvas.exists()).toBe(true);

        // Der Vergleich waere wertlos, wenn die Live-Wurzel selbst nichts truege.
        expect(Object.keys(liveFacts.attrs).sort()).toEqual([
          'data-acc-style',
          'data-room-group',
          'data-stil',
          'data-theme',
          'data-titlebar',
        ]);
        expect(liveFacts.attrs['data-theme']).toBe(scenario.theme);
        expect(
          Object.keys(liveFacts.vars).filter((k) => k.startsWith('--vz-')).length,
        ).toBeGreaterThan(4);

        expect(rootFacts(canvas.element)).toEqual(liveFacts);

        // Dieselben Tokens auch in der AUSGELAGERTEN Detail-Flaeche: das
        // `ion-modal` haengt am `<body>`, ausserhalb der `.visu-root`.
        const previewHost = preview.wrapper.findComponent(DetailModalHost);
        expect(previewHost.props('theme')).toBe(liveTheme);
        expect(previewHost.props('rootBind')).toEqual(liveRootBind);
      });
    }

    it('setzt bei roomGroup=off auch in der Vorschau den Nullabstand', async () => {
      // Eine gefilterte Weitergabe wuerde hier den Default (22px) zeigen.
      const preview = await mountPreview('ionic', 'overview', {
        tweaks: { roomGroup: 'off', roomGap: 44 },
      });
      const facts = rootFacts(preview.wrapper.find('[data-testid="preview-canvas"]').element);
      expect(facts.vars['--vz-room-gap']).toBe('0px');
      expect(facts.attrs['data-room-group']).toBe('off');
    });
  });

  /**
   * Der zweite und dritte Skin. `edomi` ist der M5-relevante (er zeichnet seine
   * Seite selbst), `terminal` traegt eine ANDERE CSS-Flaeche (`.t-root` statt
   * `.visu-root`) - eine hart verdrahtete ionic-Wurzel in der Vorschau faellt
   * genau hier auf. Beide Skins deklarieren keine Tweaks, ihr Manifest-Boden ist
   * also die vollstaendige Paritaetsflaeche.
   */
  describe.each([
    ['edomi', 'edomi'],
    ['terminal', 'terminal'],
  ])('der Skin %s', (skin, pageId) => {
    it('traegt in der Vorschau dieselbe Wurzel wie die echte Seite', async () => {
      const live = await mountLive(pageId);
      const liveFacts = rootFacts(live.wrapper.find('.overview-root').element);
      live.wrapper.unmount();

      const preview = await mountPreview(skin, pageId);
      const previewFacts = rootFacts(
        preview.wrapper.find('[data-testid="preview-canvas"]').element,
      );

      expect(liveFacts.classes.length).toBeGreaterThan(0);
      expect(previewFacts).toEqual(liveFacts);
    });
  });

  describe('der Shell-Kanal um die Seite', () => {
    // `AppShell` zeichnet Kopf und Nav aus diesem Kanal; ohne Titel faellt sie auf
    // `t('shell.nav.<aktiver Key>')` zurueck - in der Vorschau also dauerhaft
    // "Uebersicht", egal welche Seite der Autor gerade bearbeitet.
    it.each([
      ['overview', 'pages.overview.title', { active: 'overview' }],
      ['terminal', 'pages.terminal.title', {}],
    ])('speist fuer %s denselben Rahmen wie die echte Seite', async (pageId, titleKey, state) => {
      const skin = PAGES.find((p) => p.id === pageId)!.skin;
      const live = await mountLive(pageId);
      const liveCtx = { ...live.ctx };
      live.wrapper.unmount();

      const preview = await mountPreview(skin, pageId);
      const previewCtx = { ...preview.ctx };

      // Der Vergleich waere wertlos, wenn die Live-Seite selbst nichts schriebe.
      expect(liveCtx.title).toBe(tr(titleKey));
      expect(liveCtx.state).toEqual(state);
      expect(previewCtx).toEqual(liveCtx);
    });

    it('zeigt nicht den Nav-Ruecktitel, wenn die Seite gar nicht die Uebersicht ist', async () => {
      // Diese Zusicherung faellt genau dann, wenn die Vorschau den Titel
      // weglaesst: `AppShell` zeigt dann "Uebersicht" statt "Terminal".
      const preview = await mountPreview('terminal', 'terminal');
      expect(preview.ctx.title).toBe(tr('pages.terminal.title'));
      expect(preview.ctx.title).not.toBe(tr('shell.nav.overview'));
    });
  });

  describe('die Bindungen des Rasters', () => {
    it('reicht dem Raster dieselben Bindungen wie die echte Seite', async () => {
      const live = await mountLive('overview');
      const liveGrid = live.wrapper.findComponent(OverviewGrid);
      const liveProps = {
        skin: liveGrid.props('skin'),
        theme: liveGrid.props('theme'),
        currentPage: liveGrid.props('currentPage'),
        pageNames: liveGrid.props('pageNames'),
      };
      live.wrapper.unmount();

      const preview = await mountPreview('ionic', 'overview');
      const previewGrid = preview.wrapper.findComponent(OverviewGrid);

      // Ohne diese beiden traegt die Zusicherung nichts: `currentPage` steuert,
      // welcher Link seine Aktiv-Markierung zeigt, `pageNames` den zugaenglichen
      // Namen jedes Links (WCAG 2.4.4).
      expect(liveProps.currentPage).toBe('overview');
      expect(liveProps.pageNames).toMatchObject({ overview: tr('pages.overview.title') });

      expect({
        skin: previewGrid.props('skin'),
        theme: previewGrid.props('theme'),
        currentPage: previewGrid.props('currentPage'),
        pageNames: previewGrid.props('pageNames'),
      }).toEqual(liveProps);
    });
  });

  describe('die bewusst bleibenden Abweichungen', () => {
    /**
     * E3 sagt "0 abweichende Pixel **ausserhalb des Editor-Chromes**". Genau ein
     * sichtbares Element faellt darunter: der Tweak-Umschalter der Live-Seite
     * (A6). Er IST der Tweak-Editor - im Vorschau-Modus bedient der Autor ihn im
     * Editor der Admin-GUI, und ein zweiter Editor im Rahmen haette einen eigenen
     * Zustand, der vom Entwurf wegdriften koennte. Die Ausnahme wird hier
     * ausdruecklich festgehalten, nicht stillschweigend ausgelassen: taucht auf
     * einer der beiden Seiten irgendetwas anderes auf, faellt die Zusicherung.
     */
    it('laesst als einziges sichtbares Element den Tweak-Editor weg', async () => {
      const live = await mountLive('overview');
      const liveExtras = extrasBesideRoot(live.wrapper.element);
      expect(live.wrapper.find('.overview-tweaks-toggle').exists()).toBe(true);
      live.wrapper.unmount();

      const preview = await mountPreview('ionic', 'overview');
      expect(liveExtras).toEqual(['button.overview-tweaks-toggle']);
      expect(extrasBesideRoot(preview.wrapper.element)).toEqual([]);
      expect(preview.wrapper.find('.overview-tweaks-toggle').exists()).toBe(false);
    });

    /**
     * Die zweite Ausnahme ist kein Pixel: der Seitenrahmen der Vorschau traegt
     * eigene Marker (`data-page="preview"`, `data-preview-state`), an denen kein
     * Stylesheet haengt - sie sind der Griff der Tests und der Bruecke. Auf der
     * Skin-Wurzel selbst steht keiner von beiden.
     */
    it('markiert nur den Seitenrahmen als Vorschau, nicht die Skin-Wurzel', async () => {
      const preview = await mountPreview('ionic', 'overview');
      const page = preview.wrapper.element as HTMLElement;
      expect(page.getAttribute('data-page')).toBe('preview');
      expect(page.getAttribute('data-preview-state')).toBe('ready');
      const canvas = preview.wrapper.find('[data-testid="preview-canvas"]').element;
      expect(canvas.getAttribute('data-page')).toBeNull();
      expect(canvas.getAttribute('data-preview-state')).toBeNull();
    });

    /**
     * Die dritte Ausnahme ist Absicht und keine Abweichung der Bruecke: der
     * GERAETEBODEN. Die Live-Seite steht hier auf dem Demo-Modell, die Vorschau
     * auf dem Entwurfsbaum des Editors - verglichen wird deshalb ueberall die
     * Bindung, nie der Inhalt. Dass derselbe Boden auf beiden Seiten gleich
     * rendert, ist die Zusage des gemeinsamen Renderers (SkinHost-Specs).
     */
    it('steht auf dem Entwurfsboden, nicht auf dem Demo-Modell', async () => {
      await mountPreview('ionic', 'overview');
      expect(useDeviceStore().externalFloor).toBe(true);
    });
  });
});
