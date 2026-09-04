import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
 *   - der Stilblock    - `<style scoped>` laesst sich zwischen zwei SFC nicht
 *                        teilen und wird im jsdom-Mount nie ausgerechnet; die
 *                        Kopie ist deshalb per QUELLTEXT gebunden, und zwar der
 *                        GANZE Block Regel fuer Regel, nicht zwei Selektoren
 *   - der Rand          - was eine Seite NEBEN ihren Rahmen haengt (Teleport,
 *                        Portal, Overlay am `<body>`) - der Abdruck beginnt am
 *                        `ion-page`, dort endet er aber nicht
 *
 * WAS DIESER NACHWEIS NICHT MISST - ausdruecklich, damit ihn niemand fuer eine
 * Pixelgarantie haelt: ein jsdom-Lauf rechnet KEINE Stylesheets aus. Berechnete
 * Stile aus globalen Blaettern und Pseudo-Elemente (`::before`/`::after`) leben
 * ausschliesslich im Stylesheet und sind hier grundsaetzlich unsichtbar (der
 * Test "misst keine berechneten Stile" haelt genau das fest). Der Stilnachweis
 * unten ist deshalb ein QUELLTEXT-Vergleich beider Stilbloecke, kein
 * Pixelvergleich. Die Pixel selbst misst Teil E als Szenario E3 (Pixel-Diff im
 * echten Browser); die jsdom-Paritaet ist dessen Vorbedingung, nicht sein
 * Ersatz.
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

/**
 * A2, eng: gehoert dieses Attribut AN DIESER STELLE zu den reinen
 * Vorschau-Markern? Frueher stand hier nur der Attributname - damit war jedes
 * Element mit jedem Wert ausgenommen, und zwei zusaetzliche Marker am Raster
 * blieben unsichtbar (Kritik R4, Probe N7). Ausgenommen ist deshalb jetzt nur
 * die BESTIMMTE Stelle mit dem BESTIMMTEN Wert:
 *
 *   - die Skin-Wurzel traegt `data-testid="preview-canvas"` (der Griff der
 *     Tests) und `data-preview-page="<Seite des Entwurfs>"` (der Griff der
 *     Bruecke). Ihr Wert ist die Seite, die auch der Entwurf nennt.
 *   - `data-preview-state` steht ausschliesslich am Seitenrahmen und faellt
 *     damit unter A4 (`frameFacts`), nicht hier: im Abdruck ist es ueberall ein
 *     Unterschied.
 *
 * Alles andere - anderes Element, anderer Wert, anderer Name - ist eine
 * Abweichung wie jede andere.
 */
function isPreviewMarker(el: Element, name: string, value: string, pageId: string): boolean {
  if (!el.classList.contains('overview-root')) return false;
  if (name === 'data-testid') return value === 'preview-canvas';
  return name === 'data-preview-page' && value === pageId;
}

/**
 * Die Seite, die der Abdruck gerade zeigt - der einzige Wert, den A2 an der
 * Wurzel durchgehen laesst. Der Live-Baum traegt den Marker gar nicht; dort ist
 * der Wert deshalb ohne Wirkung.
 */
let markedPageId = '';

/** Ein Element als eine Zeile: Pfad, Tag, Klassen, Attribute, Stil, eigener Text. */
function printElement(el: Element, path: string): string {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).sort();
  const attrs: string[] = [];
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'class' || a.name === 'style') continue;
    if (a.name.startsWith('data-v-')) continue; // A3
    if (isPreviewMarker(el, a.name, a.value, markedPageId)) continue; // A2
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
function structure(
  frame: Element,
  drop: (el: Element) => boolean = () => false,
  prefix = '',
): string[] {
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
  walk(frame, prefix);
  return out;
}

