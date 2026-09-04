import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

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
 * (`PreviewPage` + `postMessage`-Entwurf).
 *
 * Und zwar FLAECHENDECKEND, nicht an genannten Punkten. Ein Nachweis, der vier
 * Stellen prueft, ist ueberall sonst blind: ein sichtbarer Knopf im
 * Vorschaurahmen, ein `<ion-note>` neben der Wurzel oder eine Spaltenzahl, die
 * nur die Vorschau setzt, sind alle drei echte Pixel und lagen alle drei
 * zwischen den Punkten. Der Kern ist deshalb der ABDRUCK DER GANZEN FLAECHE
 * ({@link structure}): beide Seiten stehen auf demselben Entwurfsboden und
 * werden Element fuer Element gehalten - Tag, Klassen, alle Attribute, alle
 * Stil-Eigenschaften, der eigene Text. Jede Abweichung ist ein Fehler, es sei
 * denn, sie steht in der kurzen, ausdruecklichen AUSNAHMELISTE (A1-A4, siehe
 * dort): das Editor-Chrome, die Vorschau-Marker, Vues Scoped-Marker und der
 * Seitenrahmen - und der Rahmen ist beidseitig vollstaendig ausgeschrieben.
 *
 * Darum herum liegen die Ebenen, die zusaetzlich einzeln benannt sind, weil sie
 * NICHT im DOM des Ausschnitts stehen:
 *
 *   - der Shell-Kanal  - Titel, Nav-Zustand, Wurzel-Bindung, Skin-Flaeche; er
 *                        zeichnet den Rahmen UM die Seite (App.vue)
 *   - die Skin-Wurzel  - Klassen, `data-*`, `--vz-*` ueber vier Tweak-Saetze,
 *                        alle drei Themes; plus die ausgelagerte Detail-Flaeche
 *                        (`ion-modal` am `<body>`, ausserhalb des Ausschnitts)
 *   - die Bindungen    - die VOLLSTAENDIGE Prop-Menge des Rasters, nicht vier
 *                        genannte Namen
 *   - der Seitenkasten - `<style scoped>` laesst sich zwischen zwei SFC nicht
 *                        teilen und wird im jsdom-Mount nie ausgerechnet; die
 *                        Kopie ist deshalb per Quelltext aneinandergebunden
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
import { PreviewDataSource } from './PreviewDataSource';
import { createHttpValueBackend } from './values';
import {
  PREVIEW_CHANNEL,
  PREVIEW_MESSAGE,
  PREVIEW_PROTOCOL_VERSION,
  type PreviewDraftNode,
  type PreviewTweaks,
} from './protocol';

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
/**
 * Die Widgets, die JEDE Entwurfsseite traegt. Ohne sie rendert der Entwurfsboden
 * gar nichts, und ein Vergleich zweier leerer Flaechen behauptet nichts. Die drei
 * decken ab, was auf einer Seite ueberhaupt Pixel macht: eine Kachel mit Wert
 * (`Licht`), eine mit Rollo-Steuerung (`Rolladen`) und einen SEITENLINK, dessen
 * Ziel die gezeigte Seite selbst ist - der traegt die Aktiv-Markierung
 * (`data-link-active`, `aria-current`) und den zugaenglichen Namen, an denen die
 * Bindungen `currentPage`/`pageNames` sichtbar werden.
 */
const draftWidgets = (pageId: string) => [
  {
    id: `${pageId}-lamp`,
    name: 'Stehlampe',
    type: 'Licht',
    datapoint_id: null,
    status_datapoint_id: null,
    config: { dp_switch: `dp-${pageId}-lamp`, dp_dim: `dp-${pageId}-dim` },
    x: 0,
    y: 0,
    w: 4,
    h: 2,
  },
  {
    id: `${pageId}-link`,
    name: 'Zur Uebersicht',
    type: 'Toggle',
    datapoint_id: `dp-${pageId}-link`,
    status_datapoint_id: null,
    config: { target_node_id: 'overview', active_indicator: 'dot' },
    x: 4,
    y: 0,
    w: 2,
    h: 2,
  },
  {
    id: `${pageId}-blind`,
    name: 'Rollo',
    type: 'Rolladen',
    datapoint_id: null,
    status_datapoint_id: null,
    config: { dp_move: `dp-${pageId}-move`, dp_position: `dp-${pageId}-pos` },
    x: 0,
    y: 2,
    w: 4,
    h: 2,
  },
];

