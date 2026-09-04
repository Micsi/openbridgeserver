import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
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
 *
 * Diese Spec vergleicht deshalb nicht "irgendein Attribut ist da", sondern die
 * BEIDEN Wurzeln gegeneinander: dieselben Tweak-Werte, einmal ueber die echte
 * Seite (`SkinPage`, wie der Nutzer sie sieht) und einmal ueber die Bruecke
 * (`PreviewPage` + `postMessage`-Entwurf). Was `applyTweaks` an Attributen und
 * CSS-Variablen erzeugt, muss auf beiden Wurzeln identisch stehen - und das
 * Token-Theme, das der Host jedem Renderer reicht, muss dasselbe sein.
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
import PreviewPage from './PreviewPage.vue';
import de from '../locales/de.json';
import { useDeviceStore } from '../core/store';
import { MockDataSource } from '../core/datasource';
import { PREVIEW_CHANNEL, PREVIEW_MESSAGE, PREVIEW_PROTOCOL_VERSION } from './protocol';

/** Die Seite, die der Autor bearbeitet - im Live-Fall die ionic-Uebersicht. */
const LIVE_PAGE = 'overview';
/** Derselbe Skin ueber die Bruecke (Registry-Schluessel, kein Nachbau). */
const PREVIEW_SKIN = 'ionic';
const ADMIN_ORIGIN = window.location.origin;
const TOKEN = 'parity-session-token-5a1c';

/**
 * Ein voller Tweak-Satz, bewusst NICHT der Default: jeder Wert bewegt entweder
 * ein Wurzel-Attribut oder eine `--vz-*`-Variable. Ein Vergleich auf den
 * Defaults allein wuerde eine hart verdrahtete Vorschau nicht auffallen lassen.
 */
const TWEAKS = {
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
} as const;

/** Der Entwurf, den der Editor schickt: eine leere Seite reicht - verglichen
 *  wird die WURZEL, nicht der Inhalt. */
const NODES = [
  {
    id: 'p-parity',
    parent_id: null,
    name: 'Wohnen',
    type: 'PAGE',
    kind: 'normal',
    page_config: { widgets: [] },
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

function makeI18n() {
  return createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de } });
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

describe('preview - dieselbe Wurzel wie die echte Visu (E3)', () => {
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

  /** Die echte Seite, wie der Nutzer sie sieht - optional mit Tweaks des Autors. */
  async function mountLive(tweaks?: Record<string, unknown>) {
    // Der statische Boden der Live-Seite kommt aus der Demo-Quelle (wie main.ts).
    await useDeviceStore().init(new MockDataSource());
    const wrapper = mount(SkinPage, {
      props: { pageId: LIVE_PAGE },
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    if (tweaks) {
      // Ueber den echten Weg: der Autor oeffnet den Tweak-Editor und stellt ein.
      await wrapper.find('.overview-tweaks-toggle').trigger('click');
      wrapper.findComponent(TweaksPanel).vm.$emit('update:modelValue', tweaks);
      await flushPromises();
    }
    return wrapper;
  }

  /** Dieselbe Wurzel ueber die Bruecke: Handshake, dann der Entwurf. */
  async function mountPreview(draftExtra: Record<string, unknown> = {}) {
    const wrapper = mount(PreviewPage, { global: { plugins: [makeI18n()] } });
    await flushPromises();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    emit(
      message(PREVIEW_MESSAGE.draft, {
        draft: { skin: PREVIEW_SKIN, pageId: 'p-parity', nodes: NODES, ...draftExtra },
      }),
      ADMIN_ORIGIN,
      parent,
    );
    await flushPromises();
    return wrapper;
  }

  it('traegt bei gewaehlten Tweaks exakt dieselben Wurzel-Attribute und --vz-Variablen', async () => {
    const live = await mountLive(TWEAKS);
    const liveFacts = rootFacts(live.find('.overview-root').element);
    live.unmount();

    const preview = await mountPreview({ tweaks: TWEAKS });
    const canvas = preview.find('[data-testid="preview-canvas"]');
    expect(canvas.exists()).toBe(true);
    const previewFacts = rootFacts(canvas.element);

    // Der Vergleich waere wertlos, wenn die Live-Wurzel selbst nichts truege.
    expect(Object.keys(liveFacts.attrs).sort()).toEqual([
      'data-acc-style',
      'data-room-group',
      'data-stil',
      'data-theme',
      'data-titlebar',
    ]);
    expect(liveFacts.attrs['data-theme']).toBe('dark');
    expect(Object.keys(liveFacts.vars).filter((k) => k.startsWith('--vz-')).length).toBeGreaterThan(4);

    expect(previewFacts).toEqual(liveFacts);
  });

  it('traegt ohne Tweaks denselben Boden wie die echte Seite', async () => {
    const live = await mountLive();
    const liveFacts = rootFacts(live.find('.overview-root').element);
    live.unmount();

    const preview = await mountPreview();
    const previewFacts = rootFacts(preview.find('[data-testid="preview-canvas"]').element);

    expect(Object.keys(liveFacts.attrs).length).toBeGreaterThan(0);
    expect(previewFacts).toEqual(liveFacts);
  });

  it('reicht dem Host dasselbe Token-Theme wie die echte Seite', async () => {
    const live = await mountLive(TWEAKS);
    const liveHost = live.findComponent(DetailModalHost);
    const liveTheme = liveHost.props('theme');
    const liveRootBind = liveHost.props('rootBind');
    live.unmount();

    const preview = await mountPreview({ tweaks: TWEAKS });
    const previewHost = preview.findComponent(DetailModalHost);

    expect(liveTheme).toBe('dark');
    expect(previewHost.props('theme')).toBe(liveTheme);
    // `rootBind` traegt die Tokens in die ausgelagerte Detail-Flaeche (ion-modal
    // liegt ausserhalb der `.visu-root`) - ohne sie rendert der Dialog unstyled.
    expect(previewHost.props('rootBind')).toEqual(liveRootBind);
  });
});