/**
 * WAS DIE SEITE NEBEN IHREM RAHMEN ERZEUGT. Der Abdruck oben beginnt am
 * `ion-page` - und endete frueher auch dort. Ein `<Teleport to="body">` haengt
 * aber daneben, genau dort, wo in der echten App auch Ionics Overlays landen:
 * ein sichtbares „Entwurfsvorschau"-Banner am `<body>` blieb deshalb unsichtbar
 * (Kritik R4, Probe N3). Gemessen wird jetzt, was zwischen dem Zeitpunkt VOR
 * dem Mount und jetzt neu am `<body>` haengt - ohne den Behaelter, in dem der
 * Rahmen selbst steckt, denn der IST die Seite und wird oben verglichen.
 *
 * Ausgenommen bleibt nur das: der eigene Behaelter. Alles andere - Portale,
 * Teleports, direkt angehaengte Knoten - wird mit Tag, Klassen, Attributen,
 * Stil und Text abgedruckt wie jedes Element im Rahmen. Dass der Zaun nicht nur
 * deshalb leer ist, weil er nicht hinsieht, prueft die Gegenprobe im Test
 * "sieht auch, was neben dem Rahmen am <body> haengt".
 */
function outsideFrame(before: readonly Element[], frame: Element): string[] {
  const roots = Array.from(document.body.children).filter(
    (el) => !before.includes(el) && !el.contains(frame),
  );
  return roots.flatMap((root, i) => [
    printElement(root, `@body/${i}`),
    ...structure(root, () => false, `@body/${i}`),
  ]);
}

/**
 * Die Texte, die der Entwurfsboden auf JEDER Flaeche erzeugt: der Name einer
 * Kachel, der Name des Seitenlinks, der Zustand eines Schalters und die Einheit
 * des Rollo-Werts. Sie sind der Pruefstein fuer {@link contentFacts}.
 */
const WIDGET_TEXTS = ['Rollo', 'Zur Uebersicht', 'Aus', '%'];

/**
 * DIE SUBSTANZ einer Flaeche - nicht ihre Zeilenzahl. Eine Schwelle
 * (`liveTree.length > 20`) faengt nur den LEEREN Baum. Sie bleibt still, wenn
 * BEIDE Seiten gleichzeitig ausgehoehlt werden: der Kachelkoerper in der
 * GETEILTEN Renderkette (`SkinHost.renderTile`) durch ein leeres `<div>`
 * ersetzt - jede Kachel beider Seiten verliert ihren ganzen Inhalt, Zellhuellen,
 * Spaltenzahl und Aktiv-Markierung bleiben stehen, und der Vergleich blieb
 * 20 von 20 gruen (Kritik R4 §2, Probe B1).
 *
 * Diese Probe schaut deshalb IN die Kacheln statt auf ihre Zahl: wie viele es
 * gibt, wie viel die DUENNSTE von ihnen ueberhaupt traegt, und ob die Namen und
 * Werte der Entwurfs-Widgets als Text auf der Flaeche stehen.
 */
function contentFacts(tree: string[]): {
  cells: number;
  thinnestCell: number;
  widgetTexts: string[];
} {
  const cellPaths = tree
    .filter((line) => line.split(' | ')[2].split('.').includes('skin-host-cell'))
    .map((line) => line.split(' | ')[0]);
  const text = tree.map((line) => line.split(' | ')[5] ?? '').join(' ');
  return {
    cells: cellPaths.length,
    thinnestCell:
      cellPaths.length === 0
        ? 0
        : Math.min(
            ...cellPaths.map(
              (p) => tree.filter((l) => l.split(' | ')[0].startsWith(`${p}/`)).length,
            ),
          ),
    widgetTexts: WIDGET_TEXTS.filter((needle) => text.includes(needle)),
  };
}