const DRAFT_NODES: readonly PreviewDraftNode[] = PAGES.map((p) => ({
  id: p.id,
  parent_id: null,
  name: tr(p.titleKey),
  type: 'PAGE' as const,
  kind: 'normal' as const,
  page_config: { widgets: draftWidgets(p.id) },
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
 * Die drei Flaechen, die der HOST selbst aufspannt - kein Seiteninhalt, auf
 * beiden Seiten identisch und deshalb hier beim Namen genannt statt ueber einen
 * Tag-Praefix weggefiltert. Ein `ion-*`-Filter waere genau die zweite Tuer, durch
 * die ein `<ion-note>` neben der Wurzel unbemerkt hereinkaeme.
 */
const HOST_SURFACES = [
  'div.skin-host-detail-shell',
  'ion-modal.skin-host-modal',
  'ion-popover.skin-host-presets',
];

/**
 * Was ausser der Skin-Wurzel noch im GANZEN Seitenrahmen haengt - nicht nur als
 * direktes Kind der Host-Flaeche. Die drei Host-Flaechen werden durchschritten,
 * nicht uebersprungen: was in ihnen liegt, zaehlt genauso wie das, was daneben
 * liegt.
 */
function extrasBesideRoot(frame: Element): string[] {
  const out: string[] = [];
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      // Die Skin-Wurzel ist der Vergleichsgegenstand, nicht ein "Extra".
      if (child.classList.contains('overview-root')) continue;
      const sig = signature(child);
      if (HOST_SURFACES.includes(sig)) {
        walk(child);
        continue;
      }
      out.push(sig);
    }
  };
  walk(frame);
  return out;
}

/* ------------------------------------------------------ der Flaechenabdruck */

/**
 * DIE BENANNTE AUSNAHMELISTE. Ab hier wird nicht mehr an vier Punkten geprueft,
 * sondern die GESAMTE gerenderte Struktur beider Seiten gegeneinander gehalten:
 * jedes Element mit Tag, sortierten Klassen, allen Attributen, allen
 * Stil-Eigenschaften und seinem eigenen Text. Alles, was dabei abweichen DARF,
 * steht hier - und nur hier:
 *
 *   A1 **Editor-Chrome**: der Tweak-Umschalter der Live-Seite
 *      (`button.overview-tweaks-toggle`) samt seinem Panel (`.tweaks-panel`). Er
 *      IST der Editor: im Vorschau-Modus bedient der Autor ihn in der Admin-GUI,
 *      ein zweiter Editor im Rahmen haette einen eigenen Zustand, der beim ersten
 *      Klick vom Entwurf wegdriftete. Genau diese Sorte nimmt E3 aus. Die Ausnahme
 *      ist zweiseitig gepinnt (`extrasBesideRoot`): taucht sonst irgendwo etwas
 *      auf, faellt sie.
 *   A2 **Vorschau-Marker**: `data-testid="preview-canvas"`, `data-preview-page`,
 *      `data-preview-state`. Reine Griffe der Tests und der Bruecke, an denen kein
 *      Stylesheet haengt. Sie werden nicht stillschweigend ignoriert, sondern
 *      beidseitig auf eine exakte Attributmenge gepinnt (`frameFacts`, und der
 *      Test "markiert nur den Seitenrahmen als Vorschau").
 *   A3 **Vues Scoped-Marker** `data-v-*`: der Hash des jeweiligen SFC, kein
 *      Seiteninhalt - er ist per Konstruktion je Komponente verschieden.
 *   A4 **Der Seitenrahmen selbst**: `ion-page.skin-page[data-page=<id>]` gegen
 *      `ion-page.preview-page[data-page=preview][data-preview-state=ready]`. Der
 *      Rahmen wandert deshalb nicht in den Abdruck, sondern wird auf BEIDEN
 *      Seiten gegen eine vollstaendige, ausgeschriebene Attributmenge gehalten
 *      (`frameFacts`) - ein Attribut zu viel faellt dort auf.
 *
 * Der GERAETEBODEN ist ausdruecklich KEINE Ausnahme mehr: der Flaechen-Vergleich
 * stellt beide Seiten auf denselben Entwurfsboden (`mountLiveOnDraft`) - also auf
 * den externen Boden, auf dem auch die ausgelieferte Visu laeuft.
 */
const EDITOR_CHROME = '.overview-tweaks-toggle, .tweaks-panel';

/** A2: gehoert dieses Attribut zu den reinen Vorschau-Markern? */
function isPreviewMarker(name: string, value: string): boolean {
  if (name === 'data-testid') return value === 'preview-canvas';
  return name === 'data-preview-page' || name === 'data-preview-state';
}

/** Ein Element als eine Zeile: Pfad, Tag, Klassen, Attribute, Stil, eigener Text. */
function printElement(el: Element, path: string): string {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();
  const attrs: string[] = [];
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'class' || a.name === 'style') continue;
    if (a.name.startsWith('data-v-')) continue; // A3
    if (isPreviewMarker(a.name, a.value)) continue; // A2
    attrs.push(`${a.name}=${a.value}`);
  }
  const style: string[] = [];
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const name = decl.slice(0, i).trim();
    if (name.length === 0) continue;
    style.push(`${name}:${decl.slice(i + 1).trim()}`);
  }
  // Nur der EIGENE Text des Elements - der der Kinder steht bei den Kindern.
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [
    path,
    el.tagName.toLowerCase(),
    classes.join('.'),
    attrs.sort().join(' '),
    style.sort().join('; '),
    text,
  ].join(' | ');
}