/** Die Selbstsicherung gegen „beide Seiten gleich kaputt", an einer Stelle. */
function expectSubstance(tree: string[]): void {
  const facts = contentFacts(tree);
  expect(facts.cells).toBeGreaterThanOrEqual(3);
  // Eine Kachel ohne Koerper haette hier 0 bis 2 Zeilen.
  expect(facts.thinnestCell).toBeGreaterThanOrEqual(5);
  expect(facts.widgetTexts).toEqual(WIDGET_TEXTS);
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
 * Der Stilblock beider SFC, Regel fuer Regel. Scoped CSS laesst sich zwischen
 * zwei SFC nicht teilen (der `data-v-*`-Marker gehoert je einem), die Kopie ist
 * also unvermeidbar - aber eine ungebundene Kopie darf sie nicht bleiben.
 *
 * Frueher hing die Klammer an ZWEI genannten Selektoren, und jede zusaetzliche
 * Regel schluepfte durch: eine zweite `.preview-page`-Regel im selben Block
 * gewinnt in der Kaskade und blieb gruen, ein `@media`-Override und eine
 * `:deep()`-Regel ebenso (Kritik R4, Proben N2 und N9). Verglichen wird deshalb
 * jetzt der GANZE Block: jede Regel der Vorschau muss eine Entsprechung auf der
 * echten Seite haben oder als benannte Ausnahme gefuehrt sein - und umgekehrt.
 */
type CssRule = { at: string; selector: string; decls: string[] };

/**
 * Selektor normalisiert: Leerraum zusammengezogen, Kombinatoren mit festem
 * Abstand, Selektorlisten sortiert. Damit faellt eine Regel nicht wegen der
 * Formatierung auf, sondern nur, wenn sie wirklich eine andere ist.
 */
function normalizeSelector(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .split(',')
    .map((part) => part.trim().replace(/\s*([>+~])\s*/g, ' $1 '))
    .filter(Boolean)
    .sort()
    .join(', ');
}

/**
 * Deklarationen normalisiert: Eigenschaft klein, GENAU ein Leerzeichen nach dem
 * Doppelpunkt, sortiert. Ohne den Doppelpunkt-Teil machte ein Prettier-Lauf mit
 * anderer Konfiguration die Probe falsch rot (`position:relative` statt
 * `position: relative`), ohne dass sich ein Pixel bewegt (Kritik R4, Probe F1).
 */
function normalizeDecls(body: string): string[] {
  return body
    .split(';')
    .map((d) => d.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? d : `${d.slice(0, i).trim().toLowerCase()}: ${d.slice(i + 1).trim()}`;
    })
    .sort();
}

/**
 * ALLE Regeln eines Stilblocks - auch die zweite mit demselben Selektor, auch
 * die in `@media`/`@supports` (der Kontext wandert in `at` und damit in den
 * Vergleich), auch ein blockloses `@import` (das waere ein zweites Blatt). Was
 * der Parser NICHT lesen kann, wirft: verschachtelte Regeln bekommen eine
 * Fehlermeldung statt still durchzurutschen.
 */
function parseRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const walk = (text: string, at: string): void => {
    let head = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === '{') depth += 1;
          else if (text[j] === '}') depth -= 1;
          j += 1;
        }
        const body = text.slice(i + 1, j - 1);
        const selector = normalizeSelector(head);
        if (/^@(media|supports|container|layer|scope|document)\b/.test(selector)) {
          walk(body, at.length > 0 ? `${at} ${selector}` : selector);
        } else {
          if (body.includes('{')) {
            throw new Error(`Verschachtelte Regel in "${selector}" - der Vergleich liest sie nicht`);
          }
          out.push({ at, selector, decls: normalizeDecls(body) });
        }
        head = '';
        i = j;
        continue;
      }
      if (ch === ';' && head.trim().startsWith('@')) {
        // `@import`/`@charset`: eine Anweisung ohne Block, aber mit Wirkung.
        out.push({ at, selector: normalizeSelector(head), decls: [] });
        head = '';
        i += 1;
        continue;
      }
      head += ch;
      i += 1;
    }
    if (head.trim().length > 0) throw new Error(`CSS-Rest ohne Block: "${head.trim()}"`);
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), '');
  return out;
}

/**
 * Ein SFC-Block steht am Zeilenanfang - die Verankerung ist kein Schoenheits-
 * fehler, sondern noetig: ohne sie liest der Ausdruck die Erwaehnung
 * "`<style scoped>`" in einem Kommentar als oeffnendes Tag und haelt danach den
 * halben Quelltext fuer CSS.
 */
const STYLE_BLOCK = /^[ \t]*<style([^>]*)>([\s\S]*?)^[ \t]*<\/style>/gm;

function styleBlocks(source: string): { attrs: string; css: string }[] {
  return Array.from(source.matchAll(STYLE_BLOCK)).map((m) => ({
    attrs: m[1].trim(),
    css: m[2],
  }));
}

/** Alle Regeln ALLER Stilbloecke eines SFC. */
function ruleSet(relPath: string): CssRule[] {
  const src = readFileSync(join(repoRoot(), relPath), 'utf8');
  return styleBlocks(src).flatMap((b) => parseRules(b.css));
}

/** Eine Regel als eine Zeile - Kontext, Selektor, Deklarationen. */
const ruleKey = (r: CssRule): string =>
  `${r.at.length > 0 ? `${r.at} ` : ''}${r.selector} { ${r.decls.join('; ')} }`;

/**
 * A5 **Die Umbenennung des Seitenrahmens.** `.preview-page` IST `.skin-page`;
 * die Klasse MUSS verschieden heissen, sonst kollidierte das scoped CSS beider
 * SFC. Der Vergleich nimmt die Regel deshalb nicht AUS, sondern uebersetzt sie:
 * jede Vorschau-Regel wird auf ihren Live-Namen gebracht und muss dann
 * Deklaration fuer Deklaration passen. Genau durch diese Tuer gingen N2 und N9.
 */
const SELECTOR_RENAMES: readonly [string, string][] = [['.preview-page', '.skin-page']];

const toLiveNames = (selector: string): string =>
  SELECTOR_RENAMES.reduce(
    (acc, [from, to]) => acc.replace(new RegExp(`\\${from}(?![\\w-])`, 'g'), to),
    selector,
  );

/**
 * A6 **Die benannten Einzelregeln.** NUR diese beiden Selektoren duerfen auf
 * einer Seite stehen und auf der anderen fehlen; jede weitere Regel auf einer
 * der beiden Seiten ist ein Fehler:
 *
 *   - `.preview-hint` (nur Vorschau): der Platzhalter, den die Vorschau zeigt,
 *     SOLANGE ueberhaupt kein Entwurf da ist (`v-else`). Sobald ein Entwurf
 *     steht - und nur dann wird verglichen -, ist das Element aus dem DOM; die
 *     Regel kann die gezeigte Seite also gar nicht faerben. Ihre Deklarationen
 *     stehen unten trotzdem ausgeschrieben.
 *   - `.overview-tweaks-toggle` (nur live): das Editor-Chrome aus A1 - genau
 *     das Element, das die Vorschau bewusst nicht rendert.
 */
const PREVIEW_ONLY_RULES: readonly string[] = ['.preview-hint'];
const LIVE_ONLY_RULES: readonly string[] = ['.overview-tweaks-toggle'];

/**
 * Der zweite Weg zu demselben Pixel: ein eigenes Stylesheet im Vorschau-Chunk.
 * Ein Blatt, das der Vorschau-Modus nachlaedt, haengt genauso an
 * `.preview-page` und faerbt genauso nur die Vorschau - dieselbe Abweichung,
 * nur ausserhalb des Blocks geschrieben (Kritik R4, Probe N1). Der
 * Blockvergleich oben sieht sie nicht, also wird hier gezaehlt, was der
 * Vorschau-Chunk ueberhaupt an Stil mitbringt. Testdateien bleiben aus: sie
 * werden nicht ausgeliefert und koennen kein Pixel faerben.
 */
function previewStyleArtifacts(): string[] {
  const dir = join(repoRoot(), 'apps', 'visu', 'src', 'preview');
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.spec.ts')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(`${name}/ (Unterverzeichnis)`);
      continue;
    }
    if (/\.(css|scss|sass|less|styl)$/.test(name)) {
      out.push(`${name} (Stylesheet)`);
      continue;
    }
    const src = readFileSync(path, 'utf8');
    for (const block of styleBlocks(src)) out.push(`${name} <style ${block.attrs}>`);
    for (const m of src.matchAll(
      /import\s+(?:[^'";]*from\s*)?['"]([^'"]+\.(?:css|scss|sass|less|styl))['"]/g,
    )) {
      out.push(`${name} importiert ${m[1]}`);
    }
  }
  return out;
}

/** Die Griffe, an denen NUR die Vorschau haengt - kein Blatt darf an ihnen faerben. */
const PREVIEW_HOOKS = ['preview-page', 'preview-canvas', 'preview-hint', 'data-preview'];