/**
 * Der Strukturabdruck des SeitenINHALTS - alles UNTERHALB des Seitenrahmens (A4),
 * Element fuer Element in Dokumentordnung. `drop` schneidet die benannte Ausnahme
 * A1 heraus; die Geschwisterzaehlung laeuft erst nach dem Schnitt weiter, damit
 * die Pfade beider Seiten trotz der Ausnahme aufeinanderliegen.
 */
function structure(frame: Element, drop: (el: Element) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (el: Element, path: string): void => {
    let i = 0;
    for (const child of Array.from(el.children)) {
      if (drop(child)) continue;
      const childPath = `${path}/${i++}`;
      out.push(printElement(child, childPath));
      walk(child, childPath);
    }
  };
  walk(frame, '');
  return out;
}

/** A1: der Tweak-Editor der Live-Seite - die eine benannte Ausnahme im Abdruck. */
const isEditorChrome = (el: Element): boolean => el.matches(EDITOR_CHROME);

/**
 * Der Seitenrahmen eines Mounts. `SkinPage.vue` beginnt mit einem Kommentar, ist
 * damit ein Fragment - `wrapper.element` liefert dort den Testcontainer, nicht
 * die Seite. Ohne diesen Griff verglichen beide Seiten verschiedene Wurzeln.
 */
function frameOf(el: Element): Element {
  if (el.tagName.toLowerCase() === 'ion-page') return el;
  const found = el.querySelector('ion-page');
  if (!found) throw new Error('Kein Seitenrahmen (ion-page) im Mount gefunden');
  return found;
}

/** A4: der Seitenrahmen, vollstaendig - Tag, Klassen und ALLE Attribute. */
function frameFacts(el: Element): { tag: string; classes: string[]; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'class') continue;
    if (a.name.startsWith('data-v-')) continue; // A3
    attrs[a.name] = a.value;
  }
  return {
    tag: el.tagName.toLowerCase(),
    classes: (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort(),
    attrs,
  };
}

/**
 * Was die Seitenlinks im DOM tragen (#1194): Ziel, Anzeigeart, Aktiv-Markierung
 * und der zugaengliche Name. Das ist die SICHTBARE Wirkung der Bindungen
 * `currentPage`/`pageNames` - und die einzige, die auch auf externem Boden etwas
 * behauptet, wo die Live-Seite beide Props bewusst nicht reicht.
 */
function linkFacts(frame: Element): Record<string, string>[] {
  return Array.from(frame.querySelectorAll('[data-link]')).map((cell) => {
    const anchor = cell.querySelector('.skin-host-link');
    return {
      target: cell.getAttribute('data-link') ?? '',
      indicator: cell.getAttribute('data-link-indicator') ?? '',
      active: cell.getAttribute('data-link-active') ?? '',
      ariaCurrent: anchor?.getAttribute('aria-current') ?? '',
      label: anchor?.getAttribute('aria-label') ?? '',
    };
  });
}

/* ------------------------------------------------- der Kasten der Seite (M13) */

/** Beide SFC liegen im selben Repo; vom Arbeitsverzeichnis aus hochlaufen. */
const SKIN_PAGE_REL = join('apps', 'visu', 'src', 'pages', 'SkinPage.vue');
const PREVIEW_PAGE_REL = join('apps', 'visu', 'src', 'preview', 'PreviewPage.vue');

function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, SKIN_PAGE_REL)) && existsSync(join(dir, PREVIEW_PAGE_REL))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error('Weder Live-Seite noch Vorschau gefunden - Repo umgebaut?');
    dir = up;
  }
}

/**
 * Die Deklarationen EINER Regel aus dem `<style scoped>` eines SFC, normalisiert
 * und sortiert. Scoped CSS laesst sich zwischen zwei SFC nicht teilen (der
 * `data-v-*`-Marker gehoert je einem), die Kopie ist also unvermeidbar - aber
 * eine ungebundene Kopie darf sie nicht bleiben: `.preview-page` wiederholt
 * `.skin-page`, und diese Funktion ist die Klammer, die beide zusammenhaelt.
 */