/**
 * Und derselbe Weg von der anderen Seite - denn ein Blatt muss nicht im
 * Vorschau-Verzeichnis liegen, um nur die Vorschau zu faerben: es muss nur an
 * einem Vorschau-Griff haengen. Gesucht wird deshalb in JEDEM Stylesheet und
 * jedem `<style>`-Block unter `apps/visu/src` und `packages/` - dort liegt
 * jedes CSS, das diese App ausliefert. Zusammen mit
 * {@link previewStyleArtifacts} ist damit beides zu: ein neues Blatt im
 * Vorschau-Chunk und ein Vorschau-Selektor in einem fremden Blatt. `scanned`
 * ist die Gegenprobe: ein Scanner, der nichts findet, weil er nichts liest,
 * faellt an dieser Zahl auf.
 */
function foreignPreviewStyles(): { scanned: number; hits: string[] } {
  const root = repoRoot();
  const own = join(root, 'apps', 'visu', 'src', 'preview', 'PreviewPage.vue');
  const hits: string[] = [];
  let scanned = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const isSheet = /\.(css|scss|sass|less|styl)$/.test(name);
      if (!isSheet && !name.endsWith('.vue')) continue;
      scanned += 1;
      if (path === own) continue;
      const src = readFileSync(path, 'utf8');
      const css = isSheet ? src : styleBlocks(src).map((b) => b.css).join('\n');
      for (const hook of PREVIEW_HOOKS) {
        if (css.includes(hook)) hits.push(`${path.slice(root.length + 1)}: ${hook}`);
      }
    }
  };
  walk(join(root, 'apps', 'visu', 'src'));
  walk(join(root, 'packages'));
  return { scanned, hits };
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
    const bodyBefore = Array.from(document.body.children);
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
    return { wrapper, ctx, outside: () => outsideFrame(bodyBefore, frameOf(wrapper.element)) };
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
    const bodyBefore = Array.from(document.body.children);
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
    return { wrapper, ctx, outside: () => outsideFrame(bodyBefore, frameOf(wrapper.element)) };
  }

  /** Dieselbe Seite ueber die Bruecke: Handshake, dann der Entwurf. */
  async function mountPreview(
    skin: string,
    pageId: string,
    draftExtra: Record<string, unknown> = {},
  ) {
    const bodyBefore = Array.from(document.body.children);
    // A2 laesst den Wurzel-Marker nur mit DIESEM Wert durch (s. isPreviewMarker).
    markedPageId = pageId;
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
    return { wrapper, ctx, outside: () => outsideFrame(bodyBefore, frameOf(wrapper.element)) };
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
        const liveOutside = live.outside();
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
        expect(liveTree.some((l) => l.includes('--skin-host-columns'))).toBe(true);
        expect(liveTree.some((l) => l.includes('data-link-active=true'))).toBe(true);
        expect(liveExtras).toEqual(['button.overview-tweaks-toggle']);
        // Und die Sicherung gegen „beide Seiten gleich kaputt": nicht die Zahl
        // der Zeilen, sondern der Inhalt der Kacheln (s. contentFacts).
        expectSubstance(liveTree);

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

        // Der Zaun endet nicht am Rahmen: was eine Seite NEBEN ihn haengt
        // (Teleport, Portal, Overlay am `<body>`), zaehlt genauso.
        expect(liveOutside).toEqual([]);
        expect(preview.outside()).toEqual(liveOutside);
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
        const liveOutside = live.outside();
        live.wrapper.unmount();

        const preview = await mountPreview(skin, pageId);
        expectSubstance(liveTree);
        expect(liveRoot.classes.length).toBeGreaterThan(0);
        expect(
          rootFacts(preview.wrapper.find('[data-testid="preview-canvas"]').element),
        ).toEqual(liveRoot);
        expect(structure(frameOf(preview.wrapper.element))).toEqual(liveTree);
        expect(liveOutside).toEqual([]);
        expect(preview.outside()).toEqual(liveOutside);
        prints[skin] = liveTree;
        preview.wrapper.unmount();
      }
      // Die Selbstsicherung des Skin-Vergleichs: drei Faelle, drei Flaechen.
      expect(prints.ionic).not.toEqual(prints.terminal);
      expect(prints.ionic).not.toEqual(prints.edomi);
      expect(prints.terminal).not.toEqual(prints.edomi);
    });

    /**
     * Der Zaun ausserhalb des Rahmens - und die Gegenprobe dazu. Ein
     * `<Teleport to="body">` haengt neben dem `ion-page`, genau dort, wo in der
     * echten App auch Ionics Overlays landen; der Abdruck begann und endete
     * frueher am Rahmen, ein sichtbares Banner am `<body>` blieb also
     * unsichtbar (Kritik R4, Probe N3). Dass der Zaun jetzt nicht nur deshalb
     * leer ist, weil er nicht hinsieht, zeigt die zweite Haelfte dieses Tests:
     * ein angehaengter Knoten MUSS im Abdruck auftauchen.
     */
    it('sieht auch, was neben dem Rahmen am <body> haengt', async () => {
      const before = Array.from(document.body.children);
      const preview = await mountPreview('ionic', 'overview');
      const frame = frameOf(preview.wrapper.element);
      expect(outsideFrame(before, frame)).toEqual([]);

      const probe = document.createElement('div');
      probe.className = 'zaun-probe';
      probe.textContent = 'Entwurfsvorschau';
      document.body.appendChild(probe);
      try {
        expect(outsideFrame(before, frame)).toEqual([
          '@body/0 | div | zaun-probe |  |  | Entwurfsvorschau',
        ]);
      } finally {
        probe.remove();
      }
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

      // Und A2 ENG: ausser Rahmen und Wurzel traegt kein Element im Rahmen einen
      // Vorschau-Marker. Frueher nahm der Abdruck die Marker an JEDEM Element
      // mit JEDEM Wert aus - zwei zusaetzliche Marker am Raster blieben so
      // unsichtbar (Kritik R4, Probe N7).
      expect(
        Array.from(
          page.querySelectorAll(
            '[data-preview-page], [data-preview-state], [data-testid="preview-canvas"]',
          ),
        ).map(signature),
      ).toEqual([signature(canvas)]);
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
   * DER STILBLOCK BEIDER SEITEN - die eine Stelle, an der die Vorschau Regeln
   * der echten Seite WIEDERHOLEN muss. `<style scoped>` traegt den
   * `data-v-*`-Marker genau eines SFC, eine Regel laesst sich also nicht teilen;
   * `.preview-page` ist deshalb eine Kopie von `.skin-page`.
   *
   * Frueher war die Klammer an ZWEI Selektoren genagelt, und alles daneben war
   * frei: eine zweite `.preview-page`-Regel im selben Block gewann in der
   * Kaskade und blieb gruen, ein `@media`-Override und eine `:deep()`-Regel
   * ebenso, ein eigenes Vorschau-Stylesheet ebenso (Kritik R4, N1/N2/N9).
   * Verglichen wird deshalb jetzt der GANZE Block - und dazu, was der
   * Vorschau-Chunk sonst noch an Stil mitbringen koennte.
   *
   * GRENZE, ausdruecklich: das ist ein QUELLTEXT-Vergleich. Ein jsdom-Lauf
   * rechnet keine Stylesheets aus (der Test darunter haelt genau das fest);
   * berechnete Stile aus globalen Blaettern und Pseudo-Elemente sind hier
   * grundsaetzlich nicht messbar. Die Pixel misst Teil E als Szenario E3
   * (Pixel-Diff im echten Browser). Diese Probe ersetzt ihn nicht.
   */
  describe('der Stilblock beider Seiten', () => {
    it('haelt JEDE Regel der Vorschau gegen die echte Seite, nicht zwei Selektoren', () => {
      const live = ruleSet(SKIN_PAGE_REL);
      const preview = ruleSet(PREVIEW_PAGE_REL);

      // Selbstsicherung 1: die Regelmenge beider Bloecke steht hier
      // ausgeschrieben. Eine zusaetzliche Regel - auch eine zweite mit
      // demselben Selektor, auch eine in `@media`, auch eine mit `:deep()`,
      // auch ein `@import` - faellt schon an diesen zwei Zeilen auf.
      expect(live.map((r) => `${r.at}|${r.selector}`).sort()).toEqual([
        '|.overview-root',
        '|.overview-tweaks-toggle',
        '|.skin-page',
      ]);
      expect(preview.map((r) => `${r.at}|${r.selector}`).sort()).toEqual([
        '|.overview-root',
        '|.preview-hint',
        '|.preview-page',
      ]);

      // Selbstsicherung 2: die Live-Regeln, gegen die verglichen wird, sind
      // nicht leer - eine ausgeraeumte Regel darf nicht zur Messlatte werden.
      const liveShared = live.filter((r) => !LIVE_ONLY_RULES.includes(r.selector));
      expect(liveShared.map(ruleKey).sort()).toEqual([
        '.overview-root { display: block }',
        '.skin-page { contain: layout style; position: relative }',
      ]);

      // Und der Vergleich selbst: jede Vorschau-Regel auf ihren Live-Namen
      // gebracht (A5), die benannte Ausnahme A6 abgezogen - der Rest muss
      // Regel fuer Regel und Deklaration fuer Deklaration passen.
      expect(
        preview
          .filter((r) => !PREVIEW_ONLY_RULES.includes(r.selector))
          .map((r) => ruleKey({ ...r, selector: normalizeSelector(toLiveNames(r.selector)) }))
          .sort(),
      ).toEqual(liveShared.map(ruleKey).sort());

      // Die eine Vorschau-eigene Regel, ausgeschrieben statt bloss benannt: sie
      // faerbt den Platzhalter VOR dem ersten Entwurf und ist aus dem DOM,
      // sobald verglichen wird.
      expect(
        preview.filter((r) => r.selector === '.preview-hint').map(ruleKey),
      ).toEqual([
        '.preview-hint { color: var(--ion-text-color, #1b2027); font: inherit;' +
          ' margin: var(--obs-space, 12px); opacity: 0.7 }',
      ]);
    });

    it('haelt auch bei anderer Formatierung, solange kein Pixel wandert', () => {
      // Der Vergleich darf nicht an Leerraum haengen: ein Prettier-Lauf mit
      // anderer Konfiguration bewegt keinen Pixel (Kritik R4, Probe F1).
      expect(parseRules('.a{position:relative;contain:layout style}')).toEqual(
        parseRules('.a {\n  contain: layout style;\n  position:   relative;\n}'),
      );
      // Umbenennen dagegen faellt auf - der Selektor steht im Vergleich.
      expect(parseRules('.a{color:red}')).not.toEqual(parseRules('.b{color:red}'));
      // Und eine zweite Regel mit demselben Selektor bleibt eine zweite Regel.
      expect(parseRules('.a{color:red}.a{color:blue}')).toHaveLength(2);
      // Ein `@media`-Kontext ist Teil der Regel, keine Kopie der Grundregel.
      expect(parseRules('@media (min-width:1px){.a{color:red}}')[0].at).toBe(
        '@media (min-width:1px)',
      );
    });

    it('bringt seinen Stil nur aus diesem einen Block - kein zweites Blatt', () => {
      // N1 war ein eigenes `preview-frame.css` im Vorschau-Chunk: dieselbe
      // Abweichung, nur ausserhalb des Blocks geschrieben.
      expect(previewStyleArtifacts()).toEqual(['PreviewPage.vue <style scoped>']);

      const foreign = foreignPreviewStyles();
      // Gegenprobe: der Scanner liest ueberhaupt Dateien.
      expect(foreign.scanned).toBeGreaterThan(10);
      expect(foreign.hits).toEqual([]);
    });

    /**
     * Und die Grenze als Test statt als Fussnote. Diese Zusicherung DARF nicht
     * gruen werden, indem jemand jsdom CSS beibringt - sie haelt fest, warum es
     * den Quelltextvergleich oben ueberhaupt gibt: der Mount sieht den Stilblock
     * nicht. Wer daraus eine Pixelaussage macht, behauptet mehr, als hier
     * gemessen wird; die Pixel faehrt Teil E als Szenario E3.
     */
    it('misst KEINE berechneten Stile - das leistet erst der Pixel-Diff (Teil E, E3)', async () => {
      const preview = await mountPreview('ionic', 'overview');
      const frame = frameOf(preview.wrapper.element) as HTMLElement;
      // `.preview-page { position: relative }` steht im `<style scoped>` - und
      // wirkt hier nachweislich nicht: der Block erreicht das Dokument nie.
      expect(ruleSet(PREVIEW_PAGE_REL).some((r) => r.selector === '.preview-page')).toBe(true);
      expect(window.getComputedStyle(frame).position).not.toBe('relative');
      // Pseudo-Elemente leben ausschliesslich im Stylesheet: hier ist nichts da.
      expect(window.getComputedStyle(frame, '::before').content).toBeFalsy();
    });
  });
});