function declarations(relPath: string, selector: string): string[] {
  const src = readFileSync(join(repoRoot(), relPath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = new RegExp(`(^|[\\s}])\\${selector}\\s*\\{([^}]*)\\}`, 'm').exec(src);
  if (!rule) throw new Error(`Regel ${selector} fehlt in ${relPath} - umbenannt oder entfernt?`);
  return rule[2]
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort();
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

  /**
   * Dieselbe echte Seite, aber auf DEM BODEN, auf dem die ausgelieferte Visu
   * steht: einer externen Quelle mit demselben Entwurfsbaum, den die Vorschau
   * bekommt. Genau hier wird der Nachweis erst hart:
   *
   *   - Beide Seiten rendern denselben Geraeteboden, also ist der Vergleich der
   *     GESAMTEN Struktur moeglich statt nur der Wurzel.
   *   - `SkinPage.vue` reicht auf externem Boden bewusst KEINE
   *     `currentPage`/`pageNames` durch (der Host entscheidet aus
   *     `store.currentPageId`), waehrend die Vorschau beide setzt. Verglichen
   *     wird deshalb die WIRKUNG im DOM, nicht der Prop-Wert - und dafuer wird
   *     die Navigation nachgestellt, die in der echten Visu auf diese Seite
   *     gefuehrt hat.
   */
  async function mountLiveOnDraft(pageId: string, tweaks?: Record<string, unknown>) {
    const store = useDeviceStore();
    const source = new PreviewDataSource(
      createHttpValueBackend(() => ({ accessToken: TOKEN })),
    );
    source.setDraft({
      skin: PAGES.find((p) => p.id === pageId)!.skin,
      pageId,
      nodes: DRAFT_NODES,
      ...(tweaks ? { tweaks: tweaks as PreviewTweaks } : {}),
    });
    await store.init(source);
    store.navigate(pageId);
    const ctx = reactive<ShellContext>({});
    const wrapper = mount(SkinPage, {
      props: { pageId },
      global: { plugins: [i18n], provide: { [SHELL_CONTEXT_KEY as symbol]: ctx } },
    });
    await flushPromises();
    if (tweaks) {
      await wrapper.find('.overview-tweaks-toggle').trigger('click');
      wrapper.findComponent(TweaksPanel).vm.$emit('update:modelValue', tweaks);
      await flushPromises();
      // Den Editor wieder zuklappen: die benannte Ausnahme A1 deckt den
      // Umschalter, nicht ein dauerhaft offenes Panel - und offen ist er auch auf
      // der echten Seite nur, solange der Autor ihn offen haelt.
      await wrapper.find('.overview-tweaks-toggle').trigger('click');
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

  /* ------------------------------------------------- die gesamte Seitenflaeche */

  /**
   * DER FLAECHEN-VERGLEICH. Nicht vier Punkte, sondern der ganze Baum: beide
   * Seiten stehen auf demselben Entwurfsboden und werden Element fuer Element
   * gegeneinander gehalten - Tag, Klassen, Attribute, Stil, Text. Was abweichen
   * darf, steht in der benannten Ausnahmeliste bei {@link EDITOR_CHROME}; alles
   * andere ist ein Fehler. Ein Knopf im Vorschaurahmen, ein `ion-*`-Element neben
   * der Wurzel oder eine abweichende Spaltenzahl faellt hier auf, ohne dass
   * irgendwo ein zusaetzlicher Punkt genannt werden muesste.
   */
  describe('die gesamte gerenderte Flaeche', () => {
    for (const scenario of SCENARIOS) {
      it(`ist Element fuer Element dieselbe wie live: ${scenario.name}`, async () => {
        const live = await mountLiveOnDraft('overview', scenario.tweaks);
        const liveFrame = frameFacts(frameOf(live.wrapper.element));
        const liveTree = structure(frameOf(live.wrapper.element), isEditorChrome);
        const liveExtras = extrasBesideRoot(frameOf(live.wrapper.element));
        live.wrapper.unmount();

        const preview = await mountPreview(
          'ionic',
          'overview',
          scenario.tweaks ? { tweaks: scenario.tweaks } : {},
        );

        // Selbstsicherungen: ein Vergleich zweier leerer oder halbleerer Baeume
        // waere still gruen. Die Live-Flaeche MUSS Kacheln, ein Raster mit
        // Spaltenzahl, einen aktiven Seitenlink und den Tweak-Umschalter tragen.
        expect(liveTree.length).toBeGreaterThan(20);
        expect(liveTree.some((l) => l.includes('skin-host-cell'))).toBe(true);
        expect(liveTree.some((l) => l.includes('--skin-host-columns'))).toBe(true);
        expect(liveTree.some((l) => l.includes('data-link-active=true'))).toBe(true);
        expect(liveExtras).toEqual(['button.overview-tweaks-toggle']);

        // A4: der Seitenrahmen ist die eine Stelle, die verschieden sein DARF -
        // und genau deshalb steht sie hier beidseitig vollstaendig ausgeschrieben.
        expect(liveFrame).toEqual({
          tag: 'ion-page',
          classes: ['skin-page'],
          attrs: { 'data-page': 'overview' },
        });
        expect(frameFacts(frameOf(preview.wrapper.element))).toEqual({
          tag: 'ion-page',
          classes: ['preview-page'],
          attrs: { 'data-page': 'preview', 'data-preview-state': 'ready' },
        });

        // Und darunter: kein Element, kein Attribut, keine Stil-Eigenschaft und
        // kein Text darf abweichen.
        expect(structure(frameOf(preview.wrapper.element))).toEqual(liveTree);
      });
    }

    /**
     * Die drei Skins - und diesmal mit Unterscheidungskraft. Bisher verglich der
     * edomi-Fall nur die Wurzel, und `edomi.rootClass` IST `visu-root` wie bei
     * ionic: er behauptete nichts, was der ionic-Fall nicht schon sagte. Auf der
     * ganzen Flaeche sind die drei dagegen wirklich verschieden - ionic rendert
     * ein gruppiertes Raster, terminal eine flache Liste (`.t-root`,
     * `skin-host-model-list`), edomi zeichnet seine Seite selbst aus dem
     * Layerstapel. Dass sie verschieden sind, wird hier ausdruecklich geprueft:
     * ohne das waere ein dritter Fall wieder nur eine dritte Kopie.
     */
    it('ist je Skin dieselbe wie live - und je Skin eine andere', async () => {
      const prints: Record<string, string[]> = {};
      for (const pageId of ['overview', 'terminal', 'edomi']) {
        const skin = PAGES.find((p) => p.id === pageId)!.skin;
        const live = await mountLiveOnDraft(pageId);
        const liveTree = structure(frameOf(live.wrapper.element), isEditorChrome);
        const liveRoot = rootFacts(live.wrapper.find('.overview-root').element);
        live.wrapper.unmount();

        const preview = await mountPreview(skin, pageId);
        expect(liveTree.length).toBeGreaterThan(5);
        expect(liveRoot.classes.length).toBeGreaterThan(0);
        expect(
          rootFacts(preview.wrapper.find('[data-testid="preview-canvas"]').element),
        ).toEqual(liveRoot);
        expect(structure(frameOf(preview.wrapper.element))).toEqual(liveTree);
        prints[skin] = liveTree;
        preview.wrapper.unmount();
      }
      // Die Selbstsicherung des Skin-Vergleichs: drei Faelle, drei Flaechen.
      expect(prints.ionic).not.toEqual(prints.terminal);
      expect(prints.ionic).not.toEqual(prints.edomi);
      expect(prints.terminal).not.toEqual(prints.edomi);
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
    /**
     * ALLE Bindungen, nicht vier genannte. Ein handgeschriebenes Vier-Schluessel-
     * Objekt liess `columns` hindurchfallen - eine Spaltenzahl, die nur die
     * Vorschau setzt, aendert `--skin-host-columns` und damit das Raster. Der
     * Geraeteboden (`groups`) bleibt die einzige, benannte Auslassung: auf dem
     * statischen Demo-Boden ist er per Konstruktion verschieden (der
     * Flaechen-Vergleich oben stellt beide Seiten deshalb auf denselben Boden).
     */
    const gridProps = (grid: { props(): Record<string, unknown> }): Record<string, unknown> => {
      const props = { ...grid.props() };
      delete props.groups;
      return props;
    };

    it('reicht dem Raster dieselben Bindungen wie die echte Seite', async () => {
      const live = await mountLive('overview');
      const liveGrid = live.wrapper.findComponent(OverviewGrid);
      const liveProps = gridProps(liveGrid);
      live.wrapper.unmount();

      const preview = await mountPreview('ionic', 'overview');
      const previewGrid = preview.wrapper.findComponent(OverviewGrid);

      // Der Vergleich traegt nur, wenn er die ganze Prop-Menge sieht: taucht am
      // Raster ein neuer Prop auf, faellt diese Zeile, statt dass er still
      // ausserhalb des Vergleichs bliebe.
      expect(Object.keys(liveProps).sort()).toEqual([
        'columns',
        'currentPage',
        'pageNames',
        'skin',
        'theme',
      ]);
      // Ohne diese beiden traegt die Zusicherung nichts: `currentPage` steuert,
      // welcher Link seine Aktiv-Markierung zeigt, `pageNames` den zugaenglichen
      // Namen jedes Links (WCAG 2.4.4).
      expect(liveProps.currentPage).toBe('overview');
      expect(liveProps.pageNames).toMatchObject({ overview: tr('pages.overview.title') });

      expect(gridProps(previewGrid)).toEqual(liveProps);
    });

    /**
     * Und derselbe Nachweis auf dem Boden, auf dem die ausgelieferte Visu steht.
     * Dort reicht `SkinPage.vue` bewusst weder `currentPage` noch `pageNames`
     * durch (der Host entscheidet aus `store.currentPageId` und dem Nav-Baum),
     * waehrend die Vorschau beide setzt - ein Prop-Vergleich behauptete hier also
     * gar nichts. Verglichen wird deshalb die WIRKUNG: welcher Link seine
     * Aktiv-Markierung traegt und welchen Namen jeder Link ansagt.
     */
    it('markiert auch auf externem Boden dieselbe Seite und benennt dieselben Links', async () => {
      const live = await mountLiveOnDraft('overview');
      expect(useDeviceStore().externalFloor).toBe(true);
      const liveGrid = live.wrapper.findComponent(OverviewGrid);
      // Die Ausgangslage, gegen die dieser Test antritt - beide Seiten laufen
      // hier durch VERSCHIEDENE Codezweige und muessen trotzdem gleich wirken.
      expect(liveGrid.props('currentPage')).toBeUndefined();
      expect(liveGrid.props('pageNames')).toBeUndefined();
      const liveLinks = linkFacts(frameOf(live.wrapper.element));
      live.wrapper.unmount();

      const preview = await mountPreview('ionic', 'overview');
      const previewGrid = preview.wrapper.findComponent(OverviewGrid);
      expect(previewGrid.props('currentPage')).toBe('overview');

      // Selbstsicherung: ohne Link, ohne Aktiv-Markierung und ohne Namen waere
      // ein Vergleich zweier leerer Listen still gruen.
      expect(liveLinks.length).toBeGreaterThan(0);
      expect(liveLinks.some((l) => l.active === 'true' && l.ariaCurrent === 'page')).toBe(true);
      expect(liveLinks.every((l) => l.label.length > 0)).toBe(true);

      expect(linkFacts(frameOf(preview.wrapper.element))).toEqual(liveLinks);
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
     *
     * Der Zaun laeuft um den GANZEN Seitenrahmen und durch die Host-Flaechen
     * hindurch (`extrasBesideRoot`), nicht nur um die direkten Kinder der
     * Host-Flaeche, und er filtert kein `ion-*` mehr weg - das waren die beiden
     * Tueren, durch die ein Knopf im Rahmen und ein `<ion-note>` neben der Wurzel
     * unbemerkt hereinkamen.
     */
    it('laesst als einziges sichtbares Element den Tweak-Editor weg', async () => {
      const live = await mountLive('overview');
      const liveExtras = extrasBesideRoot(frameOf(live.wrapper.element));
      expect(live.wrapper.find('.overview-tweaks-toggle').exists()).toBe(true);
      live.wrapper.unmount();

      const preview = await mountPreview('ionic', 'overview');
      expect(liveExtras).toEqual(['button.overview-tweaks-toggle']);
      expect(extrasBesideRoot(frameOf(preview.wrapper.element))).toEqual([]);
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
      // Und die Ausnahme A2 vollstaendig: mehr Vorschau-Marker als diese beiden
      // gibt es an der Wurzel nicht - was der Flaechenabdruck ausblendet, steht
      // damit hier ausgeschrieben, statt eine offene Menge zu sein.
      expect(canvas.getAttribute('data-testid')).toBe('preview-canvas');
      expect(canvas.getAttribute('data-preview-page')).toBe('overview');
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

  /**
   * Der Kasten der Seite - die eine Stelle, an der die Vorschau eine Regel der
   * echten Seite WIEDERHOLEN muss. `<style scoped>` traegt den `data-v-*`-Marker
   * genau eines SFC, die Regel laesst sich also nicht teilen; `.preview-page` ist
   * deshalb eine Kopie von `.skin-page`. Ungebunden war sie das Loch, durch das
   * ein `position: absolute; inset: 0; padding: 40px` in der Vorschau spurlos
   * durchging - im jsdom-Mount rechnet niemand Scoped-CSS aus, kein Abdruck der
   * Welt sieht das. Diese Probe ist die Klammer: sie haelt beide Stellen Zeile
   * fuer Zeile aneinander und faellt mit Klartext, sobald eine wandert.
   */
  describe('der Seitenkasten beider Seiten', () => {
    it('wiederholt die Regel der echten Seite unveraendert', () => {
      const liveBox = declarations(SKIN_PAGE_REL, '.skin-page');
      // Selbstsicherung: eine leere oder ausgeraeumte Live-Regel darf nicht
      // stillschweigend zur Messlatte werden.
      expect(liveBox).toEqual(['contain: layout style', 'position: relative']);
      expect(declarations(PREVIEW_PAGE_REL, '.preview-page')).toEqual(liveBox);
    });

    it('wiederholt auch die Regel der Skin-Wurzel unveraendert', () => {
      const liveRoot = declarations(SKIN_PAGE_REL, '.overview-root');
      expect(liveRoot).toEqual(['display: block']);
      expect(declarations(PREVIEW_PAGE_REL, '.overview-root')).toEqual(liveRoot);
    });
  });
});
