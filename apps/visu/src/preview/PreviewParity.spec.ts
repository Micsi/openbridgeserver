import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, reactive } from 'vue';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
 *   - die Stilquellen  - und daneben dieselbe Frage in WIRKUNG statt in
 *                        Quellen: welcher gelesene Selektor greift am Ende in
 *                        der Vorschau und nicht auf der echten Seite? Gelesen
 *                        werden alle Stylesheets und alle `<style>`-Bloecke
 *                        (ein- wie mehrzeilig) unter `apps/visu` und
 *                        `packages` UND die drei per `link:` eingebundenen
 *                        Skin-Pakete, jeweils samt ihrer `@import`-Kette;
 *                        gehalten wird jeder Selektor - und jedes seiner
 *                        GLIEDER - gegen ZWEI gemeinsame Boeden (die volle und
 *                        die leere Seite) und dazu gegen die zwei Zustaende,
 *                        die nur die VORSCHAU hat (`waiting`, `unknown-skin`)
 *   - der Rand         - der Zustand des DOKUMENTS neben dem Rahmen, an zwei
 *                        Messzeitpunkten aufgenommen: `<html>` und `<body>`
 *                        selbst, jeder Knoten in `<head>` und `<body>`, jede
 *                        Stilquelle im Testdokument - beim Mount UND nach einer
 *                        Interaktion, und in beide Richtungen (dazugekommen,
 *                        geaendert, entfernt); und dazu, weil ein Unterschied
 *                        immer nur gegen eine Aufnahme misst, der BESTAND
 *                        absolut: `<head>` und `<body>` tragen keinen Knoten,
 *                        auch keinen, der schon beim Laden der Module kam
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
 *
 * ══ AN TEIL E (Szenario E3) UEBERGEBEN ══════════════════════════════════════
 *
 * ZWEI Abweichungen bleiben hier ungemessen, weil ein jsdom-Lauf sie nicht
 * entscheiden KANN - er hat keinen Viewport und rechnet kein CSS aus. Sie sind
 * nicht vergessen und nicht wegdefiniert, sondern uebergeben; Teil E misst sie
 * im Pixel-Diff im echten Browser:
 *
 *   E3-1  DER VIEWPORT-ANTEIL groessenabhaengiger Regeln. Ob eine Regel unter
 *         `@media (max-width:…)` oder `@container (width …)` greift, haengt an
 *         der Breite der Flaeche - und die Vorschau ist ein schmales `<iframe>`
 *         (`w-full h-[70vh]` in einer Editorspalte,
 *         `gui/src/components/visu/VisuPreviewFrame.vue`), die echte Seite
 *         fuellt den Bildschirm. Genauer: der terminal-Skin baut sein Raster
 *         ueber `@container` an einer 700-px-Schwelle um, und der Container ist
 *         `.t-root` (`container-type: inline-size`) - es entscheidet also die
 *         Breite der Skin-Wurzel, nicht die des Viewports; der Rahmen bestimmt
 *         sie. Der Test unten MELDET jeden solchen Selektor namentlich (heute
 *         acht aus dem terminal-Skin) und schreibt ihn aus; ENTSCHEIDEN, ob er
 *         ein Pixel bewegt, kann nur der Pixel-Diff.
 *
 *   E3-3  JEDE AENDERUNG AN DEN DEKLARATIONEN eines ausgelieferten Blattes.
 *         `inset: 0` -> `inset: 40%` in `link-affordance.css` bewegt Pixel auf
 *         beiden Seiten und ist hier unsichtbar: der Wirkungsvergleich misst,
 *         welcher SELEKTOR wo greift, nicht welche Deklaration am Ende gewinnt
 *         und wie sie aussieht - jsdom rechnet kein CSS aus. Der Test "misst
 *         KEINE berechneten Stile" haelt genau diese Grenze fest.
 *
 * NICHT MEHR UEBERGEBEN: der RAHMEN um die Vorschau (frueher E3-2). `transform`,
 * `filter`, `zoom` oder eine Utility-Klasse (`scale-90 saturate-50`) am
 * `<iframe>` in `gui/` sind kein Stil dieser Seite, und diese Spec liest `gui/`
 * nicht - aber das war eine Testluecke und keine Grenze von jsdom: sie ist in
 * `gui/tests/components/visu/VisuPreviewFrame.spec.js` geschlossen, wo die
 * Klassenliste und das `style`-Attribut des Rahmens gepinnt sind. Beim
 * Pixel-Diff bleibt davon nur, was ein anderes Blatt zur Laufzeit auf diese
 * Klassen legt.
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
 * DER ZWEITE PARITAETSBODEN - die LEERE Seite und die NICHT ABGEBILDETE Kachel.
 *
 * Genau diese zwei Zustaende der SkinHost-Kette, nicht „alles, was der erste
 * nicht rendert": die Zustaende, die nur die VORSCHAU hat (`waiting`,
 * `unknown-skin` - also `<p class="preview-hint">`), rendert auch dieser Boden
 * nicht. Sie haben einen eigenen Fall, weil sie kein Gegenstueck auf der
 * Live-Seite haben und deshalb kein Boden fuer BEIDE Seiten sein koennen (der
 * Test „haelt jeden gelesenen Selektor auch gegen die vorschau-EIGENEN
 * Zustaende"; Kritik R7, N2).
 *
 * Der erste Boden ist eine volle Seite: drei Widgets, Kacheln, ein aktiver
 * Seitenlink. Was er NICHT zeigt, ist die leere Seite und die Seite, auf der der
 * Autor etwas abgelegt hat, das die Kette nicht rendert - und ein Vergleich ist
 * nur so breit wie der Boden, den er rendert: eine vorschau-eigene Regel auf ein
 * Element, das der eine Boden nicht kennt, „trifft auf beiden Seiten gleich oft:
 * null" und galt damit als gleich (Kritik R6, T6a).
 *
 * Dieser Boden deckt beide Zustaende in einem: die gezeigte Seite traegt zwei
 * Widgets von Typen, die `mapTree` bewusst NICHT abbildet (`Kamera`,
 * `ValueDisplay` - #124), also kommt kein Geraet und kein Layer-Item heraus. Der
 * Autor sieht eine Seite, auf der etwas liegt und nichts erscheint; beide
 * Seiten muessen dieselbe leere Flaeche zeigen. Die uebrigen Seiten des Baums
 * bleiben voll, damit Nav-Baum und Linknamen dieselben sind wie oben.
 *
 * GRENZE, ausdruecklich: `.skin-host-unsupported` (eine im Manifest ERKLAERT
 * nicht unterstuetzte Kachel) und `.skin-host-missing` (ein Layer-Item ohne
 * Geraet) sind mit den drei ausgelieferten Skins auf KEINEM Boden erreichbar -
 * kein Manifest fuehrt `unsupported`, und ein nicht abgebildetes Widget kommt
 * gar nicht erst in einen Layer. Eine Regel auf diese Elemente faellt deshalb
 * nicht am Rendern auf, sondern am Glied-Vergleich ({@link selectorLinks}).
 */
const unrenderedWidgets = (pageId: string) => [
  {
    id: `${pageId}-cam`,
    name: 'Hofkamera',
    type: 'Kamera',
    datapoint_id: null,
    status_datapoint_id: null,
    config: { url: '/cam/hof.jpg' },
    x: 0,
    y: 0,
    w: 4,
    h: 3,
  },
  {
    id: `${pageId}-value`,
    name: 'Zaehlerstand',
    type: 'ValueDisplay',
    datapoint_id: `dp-${pageId}-value`,
    status_datapoint_id: null,
    config: {},
    x: 4,
    y: 0,
    w: 2,
    h: 1,
  },
];

// Die Uebersicht zeigt die Geraete ALLER Seiten nach Raum gruppiert - leer ist
// sie deshalb erst, wenn keine Seite ein abbildbares Widget traegt.
const EMPTY_FLOOR_NODES: readonly PreviewDraftNode[] = DRAFT_NODES.map((n) => ({
  ...n,
  page_config: { widgets: unrenderedWidgets(n.id) },
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

/* ------------------------------------------------------------- der Rand */

/**
 * DER RAND DER SEITE - und zwar in WIRKUNG gemessen, nicht in Quellen gesucht.
 *
 * Der Vorgaenger war ein Schnappschuss EINER Kinderliste: was beim Mount neu an
 * `document.body` kam. Vier Wege liefen daran vorbei, jeder einzeln sichtbar
 * und jeder nur in der Vorschau (Kritik R5, S3-S5): ein `<style>`, das zur
 * Laufzeit in den `<head>` gehaengt wird; `document.body.style.padding`, weil
 * das `<body>`-Element selbst nie abgedruckt wurde (im echten Vorschau-iframe
 * IST der `<body>` die Seite); eine Aenderung an einem schon vorhandenen Kind;
 * und ein Knoten, der erst NACH einer Interaktion entsteht.
 *
 * AUFGENOMMEN wird der Zustand des Dokuments zum Messzeitpunkt:
 *
 *   - `<html>` und `<body>` selbst, mit allen Attributen und ihrem Stil,
 *   - jeder Knoten in `<head>` UND `<body>` (ohne den verglichenen Rahmen, der
 *     oben Element fuer Element gehalten wird),
 *   - jede Stilquelle im Testdokument ({@link documentStyleSources}).
 *
 * VERGLICHEN wird davon der UNTERSCHIED zu einer Aufnahme von vor dem Mount -
 * was dazukam, was sich aenderte und was verschwand ({@link edgeSince}) -, damit
 * Reste frueherer Mounts im selben Lauf nicht als Rand der Seite gelten. Und
 * gemessen wird an zwei Zeitpunkten: direkt nach dem Mount und noch einmal nach
 * einer Interaktion; was zwischen ihnen entsteht und wieder vergeht, sieht diese
 * Aufnahme nicht.
 *
 * GRENZE: ein echtes Ionic-Overlay ist hier strukturell nicht messbar -
 * `IonModal`/`IonPopover` sind auf durchreichende Tags gestubbt (oben), sie
 * teleportieren also nie an den `<body>`. Was dieser Zaun misst, ist, was die
 * Seite an den zwei Messzeitpunkten am Dokument stehen hat; das Verhalten der
 * echten Ionic-Overlays gehoert zu Teil E.
 */
type DocEdge = {
  html: string;
  body: string;
  nodes: Map<Element, string>;
  styles: string[];
};

/**
 * Die Stilquellen, die im TESTDOKUMENT haengen - gezaehlt, nicht gesucht: jedes
 * `<style>` und jedes `<link rel=stylesheet>`, im `<head>` wie im `<body>`, samt
 * der Zahl der Blaetter im CSSOM (was ohne eigenes Element eingehaengt wurde,
 * faellt an ihr auf).
 *
 * Nicht „alles, was wirkt": in jsdom WIRKT keine dieser Quellen, es wird kein
 * CSS ausgerechnet. Gelesen wird ausschliesslich das Dokument dieses Laufs -
 * was ein Bundler spaeter in die ausgelieferte Seite haengt, misst der
 * Wirkungsvergleich weiter unten, und die Pixel misst Teil E (E3).
 */
function documentStyleSources(): string[] {
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll('style, link'))) {
    const tag = el.tagName.toLowerCase();
    const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (tag === 'link' && !rel.includes('stylesheet')) continue;
    const where = document.head.contains(el) ? 'head' : 'body';
    const what =
      tag === 'link'
        ? (el.getAttribute('href') ?? '')
        : (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    out.push(`${where} <${tag}> ${what}`);
  }
  const adopted = (document as unknown as { adoptedStyleSheets?: readonly unknown[] })
    .adoptedStyleSheets;
  out.push(`CSSOM: ${document.styleSheets.length} Blatt, ${adopted?.length ?? 0} adoptiert`);
  return out;
}

/**
 * JEDER Knoten in `<head>` und `<body>`, ausgeschrieben - und zwar ABSOLUT,
 * nicht als Unterschied gegen eine Aufnahme.
 *
 * Warum es das neben {@link edgeSince} braucht: jeder Unterschied misst gegen
 * eine Aufnahme, und die frueheste, die dieser Lauf hat
 * ({@link DOCUMENT_AT_IMPORT}), entsteht im Modulrumpf - also NACH den
 * statischen Importen von `SkinPage.vue` und `PreviewPage.vue`, denn ESM wertet
 * jeden Import vollstaendig vor dem Rumpf aus. Ein `div.obs-preview-banner`,
 * das ein Vorschau-Modul beim Laden an den `<body>` haengt und BEHAELT, steht
 * damit schon in der fruehesten Aufnahme und ist in allen drei Richtungen von
 * `edgeSince` unsichtbar (Kritik R7, N3). Die absoluten Zusicherungen daneben
 * decken ihn auch nicht: die pinnen `<html>`, `<body>` und die Stilquellen -
 * ein beim Laden eingehaengtes `<style>` faellt an {@link documentStyleSources}
 * auf, ein eingehaengter KNOTEN an keiner von beiden. Der Fall ist alltaeglich:
 * ein Toast-Container, ein Splash-Overlay, ein Debug-Banner.
 *
 * Deshalb steht hier der BESTAND: was in `<head>` und `<body>` haengt, ist im
 * Test Zeile fuer Zeile ausgeschrieben und heute leer ({@link LEERES_DOKUMENT})
 * - unabhaengig davon, WANN es dorthin kam. Der verglichene Rahmen taucht darin
 * nicht auf: Vue Test Utils spannt den Mount in einem losgeloesten Knoten auf,
 * er haengt also gar nicht am Dokument (dass das so ist, haelt derselbe Test
 * fest - stuende er im Dokument, waere diese Liste nicht leer).
 */
function documentNodes(): string[] {
  const out: string[] = [];
  const walk = (parent: Element, where: string): void => {
    for (const child of Array.from(parent.children)) {
      out.push(printElement(child, where));
      walk(child, where);
    }
  };
  walk(document.head, '@head');
  walk(document.body, '@body');
  return out;
}

/** Eine Aufnahme des Dokumentrandes - `frame` und sein Baum bleiben aussen vor. */
function edgeSnapshot(frame: Element | null = null): DocEdge {
  const nodes = new Map<Element, string>();
  const walk = (parent: Element, where: string): void => {
    for (const child of Array.from(parent.children)) {
      if (child === frame) continue;
      nodes.set(child, printElement(child, where));
      walk(child, where);
    }
  };
  walk(document.head, '@head');
  walk(document.body, '@body');
  return {
    html: printElement(document.documentElement, '@html'),
    body: printElement(document.body, '@body'),
    nodes,
    styles: documentStyleSources(),
  };
}

/**
 * Der UNTERSCHIED des Randes gegen `before` - in beide Richtungen: was
 * dazugekommen ist, was sich geaendert hat UND was verschwunden ist. Der
 * Weg-Zweig fuer Knoten fehlte, und genau dort lief ein Angriff durch: eine
 * Seite, die beim Modulladen ein `div.obs-splash` an den `<body>` haengt und es
 * in `onMounted` wieder ENTFERNT, nahm dem Dokument einen Knoten, ohne dass der
 * Vergleich etwas meldete (Kritik R6, T4). Im echten Vorschau-iframe ist genau
 * das sichtbar: ein entferntes `<meta name="viewport">` ist ein anderer Massstab.
 *
 * Was hier NICHT steht: ein Knoten, den die Seite anlegt und vor der Messung
 * selbst wieder wegnimmt, hinterlaesst keine Spur - gemessen wird der Zustand zu
 * den zwei Messzeitpunkten (Mount, Interaktion), nicht jeder Zwischenschritt.
 */
function edgeSince(before: DocEdge, frame: Element | null): string[] {
  const now = edgeSnapshot(frame);
  const out: string[] = [];
  if (now.html !== before.html) out.push(`geaendert ${before.html} -> ${now.html}`);
  if (now.body !== before.body) out.push(`geaendert ${before.body} -> ${now.body}`);
  const wasStyle = [...before.styles];
  for (const src of now.styles) {
    const i = wasStyle.indexOf(src);
    if (i < 0) out.push(`neue Stilquelle: ${src}`);
    else wasStyle.splice(i, 1);
  }
  for (const src of wasStyle) out.push(`Stilquelle weg: ${src}`);
  for (const [el, print] of now.nodes) {
    const was = before.nodes.get(el);
    if (was === undefined) out.push(`neu ${print}`);
    else if (was !== print) out.push(`geaendert ${was} -> ${print}`);
  }
  // Und die Gegenrichtung: ein Knoten, der vor der Aufnahme im Dokument stand
  // und jetzt nicht mehr. `frame` bleibt aussen vor - der Rahmen selbst wird
  // Element fuer Element verglichen, nicht am Rand gezaehlt.
  for (const [el, print] of before.nodes) {
    if (el === frame || frame?.contains(el) === true) continue;
    if (!now.nodes.has(el)) out.push(`Knoten weg: ${print}`);
  }
  return out;
}

/**
 * Was eine Seite am Rand des Dokuments aendern darf: NICHTS. Vue Test Utils
 * rendert in einen losgeloesten Knoten, der Mount selbst haengt also nichts an
 * `<html>`, `<head>` oder `<body>` - was dort auftaucht, kommt von der Seite.
 * Der leere Rand steht in den Tests ausgeschrieben, damit „beide gleich" nicht
 * „beide blind" heissen kann; die Gegenproben unten zeigen fuenf Wege, auf
 * denen er sich fuellt.
 */
const RUHIGER_RAND: readonly string[] = [];

/**
 * Und derselbe Rand ABSOLUT statt als Unterschied: `<head>` und `<body>` tragen
 * ueberhaupt keinen Knoten (s. {@link documentNodes}). Diese Liste ist der Zaun
 * gegen alles, was VOR jeder Aufnahme entsteht und bleibt - ein Knoten, den ein
 * Modul beim Laden anhaengt, steht in keinem Unterschied, aber hier.
 */
const LEERES_DOKUMENT: readonly string[] = [];

/**
 * Das Dokument, wie dieser Lauf es beim LADEN DER MODULE vorfindet - aufgenommen
 * im Modulrumpf, also nach allen `import`s und vor jedem Mount.
 *
 * Warum es diese zweite, frueheste Aufnahme gibt: alles andere hier vergleicht
 * gegen einen Stand, der VOR einem Mount, aber NACH dem Laden genommen wurde.
 * Was ein Modul schon beim Laden tut, liegt davor - und wenn es beim ersten
 * Mount rueckgaengig gemacht wird, faellt es in keinem Unterschied mehr auf. Ein
 * `div.obs-splash`, das beim Modulladen an den `<body>` kommt und in `onMounted`
 * wieder verschwindet, ging genau so durch (Kritik R6, T4): im echten
 * Vorschau-`<iframe>` nimmt so eine Seite dem Dokument einen Knoten weg - ein
 * entferntes `<meta name="viewport">` ist dort ein anderer Massstab.
 *
 * WAS DIESE AUFNAHME NICHT SIEHT, ausdruecklich: sich selbst. Sie faellt im
 * Modulrumpf, also NACH den statischen Importen dieser Datei (`SkinPage.vue`,
 * `PreviewPage.vue`) - was ein Vorschau-Modul beim Laden anhaengt und BEHAELT,
 * steht bereits in ihr und ist in allen drei Richtungen von {@link edgeSince}
 * unsichtbar (Kritik R7, N3). Dieser Fall haengt deshalb nicht an dieser
 * Aufnahme, sondern am absoluten Bestand ({@link documentNodes} gegen
 * {@link LEERES_DOKUMENT}), der die Importreihenfolge gar nicht kennt.
 */
const DOCUMENT_AT_IMPORT: DocEdge = edgeSnapshot();

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

/**
 * WIE VIELE ZELLEN ueberhaupt eine Platzierung TRAGEN - nicht, ob die Werte
 * stimmen. Der ganze `style`-Block der Zelle (`SkinHost.renderCell`) auf `{}`
 * gesetzt nimmt beiden Seiten gleichzeitig die absolute Platzierung aus der
 * Autorenbox, die Rasterspanne, die Aktiv-Markierung und den Zeiger - und der
 * Vergleich blieb 79 von 79 gruen (Kritik R5, Probe B4); an diesen Zahlen faellt
 * er auf. Gezaehlt wird ANWESENHEIT: „Rasterspanne: 15" heisst „15 Zellen tragen
 * ueberhaupt eine `grid-column`-Spanne", nicht „die Spannen stimmen"; `grid-row`
 * wird gar nicht gezaehlt, und auf diesem Boden ist jede Spanne 1 und
 * `absolutPlatziert` bei allen drei Skins 0 (Kritik R6 §3). Ob die Zahlen selbst
 * richtig sind, haelt der Element-fuer-Element-Vergleich darueber; ob sie
 * Pixel ergeben, misst Teil E (E3).
 */
function placementFacts(tree: string[]): Record<string, number> {
  const isCell = (l: string): boolean => l.split(' | ')[2].split('.').includes('skin-host-cell');
  const styleOf = (l: string): string => l.split(' | ')[4] ?? '';
  const cells = tree.filter(isCell);
  const count = (re: RegExp): number => cells.filter((l) => re.test(styleOf(l))).length;
  return {
    Zellen: cells.length,
    Rasterspanne: count(/(^|; )grid-column:span \d/),
    absolutPlatziert: count(/(^|; )position:absolute/),
    Zeiger: count(/(^|; )cursor:pointer/),
    Bezugsrahmen: count(/(^|; )position:relative/),
  };
}

/**
 * DIE FARBE einer Flaeche - die dritte Haelfte. `SkinHost.renderCell` rechnet
 * die Tokens jeder Kachel aus dem Thema des Autors und dem Akzent des Geraets
 * (`makeTokens(props.theme, device.accent)`); auf `makeTokens('light',
 * 'neutral')` festgenagelt rendern BEIDE Seiten mit hellem Standardton, und der
 * ganze Lauf blieb gruen (Kritik R5, Probe B5) - obwohl die Szenarien unten
 * nach genau diesen Einstellungen benannt sind. Gezaehlt wird deshalb jeder
 * Farbwert, den der Kachelinhalt selbst traegt.
 */
/**
 * Was jeder Skin platziert - ausgeschrieben, weil die drei es verschieden tun:
 * ionic gibt jeder Zelle ihre Rasterspanne, terminal legt eine flache Liste
 * ohne Platzierung (nur der Seitenlink bekommt seinen Zeiger), und edomi
 * zeichnet seine Seite selbst aus dem Layerstapel, also platziert dort der
 * Skin und nicht der Host. Ein Skin, der ploetzlich nichts mehr platziert,
 * faellt an diesen Zahlen auf.
 */
const PLACEMENT_BY_SKIN: Record<string, Record<string, number>> = {
  ionic: { Zellen: 15, Rasterspanne: 15, absolutPlatziert: 0, Zeiger: 5, Bezugsrahmen: 5 },
  terminal: { Zellen: 15, Rasterspanne: 0, absolutPlatziert: 0, Zeiger: 5, Bezugsrahmen: 0 },
  edomi: { Zellen: 3, Rasterspanne: 0, absolutPlatziert: 0, Zeiger: 0, Bezugsrahmen: 0 },
};

function paintFacts(tree: string[]): string[] {
  const out = new Set<string>();
  for (const line of tree) {
    for (const decl of (line.split(' | ')[4] ?? '').split('; ')) {
      if (/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(decl)) out.add(decl);
    }
  }
  return [...out].sort();
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
 * CSS in seine drei Sorten zerlegt: Code, Zeichenkette, Kommentar. JEDE
 * Normalisierung unten arbeitet auf diesem Schnitt, und das ist der Grund
 * dafuer: ausserhalb einer Zeichenkette darf Leerraum zusammengezogen und
 * Schreibweise vereinheitlicht werden, INNERHALB nicht - `content: "a  b"` und
 * `content: "a b"` sind zwei verschiedene Texte, und `grid-template-areas`
 * traegt sein ganzes Layout in genau diesen Leerzeichen. Aus demselben Grund
 * darf auch die Struktursuche (`{`, `}`, `;`, `,`) nicht auf den rohen Text
 * schauen: eine Klammer in einer Zeichenkette ist keine Klammer.
 *
 * Was der Scanner nicht lesen kann, WIRFT: eine Zeichenkette oder ein Kommentar
 * ohne Ende bekommt eine Fehlermeldung, statt still den halben Block zu
 * verschlucken.
 */
type CssPart = { text: string; kind: 'code' | 'string' | 'comment' };

function cssParts(text: string): CssPart[] {
  const out: CssPart[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf.length > 0) out.push({ text: buf, kind: 'code' });
    buf = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`CSS-Kommentar ohne Ende: "${text.slice(i, i + 24)}"`);
      flush();
      out.push({ text: text.slice(i, end + 2), kind: 'comment' });
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let str = ch;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\') {
          str += text.slice(j, j + 2);
          j += 2;
          continue;
        }
        str += text[j];
        j += 1;
        if (str[str.length - 1] === ch) {
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error(`CSS-Zeichenkette ohne Ende: ${str.slice(0, 24)}`);
      flush();
      out.push({ text: str, kind: 'string' });
      i = j;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Leerraum zusammenziehen - aber nur ausserhalb von Zeichenketten. */
const squeeze = (text: string): string =>
  cssParts(text)
    .map((p) => (p.kind === 'code' ? p.text.replace(/\s+/g, ' ') : p.text))
    .join('');

/** Kommentare weg, Zeichenketten unangetastet. */
const stripComments = (css: string): string =>
  cssParts(css)
    .map((p) => (p.kind === 'comment' ? ' ' : p.text))
    .join('');

/**
 * Derselbe Text, aber mit ausgeblendeten Zeichenketten (gleiche Laenge, damit
 * die Stellen aufeinanderliegen). Darauf sucht der Parser seine Klammern.
 */
const cssMask = (css: string): string =>
  cssParts(css)
    .map((p) => (p.kind === 'string' ? ' '.repeat(p.text.length) : p.text))
    .join('');

/** An `sep` teilen - nicht in Zeichenketten und nicht in Klammern. */
function splitOutside(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const part of cssParts(text)) {
    if (part.kind !== 'code') {
      cur += part.text;
      continue;
    }
    for (const ch of part.text) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === sep && depth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Der erste Doppelpunkt ausserhalb einer Zeichenkette. */
function colonOutside(decl: string): number {
  let at = 0;
  for (const part of cssParts(decl)) {
    if (part.kind === 'code') {
      const i = part.text.indexOf(':');
      if (i >= 0) return at + i;
    }
    at += part.text.length;
  }
  return -1;
}

/**
 * CSS-Escapes auf EINE Form gebracht. `.preview\2Dpage` und `.preview-page`
 * sind buchstabengleiches CSS ohne einen bewegten Pixel, machten den Vergleich
 * aber falsch rot (Kritik R5, Probe Q6).
 *
 * Aufgeloest wird nur, was danach ohne Escape dasselbe bedeutet: ein Zeichen,
 * das in einem Bezeichner stehen darf. Alles andere bleibt escaped - sonst
 * wuerde aus `.foo\.bar` (EINE Klasse mit einem Punkt im Namen) der ganz
 * andere Selektor `.foo.bar`, und der Vergleich liesse eine echte Abweichung
 * durch.
 */
function decodeEscapes(text: string): string {
  return text.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([\s\S]))/g, (_m, hex: string, raw: string) => {
    const ch = hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : raw;
    return /^[A-Za-z0-9_-]$/.test(ch) || ch.codePointAt(0)! > 0x7f ? ch : `\\${ch}`;
  });
}

/**
 * Selektor normalisiert: Leerraum zusammengezogen (nicht in Zeichenketten),
 * Escapes aufgeloest, Kombinatoren mit festem Abstand, Selektorlisten sortiert.
 * Damit faellt eine Regel nicht wegen der Formatierung auf, sondern nur, wenn
 * sie wirklich eine andere ist.
 */
function normalizeSelector(raw: string): string {
  return splitOutside(squeeze(raw).trim(), ',')
    .map((part) => decodeEscapes(part.trim()).replace(/\s*([>+~])(?!=)\s*/g, ' $1 '))
    .filter(Boolean)
    .sort()
    .join(', ');
}

/**
 * Einen Wert klein schreiben - aber nur dort, wo CSS ihn ohnehin
 * gross/klein-unempfindlich liest. AUSGENOMMEN bleiben drei Stellen, weil sie
 * es nicht sind:
 *
 *   - Zeichenketten (`content: "Aus"`),
 *   - `url(...)` (ein Pfad ist gross/klein-empfindlich),
 *   - Custom-Property-NAMEN (`var(--Gap)` ist eine andere Variable als
 *     `var(--gap)`).
 *
 * Die vierte Stelle steht nicht hier, sondern in {@link CASE_SENSITIVE_VALUES}:
 * Eigenschaften, deren WERT ein selbstgewaehlter Bezeichner ist
 * (`animation-name: Slide`, `counter-reset: Foo`, `grid-area: Header`). Sie
 * gingen frueher durch diese Funktion und galten damit als gleich, obwohl CSS
 * sie gross/klein-empfindlich liest (Kritik R6 §4).
 */
const lowerValue = (value: string): string =>
  cssParts(value)
    .map((p) =>
      p.kind === 'code'
        ? p.text.replace(/url\([^)]*\)|--[\w-]+|[\s\S]/g, (m) => (m.length > 1 ? m : m.toLowerCase()))
        : p.text,
    )
    .join('');

/**
 * Eigenschaften, deren Wert ein SELBSTGEWAEHLTER BEZEICHNER ist und die CSS
 * darum gross/klein-empfindlich liest: eine Animation namens `Slide` ist nicht
 * `slide`, ein Zaehler `Foo` nicht `foo`, ein Rasterbereich `Header` nicht
 * `header`. Ihr Wert bleibt deshalb stehen, wie er dasteht - er laeuft nicht
 * durch {@link lowerValue}. Vorher ebnete die Normalisierung genau diese Klasse
 * ein (Kritik R6 §4); die Gegenproben dazu stehen im Test „zaehlt gleiche
 * Wirkung gleich - und andere Wirkung nicht".
 *
 * Die Kurzschreibweisen stehen mit drin, weil sie den Namen enthalten
 * (`animation: 2s Slide`, `grid-row: Header / Footer`).
 */
const CASE_SENSITIVE_VALUES: ReadonlySet<string> = new Set([
  'animation',
  'animation-name',
  'counter-increment',
  'counter-reset',
  'counter-set',
  'grid',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'grid-template',
  'grid-template-areas',
  'container-name',
  'view-transition-name',
  'anchor-name',
  'position-anchor',
  'timeline-scope',
  'scroll-timeline',
  'scroll-timeline-name',
  'view-timeline',
  'view-timeline-name',
  'animation-timeline',
  'will-change',
]);

/**
 * Deklarationen normalisiert: Eigenschaft klein, GENAU ein Leerzeichen nach dem
 * Doppelpunkt, Wert klein (s. {@link lowerValue}), sortiert. Ohne den
 * Doppelpunkt-Teil machte ein Prettier-Lauf mit anderer Konfiguration die Probe
 * falsch rot (`position:relative` statt `position: relative`), ohne dass sich
 * ein Pixel bewegt (Kritik R4, Probe F1); ohne den Wert-Teil tat es
 * `POSITION: RELATIVE` (Kritik R5, Probe Q6).
 *
 * Eine Custom Property bleibt in BEIDEN Haelften stehen, wie sie dasteht:
 * `--Gap` und `--gap` sind zwei verschiedene Variablen, und ihr Wert wird als
 * Token-Strom eingesetzt, also gross/klein-empfindlich gelesen.
 */
function normalizeDecls(body: string): string[] {
  return splitOutside(body, ';')
    .map((d) => squeeze(d).trim())
    .filter(Boolean)
    .map((d) => {
      const i = colonOutside(d);
      if (i < 0) return d;
      const name = d.slice(0, i).trim();
      const value = d.slice(i + 1).trim();
      if (name.startsWith('--')) return `${name}: ${value}`;
      const prop = name.toLowerCase();
      if (CASE_SENSITIVE_VALUES.has(prop)) return `${prop}: ${value}`;
      return `${prop}: ${lowerValue(value)}`;
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
    // Gesucht wird auf dem MASKIERTEN Text (Zeichenketten ausgeblendet),
    // geschnitten wird aus dem echten - eine Klammer oder ein Semikolon in
    // `content: "}"` ist keine Klammer und kein Semikolon (Kritik R5, Q3/Q5).
    const mask = cssMask(text);
    let head = '';
    let i = 0;
    while (i < text.length) {
      const ch = mask[i];
      if (ch === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (mask[j] === '{') depth += 1;
          else if (mask[j] === '}') depth -= 1;
          j += 1;
        }
        if (depth > 0) throw new Error(`CSS-Block ohne schliessende Klammer: "${head.trim()}"`);
        const body = text.slice(i + 1, j - 1);
        const selector = normalizeSelector(head);
        if (/^@(media|supports|container|layer|scope|document)\b/.test(selector)) {
          walk(body, at.length > 0 ? `${at} ${selector}` : selector);
        } else if (/^@(-[\w]+-)?keyframes\b/.test(selector)) {
          // Ein Keyframe-Block traegt keine Selektoren, sondern Zeitpunkte. Er
          // wandert als EINE Regel mit seinem ganzen Rumpf in den Vergleich -
          // eine zusaetzliche Animation faellt damit auf, ohne dass der Parser
          // ihre Prozentmarken fuer Selektoren haelt.
          out.push({ at, selector, decls: [squeeze(body).trim()] });
        } else {
          if (cssMask(body).includes('{')) {
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
      head += text[i];
      i += 1;
    }
    if (head.trim().length > 0) throw new Error(`CSS-Rest ohne Block: "${head.trim()}"`);
  };
  walk(stripComments(css), '');
  return out;
}

/**
 * Das OEFFNENDE Tag steht am Zeilenanfang - diese Verankerung ist kein
 * Schoenheitsfehler, sondern noetig: ohne sie liest der Ausdruck die Erwaehnung
 * "`<style scoped>`" in einem Kommentar als oeffnendes Tag und haelt danach den
 * halben Quelltext fuer CSS.
 *
 * Das SCHLIESSENDE Tag ist dagegen NICHT verankert - genau daran ging der
 * Angriff vorbei: `<style>.preview-page .visu-root{outline:6px solid magenta}
 * </style>` auf EINER Zeile (die normale Schreibweise in einem HTML-Dokument)
 * wurde von der alten Verankerung `^[ \t]*<\/style>` gar nicht gefunden, also
 * weder vom Verzeichnisscan noch vom Wirkungsvergleich gelesen (Kritik R6, T3;
 * S2 war nur zur Haelfte geschlossen). Der Block endet jetzt dort, wo er in HTML
 * endet: am ersten `</style>`.
 */
const STYLE_BLOCK = /^[ \t]*<style([^>]*)>([\s\S]*?)<\/style>/gm;

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
 * Und dieselbe Ausnahme fuer den Wirkungsvergleich weiter unten: die
 * Selektoren, die auf der echten Seite greifen und in der Vorschau nicht. Es
 * sind genau die beiden benannten Abweichungen - der eigene Rahmenname (A4)
 * und das Editor-Chrome (A1). Ausgeschrieben, weil eine offene Menge hier
 * dieselbe Tuer waere wie ein zu kurzer Griffkatalog.
 */
const LIVE_ONLY_MATCHES: readonly string[] = ['.overview-tweaks-toggle', '.skin-page'];

/**
 * Und dieselbe Ausnahme noch einmal auf der Ebene der GLIEDER (s.
 * {@link selectorLinks}). Sie ist um zwei Zeilen laenger, und beide sind
 * dieselbe benannte Abweichung von einer anderen Seite gesehen: das
 * Editor-Chrome (A1) ist das EINZIGE `<button>` der Live-Seite, also trifft
 * jedes Glied, das ein `<button>` beschreibt, nur sie. Ausgeschrieben statt
 * ueber eine Regel weggewischt - waechst die Liste, ist das eine Aussage.
 */
const LIVE_ONLY_LINKS: readonly string[] = [
  '.overview-tweaks-toggle',
  '.skin-page',
  'button',
  'button:not(.on)',
];

/**
 * Und die Ausnahme fuer den DRITTEN Fall: die vorschau-EIGENEN Zustaende.
 *
 * `waiting` (noch kein Entwurf) und `unknown-skin` (ein Skin, den diese Visu
 * nicht ausliefert) rendern statt der Seite ein `<p class="preview-hint">`. Die
 * Live-Seite kennt beide Zustaende nicht, also kann kein gemeinsamer Boden sie
 * zeigen - und weil kein Boden sie zeigte, hiess eine Regel, die AUSSCHLIESSLICH
 * dieses Element faerbt, „trifft auf beiden Seiten null Mal, also gleich".
 * `ion-page > p { position: fixed; inset: 0 }` in einem ausgelieferten Blatt
 * legte damit den ganzen Wartezustand der Vorschau um, ohne dass irgendetwas rot
 * wurde (Kritik R7, N2). Der literale Griff-Scanner ({@link PREVIEW_HOOKS})
 * faengt so eine Regel nur, wenn sie `.preview-hint` beim NAMEN nennt.
 *
 * Erlaubt ist in diesen Zustaenden deshalb genau zweierlei: der eigene
 * Rahmenname (A4/A5) und die eine benannte vorschau-eigene Regel (A6). Alles
 * andere, was hier und nicht auf der Live-Seite greift, ist ein Fehler.
 */
const PREVIEW_ONLY_STATE_MATCHES: readonly string[] = ['.preview-hint', '.preview-page'];

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

/* ------------------------------------------- die ausgelieferten Stilquellen */

/**
 * DENKEN IN WIRKUNG STATT IN QUELLEN. Der Blockvergleich oben bindet EINEN
 * Block, und der Verzeichnisscan darunter EIN Verzeichnis. Daneben blieb
 * beides offen (Kritik R5, S1/S2): eine Regel
 * `ion-page[data-page='preview'] .visu-root { padding: 40px }` im
 * ausgelieferten globalen Blatt `skin-host/link-affordance.css` faerbt genauso
 * nur die Vorschau, und ein `<style>` in `apps/visu/index.html` liegt
 * ausserhalb von `src` und wurde nie gelesen. Nach vier festen Zeichenketten zu
 * suchen ist ein Katz-und-Maus-Spiel; ein Griff, den die Liste nicht kennt
 * (`[data-page="preview"]`), gewinnt es.
 *
 * Deshalb wird hier nicht mehr gesucht, sondern GEMESSEN: alle Selektoren aller
 * ausgelieferten Blaetter werden gegen den WIRKLICHEN Vorschau-DOM und gegen
 * den WIRKLICHEN Live-DOM gehalten. Ein Selektor, der in der Vorschau greift
 * und auf der echten Seite nicht, faerbt genau eine der beiden - egal wie er
 * geschrieben ist, egal in welcher Datei er steht, egal an welchem Griff er
 * haengt.
 */
const DELIVERED_ROOTS: readonly string[][] = [['apps', 'visu'], ['packages']];

/**
 * Und die drei SKIN-PAKETE. Sie liegen nicht in diesem Repo, sondern haengen per
 * `link:` in `apps/visu/node_modules/@obs-visu-skins/*` (auf `obs-visu-skins`)
 * - und ausgerechnet dort lief ein Angriff durch: eine Regel
 * `ion-page[data-page='preview'] .skin-host-cell{…}` in `ionic/ionic.css` blieb
 * ungelesen, weil der Verzeichnisscan `node_modules` pauschal ueberspringt
 * (Kritik R6, T2). Die Begruendung „sie kennen die Vorschau nicht" war eine
 * Annahme; erreichbar ist es, denn es ist dieselbe Kette desselben Produkts, und
 * `main.ts`/`SkinPage.vue` importieren die drei Blaetter ausdruecklich.
 *
 * Gelesen wird das ZIEL des Symlinks, ohne `node_modules` und `dist` darin. Die
 * Gegenprobe, dass hier wirklich drei Blaetter ankommen, steht als eigene
 * Zusicherung im Test - ein Scanner, der die Pakete nicht mehr findet, faellt
 * daran auf, statt still nichts zu lesen.
 */
const SKIN_PACKAGE_DIR = join('apps', 'visu', 'node_modules', '@obs-visu-skins');

function deliveredSkinPackages(): { dir: string; label: string }[] {
  const base = join(repoRoot(), SKIN_PACKAGE_DIR);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .sort()
    .map((name) => ({ dir: realpathSync(join(base, name)), label: `@obs-visu-skins/${name}` }))
    .filter((p) => statSync(p.dir).isDirectory());
}

/**
 * Die CSS-TRAGENDEN Dateien unter diesen Wurzeln: Stylesheets, die
 * `<style>`-Bloecke der SFC (ein- wie mehrzeilig, s. {@link STYLE_BLOCK}) und die
 * des HTML-Dokuments selbst. `dist/` und `node_modules/` bleiben aussen vor -
 * das eine ist das Ergebnis dieser Quellen, das andere nicht unser Code; die
 * drei per `link:` eingebundenen Skin-Pakete kommen dafuer ueber
 * {@link deliveredSkinPackages} eigens dazu.
 *
 * UND DIE `@import`-KETTE dieser Dateien. Ein Verzeichnisscan endet an seinem
 * Verzeichnis, ein Blatt aber nicht: `ionic.css` laedt mit einer Zeile
 * `@import '../../shared-preview.css'` ein Blatt EINE EBENE UEBER der
 * Paketwurzel nach - die normale Form eines geteilten Token- oder Reset-Blattes
 * -, und alles darin blieb ungelesen (Kritik R7, N4). Gefolgt wird deshalb
 * jedem `@import` jeder gelesenen Datei, rekursiv und mit Schutz gegen Zyklen
 * (jede Datei wird an ihrem aufgeloesten Pfad genau einmal gelesen, egal ueber
 * wie viele Wege sie erreichbar ist).
 *
 * Was sich nicht aufloesen laesst - eine URL, ein Paket, das hier nicht liegt -
 * wird NICHT still uebersprungen, sondern als `unresolved` zurueckgegeben und
 * im Test ausgeschrieben. Heute ist diese Liste leer; das eine vorhandene
 * `@import` (`edomi.css` laedt `@obs-visu-skins/ionic/ionic.css`) loest ueber
 * dieselben `link:`-Pakete auf und ist damit ohnehin schon gelesen.
 *
 * Was das NICHT liest: CSS, das kein Stylesheet und kein `<style>`-Block ist -
 * eine Zeichenkette, die ein Bundler-Plugin oder ein Loader zur Laufzeit in ein
 * Blatt verwandelt, steht in keiner der beiden Formen. Dass der Vorschau-Chunk
 * so etwas nicht mitbringt, haelt der Verzeichnisscan
 * ({@link previewStyleArtifacts}); fuer alles andere ist es eine offene Flanke.
 * Der Rand des Dokuments ({@link edgeSince}, {@link documentNodes}) ist der Zaun
 * gegen die Stilquellen und Knoten, die im TESTDOKUMENT auftauchen - nicht
 * gegen ein Blatt, das erst der ausgelieferte Bundler baut.
 */
function importTargets(css: string): string[] {
  return parseRules(css)
    .filter((r) => /^@import\b/.test(r.selector))
    .map((r) => {
      const m = /^@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')/.exec(
        r.selector,
      );
      return (m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? m?.[5] ?? '').trim();
    })
    .filter((spec) => spec.length > 0);
}

/**
 * Wohin ein `@import` zeigt - als Datei auf der Platte, sonst `null`. Ein
 * relativer Pfad haengt an der importierenden Datei; ein Paketname wird ueber
 * dieselben `node_modules` aufgeloest, ueber die auch die `link:`-Skins
 * eingebunden sind (die fuehrende Tilde der Bundler-Schreibweise faellt weg).
 * Alles andere - eine URL vor allem - loest nicht auf und wird gemeldet.
 */
function resolveImport(spec: string, fromDir: string): string | null {
  const clean = spec.replace(/^~/, '');
  const root = repoRoot();
  const candidates = clean.startsWith('.')
    ? [resolve(fromDir, clean)]
    : [
        resolve(fromDir, clean),
        join(root, 'apps', 'visu', 'node_modules', clean),
        join(root, 'node_modules', clean),
      ];
  for (const path of candidates) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

function deliveredStyleSet(): {
  files: { path: string; css: string }[];
  unresolved: string[];
} {
  const files: { path: string; css: string }[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const queue: { abs: string; label: string; css: string }[] = [];

  const add = (abs: string, label: string): void => {
    const real = realpathSync(abs);
    if (seen.has(real)) return; // der Zyklenschutz: jede Datei genau einmal
    seen.add(real);
    const isSheet = /\.(css|scss|sass|less|styl)$/.test(real);
    const src = readFileSync(real, 'utf8');
    const css = isSheet ? src : styleBlocks(src).map((b) => b.css).join('\n');
    files.push({ path: label, css });
    queue.push({ abs: real, label, css });
  };

  const walk = (dir: string, base: string, label: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path, base, label);
        continue;
      }
      if (!/\.(css|scss|sass|less|styl|vue|html)$/.test(name)) continue;
      add(path, join(label, path.slice(base.length + 1)));
    }
  };

  const root = repoRoot();
  for (const parts of DELIVERED_ROOTS) walk(join(root, ...parts), root, '');
  for (const pkg of deliveredSkinPackages()) walk(pkg.dir, pkg.dir, pkg.label);

  // Und jetzt die Kette - so lange, bis kein neues Blatt mehr dazukommt.
  for (let i = 0; i < queue.length; i += 1) {
    const from = queue[i];
    for (const spec of importTargets(from.css)) {
      const target = resolveImport(spec, dirname(from.abs));
      if (target === null) {
        unresolved.push(`${from.label} @import ${spec}`);
        continue;
      }
      add(target, `${from.label} @import ${spec}`);
    }
  }
  return { files, unresolved };
}

function deliveredStyleFiles(): { path: string; css: string }[] {
  return deliveredStyleSet().files;
}

/**
 * Ein ausgelieferter Selektor - MIT seinem At-Kontext. Der Kontext wurde frueher
 * weggeworfen, und genau daran lief ein Angriff vorbei: eine Regel
 * `@media (max-width:700px){.skin-host-cell{padding:40px}}` meldete nur
 * `.skin-host-cell`, der auf beiden Seiten greift - also „gleich". In
 * Wirklichkeit ist die Vorschau ein schmales `<iframe>` und die echte Seite der
 * ganze Bildschirm, dieselbe Regel greift dort und hier nicht (Kritik R6, T1).
 */
type DeliveredSelector = {
  /** Der At-Kontext der Regel, leer wenn die Regel auf oberster Ebene steht. */
  at: string;
  /** Ein einzelner Selektor der Regel (eine Selektorliste zaehlt als ihre Teile). */
  selector: string;
  /** Kontext und Selektor als eine Zeile - das, was in Vergleich und Meldung geht. */
  key: string;
};

/**
 * Alle Selektoren dieser Blaetter, einzeln (eine Selektorliste zaehlt als ihre
 * Teile - `.a, .preview-page` faerbt die Vorschau genauso wie `.preview-page`
 * allein) und je mit ihrem At-Kontext. At-Regeln ohne eigenen Selektor
 * (`@import`, `@keyframes`) bleiben hier aussen vor - sie faerben nichts
 * unmittelbar.
 *
 * Fuer das `@import` heisst das ausdruecklich NICHT, dass es unbemerkt bliebe,
 * und auch nicht, dass es hier aufgefangen waere: im `<style scoped>` der
 * Vorschau faellt es am Blockvergleich auf (die Regelmenge steht dort
 * ausgeschrieben), in einem AUSGELIEFERTEN Blatt an keinem von beiden - dort
 * wird ihm gefolgt, und das nachgeladene Blatt kommt mit allen seinen
 * Selektoren in genau diese Liste ({@link deliveredStyleSet}, Kritik R7, N4).
 */
function deliveredSelectors(): DeliveredSelector[] {
  const seen = new Set<string>();
  const out: DeliveredSelector[] = [];
  for (const file of deliveredStyleFiles()) {
    for (const rule of parseRules(file.css)) {
      if (rule.selector.startsWith('@')) continue;
      for (const selector of rule.selector.split(', ')) {
        const key = rule.at.length > 0 ? `${rule.at} ${selector}` : selector;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ at: rule.at, selector, key });
      }
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Ein At-Kontext, dessen Bedingung an der GROESSE der Flaeche haengt - und damit
 * an genau dem Unterschied, den ein jsdom-Lauf nicht hat: die Vorschau steht in
 * einem `<iframe>` mit `w-full h-[70vh]` in einer Editorspalte
 * (`gui/src/components/visu/VisuPreviewFrame.vue`), die echte Seite fuellt den
 * Bildschirm. Ob eine solche Regel dort greift und hier nicht, entscheidet erst
 * der echte Viewport.
 *
 * jsdom kann das nicht entscheiden - also entscheidet es hier auch niemand: die
 * betroffenen Selektoren werden GEMELDET und im Test ausgeschrieben. Eine neue
 * groessenabhaengige Regel aendert diese Liste und macht den Test rot; ob sie ein
 * Pixel bewegt, misst Teil E als Szenario E3 (Pixel-Diff im echten Browser).
 */
const SIZE_BOUND_FEATURE =
  /\b(?:width|height|aspect-ratio|orientation|resolution|device-pixel-ratio)\b/;

const isSizeBound = (at: string): boolean =>
  at.length > 0 && (/@container\b/.test(at) || SIZE_BOUND_FEATURE.test(at));

/**
 * Die GLIEDER eines Selektors: `ion-page[data-page='preview'] .skin-host-cell`
 * ist zwei Glieder, nicht eines. Warum das eine eigene Frage ist: ein Glied, das
 * es NUR in der Vorschau gibt, macht die ganze Regel vorschau-eigen - auch wenn
 * das Element, an dem sie haengt, auf KEINER der beiden Seiten gerendert wird.
 * Der Vergleich ganzer Selektoren sagt dazu „trifft beide Seiten null Mal, also
 * gleich"; genau so blieb `ion-page[data-page='preview'] .skin-host-unsupported`
 * unsichtbar (Kritik R6, T6a). Ueber die Glieder faellt sie am Anker auf.
 *
 * Kombinatoren fliegen raus: fuer die Frage „gibt es dieses Glied auf dieser
 * Seite ueberhaupt" ist es gleich, ob es Kind, Nachfahre oder Geschwister ist.
 */
function selectorLinks(selector: string): string[] {
  return splitOutside(selector, ' ')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== '>' && p !== '+' && p !== '~');
}

/**
 * Die Zustands-Pseudoklassen, die ein jsdom-Mount nicht hat. Sie stehen als
 * MENGE da und nicht als Alternation im Ausdruck, weil eine Alternation genau
 * den Fehler erlaubt, der `:focus-visible` unsichtbar gemacht hat: `focus` stand
 * vor `focus-visible`, `\b` hielt vor dem Bindestrich, und aus
 * `.skin-host-link:focus-visible` wurde `.skin-host-link-visible` - ein
 * gueltiger Selektor, der auf BEIDEN Seiten nichts trifft und die Regel damit
 * still fuer „gleich" erklaerte (Kritik R6, T6b). Ueber die Menge kann das nicht
 * mehr passieren: der Name wird ganz gelesen und dann nachgeschlagen.
 */
const STATE_PSEUDOS: ReadonlySet<string> = new Set([
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
  'visited',
  'target',
  'target-within',
  'checked',
  'indeterminate',
  'disabled',
  'enabled',
  'placeholder-shown',
  'autofill',
  'read-only',
  'read-write',
  'default',
  'valid',
  'invalid',
  'user-valid',
  'user-invalid',
  'in-range',
  'out-of-range',
  'required',
  'optional',
  'link',
  'any-link',
  'defined',
  'open',
  'modal',
  'popover-open',
  'fullscreen',
  'picture-in-picture',
]);

/**
 * Ein Selektor in der Form, in der ihn `Element.matches` lesen kann. Was
 * entfernt wird, entfernt KEINE Wirkung, sondern verbreitert sie nur:
 *
 *   - Vues `:deep()`/`::v-deep`/`>>>` sind Nachfahren-Kombinatoren,
 *   - ein Pseudo-ELEMENT (`::before`) haengt am selben Element wie sein Traeger,
 *   - ein Zustands-Pseudo (`:hover`, `:focus-visible`) beschreibt einen
 *     Zustand, den ein jsdom-Mount nicht hat.
 *
 * Ein Zustands-Pseudo wird dabei GANZ gelesen und in {@link STATE_PSEUDOS}
 * nachgeschlagen; ein Name, der dort nicht steht, bleibt unangetastet stehen
 * und faellt notfalls an {@link splitReadable} auf. Und entfernt wird nur, was
 * auf der OBERSTEN Ebene steht: in `.a:not(:disabled)` bleibt das `:disabled`
 * stehen, denn wegzunehmen hiesse dort verengen statt verbreitern (und
 * `.a:not()` waere ausserdem gar kein Selektor mehr).
 *
 * Was diese Funktion ausgibt, greift also mindestens dort, wo die Regel greift -
 * eine Regel wird eher zu frueh gemeldet als zu spaet.
 *
 * SIE SOLL DABEI NICHT VERENGEN UND NICHT VERSTUEMMELN, und der Test
 * („liest Zustands-Pseudoklassen ganz") haelt dazu eine ABZAEHLBARE Liste von
 * Formen fest, keine Allaussage: die drei entfernten Sorten, ein `:not()` und
 * ein `:nth-child()`, die als Ganzes stehen bleiben, ein Zustandsname in einem
 * Attributwert, ein ESCAPTER Doppelpunkt vor einem Zustandsnamen (`.md\:hover`
 * ist eine Klasse namens `md:hover`, kein Pseudo - er wurde frueher still
 * weggeschnitten, Kritik R7, N6) und `::slotted()`/`::v-deep()` (die frueher als
 * `.a: .b` bzw. ` (.b)` herauskamen). Wofuer die Liste NICHT buergt: eine Form,
 * die dort nicht steht. Was `Element.matches` danach nicht mehr lesen kann,
 * landet laut in `unreadable` ({@link splitReadable}) statt still zu treffen -
 * das ist der Zaun, nicht dieser Absatz.
 */
function stripStatePseudos(selector: string): string {
  let out = '';
  let depth = 0;
  let quote = '';
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (quote.length > 0) {
      out += ch;
      if (ch === '\\' && i + 1 < selector.length) {
        out += selector[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    // Ein Escape ausserhalb von Anfuehrungszeichen: das naechste Zeichen ist
    // ein BUCHSTABE des Namens, kein Satzzeichen. Ohne diesen Zweig las die
    // Schleife das `:` in `.md\:hover` als Pseudo-Anfang und schnitt die halbe
    // Klasse weg - still, denn `.md\` wirft in `matches` nicht (Kritik R7, N6).
    if (ch === '\\' && i + 1 < selector.length) {
      out += ch + selector[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) {
      const m = /^:([A-Za-z][\w-]*)(?![\w-(])/.exec(selector.slice(i));
      if (m !== null && STATE_PSEUDOS.has(m[1].toLowerCase())) {
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
}

function matchable(selector: string): string {
  return stripStatePseudos(
    selector
      // Zuerst die Formen MIT Klammer, und mit einem wie zwei Doppelpunkten:
      // `::slotted(.b)` traf frueher nur der Ein-Doppelpunkt-Zweig und liess
      // den ersten stehen (`.a: .b`), `::v-deep(.b)` wurde vom Zweig darunter
      // zu ` (.b)` zerlegt - beides Verstuemmelungen (Kritik R7, N6).
      .replace(/::?(?:v-)?(?:deep|slotted|global)\(([^()]*)\)/g, ' $1 ')
      .replace(/::v-deep\b|>>>|\/deep\//g, ' ')
      .replace(/::[-\w]+(?:\([^()]*\))?/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Eine Probe: was verglichen wird (`key`) und womit `matches` es liest (`probe`). */
type Probe = { key: string; probe: string };

/**
 * Welche dieser Proben `Element.matches` ueberhaupt lesen kann. Was er nicht
 * lesen kann, wird NICHT still uebersprungen, sondern zurueckgegeben und im Test
 * ausgeschrieben.
 */
function splitReadable(probes: readonly Probe[]): { readable: Probe[]; unreadable: string[] } {
  const readable: Probe[] = [];
  const unreadable: string[] = [];
  for (const p of probes) {
    if (p.probe.length === 0) {
      unreadable.push(p.key);
      continue;
    }
    try {
      document.body.matches(p.probe);
      readable.push(p);
    } catch {
      unreadable.push(p.key);
    }
  }
  return { readable, unreadable };
}

/** Der erste Pruefkatalog: jeder ausgelieferte Selektor, ganz - mit At-Kontext. */
function selectorProbes(delivered: readonly DeliveredSelector[]): Probe[] {
  return delivered.map((d) => ({ key: d.key, probe: matchable(d.selector) }));
}

/**
 * Der zweite Pruefkatalog: jedes GLIED jedes Selektors, einmal (s.
 * {@link selectorLinks}). Der At-Kontext faellt hier weg - gefragt ist, ob es
 * dieses Glied auf dieser Seite ueberhaupt GIBT, und das haengt nicht am
 * Kontext.
 */
function linkProbes(delivered: readonly DeliveredSelector[]): Probe[] {
  const seen = new Set<string>();
  const out: Probe[] = [];
  for (const d of delivered) {
    for (const link of selectorLinks(matchable(d.selector))) {
      if (seen.has(link)) continue;
      seen.add(link);
      out.push({ key: link, probe: link });
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Der Pruefbereich einer Seite: der Rahmen, alles darin, und `<html>`/`<body>`. */
function scopeOf(frame: Element): Element[] {
  return [document.documentElement, document.body, frame, ...Array.from(frame.querySelectorAll('*'))];
}

/**
 * Welche Proben auf DIESER Seite wirklich greifen - der Rahmen selbst, alles
 * darin und der Dokumentrahmen darum (`<html>`/`<body>`), damit auch ein Blatt
 * auffaellt, das die Seite ueber das Dokument faerbt.
 */
function matchingProbes(frame: Element, probes: readonly Probe[]): string[] {
  const scope = scopeOf(frame);
  return probes.filter((p) => scope.some((el) => el.matches(p.probe))).map((p) => p.key);
}

/** Die Griffe, an denen NUR die Vorschau haengt - kein Blatt darf an ihnen faerben. */
const PREVIEW_HOOKS = ['preview-page', 'preview-canvas', 'preview-hint', 'data-preview'];

/**
 * Der literale Gegencheck zum Wirkungsvergleich oben: nennt ueberhaupt ein
 * ausgeliefertes Blatt einen Vorschau-Griff? Er ist enger als die Messung (vier
 * Zeichenketten statt aller Selektoren), faengt dafuer aber auch, was ein
 * jsdom-Mount gar nicht erst rendert. `scanned` ist die Gegenprobe: ein
 * Scanner, der nichts findet, weil er nichts liest, faellt an dieser Zahl auf.
 */
function foreignPreviewStyles(): { scanned: number; hits: string[] } {
  const own = join('apps', 'visu', 'src', 'preview', 'PreviewPage.vue');
  const hits: string[] = [];
  const files = deliveredStyleFiles();
  for (const file of files) {
    if (file.path === own) continue;
    for (const hook of PREVIEW_HOOKS) {
      if (file.css.includes(hook)) hits.push(`${file.path}: ${hook}`);
    }
  }
  return { scanned: files.length, hits };
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
  /**
   * Eine Interaktion - der zweite Messzeitpunkt. Der Zaun um die Seite war
   * bisher eine Momentaufnahme direkt nach dem Mount; ein Knoten, der erst nach
   * einem Klick entsteht, lag dahinter (Kritik R5, Probe S5). Geklickt wird auf
   * den Rahmen und auf die Skin-Wurzel: beides sind Flaechen ohne eigene
   * Wirkung, ein Unterschied danach kommt also von der Seite selbst.
   */
  async function interact(wrapper: { element: Element }): Promise<void> {
    const frame = frameOf(wrapper.element);
    frame.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    frame.querySelector('.overview-root')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
  }

  async function mountLive(pageId: string, tweaks?: Record<string, unknown>) {
    const edgeBefore = edgeSnapshot();
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
    return {
      wrapper,
      ctx,
      edge: () => edgeSince(edgeBefore, frameOf(wrapper.element)),
      interact: () => interact(wrapper),
    };
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
  async function mountLiveOnDraft(
    pageId: string,
    tweaks?: Record<string, unknown>,
    nodes: readonly PreviewDraftNode[] = DRAFT_NODES,
  ) {
    const edgeBefore = edgeSnapshot();
    const store = useDeviceStore();
    const source = new PreviewDataSource(
      createHttpValueBackend(() => ({ accessToken: TOKEN })),
    );
    source.setDraft({
      skin: PAGES.find((p) => p.id === pageId)!.skin,
      pageId,
      nodes,
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
    return {
      wrapper,
      ctx,
      edge: () => edgeSince(edgeBefore, frameOf(wrapper.element)),
      interact: () => interact(wrapper),
    };
  }

  /**
   * Die Vorschau in einem ihrer EIGENEN Zustaende - denen, die die Live-Seite
   * gar nicht kennt: `waiting` (Handshake steht, aber kein Entwurf da) und
   * `unknown-skin` (ein Entwurf mit einem Skin, den diese Visu nicht
   * ausliefert). Beide rendern statt der Seite den Wartehinweis.
   */
  async function mountPreviewOwnState(skin: string | null) {
    markedPageId = 'overview';
    const ctx = reactive<ShellContext>({});
    const wrapper = mount(PreviewPage, {
      global: { plugins: [i18n], provide: { [SHELL_CONTEXT_KEY as symbol]: ctx } },
    });
    await flushPromises();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    if (skin !== null) {
      emit(
        message(PREVIEW_MESSAGE.draft, {
          draft: { skin, pageId: 'overview', nodes: DRAFT_NODES },
        }),
        ADMIN_ORIGIN,
        parent,
      );
    }
    await flushPromises();
    return wrapper;
  }

  /** Dieselbe Seite ueber die Bruecke: Handshake, dann der Entwurf. */
  async function mountPreview(
    skin: string,
    pageId: string,
    draftExtra: Record<string, unknown> = {},
  ) {
    const edgeBefore = edgeSnapshot();
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
    return {
      wrapper,
      ctx,
      edge: () => edgeSince(edgeBefore, frameOf(wrapper.element)),
      interact: () => interact(wrapper),
    };
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
        const liveEdge = live.edge();
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
        // der Zeilen, sondern der Inhalt der Kacheln (s. contentFacts) und ihre
        // Platzierung (s. placementFacts) - beides ausgeschrieben.
        expectSubstance(liveTree);
        expect(placementFacts(liveTree)).toEqual({
          Zellen: 15,
          Rasterspanne: 15,
          absolutPlatziert: 0,
          Zeiger: 5,
          Bezugsrahmen: 5,
        });

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

        // Der Zaun endet nicht am Rahmen: der ganze Rand des Dokuments -
        // `<html>`, `<body>`, jeder Knoten in `<head>` und `<body>` und jede
        // aktive Stilquelle - zaehlt genauso. Ausgeschrieben, damit „gleich"
        // nicht „beidseitig blind" heisst: die Seite haengt nichts an das
        // Dokument ausser dem Behaelter, in dem der Mount sie aufspannt.
        expect(liveEdge).toEqual(RUHIGER_RAND);
        expect(preview.edge()).toEqual(liveEdge);
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
        const liveEdge = live.edge();
        live.wrapper.unmount();

        const preview = await mountPreview(skin, pageId);
        expectSubstance(liveTree);
        expect(placementFacts(liveTree)).toEqual(PLACEMENT_BY_SKIN[skin]);
        expect(liveRoot.classes.length).toBeGreaterThan(0);
        expect(
          rootFacts(preview.wrapper.find('[data-testid="preview-canvas"]').element),
        ).toEqual(liveRoot);
        expect(structure(frameOf(preview.wrapper.element))).toEqual(liveTree);
        expect(liveEdge).toEqual(RUHIGER_RAND);
        expect(preview.edge()).toEqual(liveEdge);
        prints[skin] = liveTree;
        preview.wrapper.unmount();
      }
      // Die Selbstsicherung des Skin-Vergleichs: drei Faelle, drei Flaechen.
      expect(prints.ionic).not.toEqual(prints.terminal);
      expect(prints.ionic).not.toEqual(prints.edomi);
      expect(prints.terminal).not.toEqual(prints.edomi);
    });

    /**
     * DIE FARBE - die Sicherung gegen „beide Seiten gleich blass". Der
     * Flaechenvergleich haelt Vorschau und Live gegeneinander; wenn BEIDE
     * gleichzeitig ihr Thema verlieren, sagt er nichts. Genau das passierte:
     * `makeTokens(props.theme, device.accent)` auf `makeTokens('light',
     * 'neutral')` festgenagelt liess 79/79 und die ganze App 657/657 gruen
     * (Kritik R5, Probe B5), obwohl die vier Szenarien oben nach genau diesen
     * Einstellungen benannt sind. Hier stehen die Farbwerte deshalb
     * ausgeschrieben, und zwar fuer zwei Themen - gleiche Farben bei
     * verschiedenem Thema sind der Fehler.
     *
     * (`makeTokens` liest den Akzent nicht selbst - er faerbt ueber die
     * `--vz-acc-*`-Variablen der Wurzel, die `rootFacts` oben haelt. Was diese
     * Probe sichert, ist das THEMA, aus dem beide Aufrufe ihren Untergrund
     * nehmen.)
     */
    it('faerbt die Kacheln aus dem Thema des Autors, nicht aus einem Standardton', async () => {
      const paintOf = async (tweaks: Record<string, unknown>): Promise<string[]> => {
        const live = await mountLiveOnDraft('overview', tweaks);
        const paint = paintFacts(structure(frameOf(live.wrapper.element), isEditorChrome));
        live.wrapper.unmount();
        return paint;
      };
      const dark = await paintOf(SCENARIOS[1].tweaks!);
      const light = await paintOf(SCENARIOS[3].tweaks!);
      expect(dark).toEqual(['--acc:#838b9b', 'background:rgb(214, 168, 0)']);
      expect(light).toEqual(['--acc:#676f7f', 'background:rgb(214, 168, 0)']);
      expect(dark).not.toEqual(light);
    });

    /**
     * DER RAND DER SEITE, gegen die echte Seite gehalten - an zwei
     * Messzeitpunkten: direkt nach dem Mount und noch einmal NACH einer
     * Interaktion. Der Vorgaenger war eine Momentaufnahme der Kinderliste des
     * `<body>`; ein `<style>`, das zur Laufzeit in den `<head>` wandert, ein
     * `document.body.style.padding` und ein Knoten, der erst auf einen Klick
     * hin entsteht, lagen alle drei dahinter (Kritik R5, S3-S5).
     *
     * Aufgenommen wird der Zustand zu diesen zwei Zeitpunkten - was dazwischen
     * entsteht und wieder vergeht, sieht diese Probe nicht.
     */
    it('haelt den aufgenommenen Rand des Dokuments gegen die echte Seite - beim Mount und nach einer Interaktion', async () => {
      const before = edgeSnapshot();
      const live = await mountLiveOnDraft('overview');
      const liveEdge = live.edge();
      await live.interact();
      const liveAfter = live.edge();
      live.wrapper.unmount();

      const preview = await mountPreview('ionic', 'overview');
      expect(preview.edge()).toEqual(liveEdge);
      await preview.interact();
      expect(preview.edge()).toEqual(liveAfter);

      // Und ausgeschrieben, damit „gleich" nicht „beidseitig blind" heisst:
      // keine der beiden Seiten aendert irgendetwas am Dokument - weder beim
      // Mount noch nach dem Klick.
      expect(liveEdge).toEqual(RUHIGER_RAND);
      expect(liveAfter).toEqual(RUHIGER_RAND);
      expect(edgeSince(before, frameOf(preview.wrapper.element))).toEqual(RUHIGER_RAND);

      // Und ABSOLUT, nicht nur als Unterschied gegen eine Aufnahme: so sieht
      // das Dokument aus. Ein Blatt, das schon beim Laden des Moduls
      // eingehaengt wuerde, laege vor jeder Aufnahme und fiele im Unterschied
      // nicht auf - hier faellt es auf.
      expect(documentStyleSources()).toEqual(['CSSOM: 0 Blatt, 0 adoptiert']);
      expect(printElement(document.documentElement, '@html')).toBe('@html | html |  |  |  | ');
      expect(printElement(document.body, '@body')).toBe('@body | body |  |  |  | ');

      // Und dasselbe fuer den BESTAND, nicht nur fuer `<html>`/`<body>` und die
      // Stilquellen: `<head>` und `<body>` tragen ueberhaupt keinen Knoten.
      // Genau hier faellt auf, was ein Vorschau-Modul beim LADEN an den `<body>`
      // haengt und BEHAELT - ein Toast-Container, ein Splash-Overlay, ein
      // Debug-Banner. Ein solcher Knoten steht schon in DOCUMENT_AT_IMPORT (die
      // Aufnahme faellt nach den statischen Importen dieser Datei) und ist in
      // jedem Unterschied unsichtbar (Kritik R7, N3); diese Zeile kennt die
      // Importreihenfolge nicht.
      expect(documentNodes()).toEqual(LEERES_DOKUMENT);

      // Und gegen den fruehesten Stand, den dieser Lauf kennt: das Dokument
      // beim Laden der Module. Was ein Modul schon dort tut und beim ersten
      // Mount rueckgaengig macht - ein Splash-Knoten, der angehaengt und in
      // `onMounted` wieder entfernt wird -, liegt vor jeder anderen Aufnahme
      // und faellt nur hier auf (Kritik R6, T4).
      expect(edgeSince(DOCUMENT_AT_IMPORT, frameOf(preview.wrapper.element))).toEqual(
        RUHIGER_RAND,
      );
    });

    /**
     * Die Gegenproben zum Rand: dass er nicht nur deshalb leer ist, weil er
     * nicht hinsieht. Jede der fuenf steht fuer einen Weg, der frueher an ihm
     * vorbeilief - ein Knoten am `<body>`, ein Blatt im `<head>`, das `<body>`
     * selbst, ein schon vorhandenes Kind, und alles davon auch dann, wenn es
     * erst nach einer Interaktion passiert.
     */
    it('faengt jeden dieser Wege: Knoten, <head>, <body> selbst, vorhandenes Kind, entfernter Knoten, spaeter', async () => {
      const bestand = document.createElement('div');
      bestand.className = 'bestand-probe';
      document.body.appendChild(bestand);
      const before = edgeSnapshot();
      const preview = await mountPreview('ionic', 'overview');
      const frame = frameOf(preview.wrapper.element);
      const ruhe = edgeSince(before, frame);
      expect(ruhe).toEqual(RUHIGER_RAND);

      const probe = document.createElement('div');
      probe.className = 'zaun-probe';
      probe.textContent = 'Entwurfsvorschau';
      const sheet = document.createElement('style');
      sheet.textContent = '.preview-page .visu-root { padding: 40px }';
      try {
        // 1 - ein Knoten am `<body>` (Teleport, Portal, Banner).
        document.body.appendChild(probe);
        expect(edgeSince(before, frame)).toEqual([
          ...ruhe,
          'neu @body | div | zaun-probe |  |  | Entwurfsvorschau',
        ]);
        // Und die Gegenprobe zum ABSOLUTEN Bestand: er ist nicht deshalb leer,
        // weil er nicht hinsieht - er zaehlt beide Knoten, den vorhandenen wie
        // den neuen, und ohne jede Aufnahme dazwischen (Kritik R7, N3).
        expect(documentNodes()).toEqual([
          '@body | div | bestand-probe |  |  | ',
          '@body | div | zaun-probe |  |  | Entwurfsvorschau',
        ]);
        probe.remove();

        // 2 - ein Blatt, das zur Laufzeit in den `<head>` gehaengt wird (S3).
        document.head.appendChild(sheet);
        expect(edgeSince(before, frame)).toEqual([
          'neue Stilquelle: head <style> .preview-page .visu-root { padding: 40px }',
          'neue Stilquelle: CSSOM: 1 Blatt, 0 adoptiert',
          'Stilquelle weg: CSSOM: 0 Blatt, 0 adoptiert',
          ...ruhe,
          'neu @head | style |  |  |  | .preview-page .visu-root { padding: 40px }',
        ]);
        sheet.remove();

        // 3 - das `<body>`-Element selbst (S4). Im echten Vorschau-iframe IST
        //     der `<body>` die Seite.
        document.body.style.padding = '40px';
        expect(edgeSince(before, frame)).toEqual([
          'geaendert @body | body |  |  |  |  -> @body | body |  |  | padding:40px | ',
          ...ruhe,
        ]);
        document.body.removeAttribute('style');

        // 4 - ein Kind, das es schon vor dem Mount gab.
        bestand.setAttribute('data-spaet', '1');
        expect(edgeSince(before, frame)).toEqual([
          ...ruhe,
          'geaendert @body | div | bestand-probe |  |  |  ->' +
            ' @body | div | bestand-probe | data-spaet=1 |  | ',
        ]);
        bestand.removeAttribute('data-spaet');

        // 5 - ein Knoten, den die Seite dem Dokument WEGNIMMT (Kritik R6, T4).
        //     Eine Seite, die beim Modulladen ein `div.obs-splash` anhaengt und
        //     es in `onMounted` wieder entfernt, aendert den Rand genauso wie
        //     eine, die etwas hinzufuegt - im `<iframe>` ist ein entferntes
        //     `<meta name="viewport">` ein anderer Massstab.
        bestand.remove();
        expect(edgeSince(before, frame)).toEqual([
          ...ruhe,
          'Knoten weg: @body | div | bestand-probe |  |  | ',
        ]);
        document.body.appendChild(bestand);
        expect(edgeSince(before, frame)).toEqual(ruhe);

        // 6 - und dasselbe nach einer Interaktion: der Rand ist kein
        //     Schnappschuss vom Mount (S5).
        await preview.interact();
        expect(edgeSince(before, frame)).toEqual(ruhe);
        document.body.appendChild(probe);
        expect(edgeSince(before, frame)).toEqual([
          ...ruhe,
          'neu @body | div | zaun-probe |  |  | Entwurfsvorschau',
        ]);
      } finally {
        probe.remove();
        sheet.remove();
        bestand.remove();
        document.body.removeAttribute('style');
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

    /**
     * Die zweite Haelfte derselben Frage: was NICHT gleich zaehlen darf. Eine
     * Normalisierung, die zu viel glattzieht, laesst echte Abweichungen durch -
     * deshalb steht hier beides nebeneinander, gleiche Wirkung und andere.
     */
    it('zaehlt gleiche Wirkung gleich - und andere Wirkung nicht', () => {
      // Gleich: Schreibweise von Eigenschaft und Wert (Kritik R5, Probe Q6).
      expect(parseRules('.a{POSITION:RELATIVE;contain:LAYOUT STYLE}')).toEqual(
        parseRules('.a{position:relative;contain:layout style}'),
      );
      // Gleich: ein CSS-Escape, der denselben Namen schreibt.
      expect(parseRules('.preview\\2Dpage{color:red}')).toEqual(
        parseRules('.preview-page{color:red}'),
      );

      // ANDERS: eine Custom Property ist gross/klein-empfindlich, in Name
      // UND Wert - `--Gap` ist nicht `--gap`.
      expect(parseRules('.a{--Gap:1px}')).not.toEqual(parseRules('.a{--gap:1px}'));
      expect(parseRules('.a{color:var(--Gap)}')).not.toEqual(
        parseRules('.a{color:var(--gap)}'),
      );
      // ANDERS: Leerraum IN einer Zeichenkette ist Inhalt, kein Leerraum.
      expect(parseRules('.a{content:"x  y"}')).not.toEqual(parseRules('.a{content:"x y"}'));
      // ANDERS: ein Pfad ist gross/klein-empfindlich.
      expect(parseRules('.a{background:url(/A.png)}')).not.toEqual(
        parseRules('.a{background:url(/a.png)}'),
      );
      // ANDERS: ein selbstgewaehlter Bezeichner als WERT ist
      // gross/klein-empfindlich - eine Animation `Slide` ist nicht `slide`, ein
      // Zaehler `Foo` nicht `foo`, ein Rasterbereich `Header` nicht `header`
      // (Kritik R6 §4, s. CASE_SENSITIVE_VALUES).
      expect(parseRules('.a{animation-name:Slide}')).not.toEqual(
        parseRules('.a{animation-name:slide}'),
      );
      expect(parseRules('.a{animation:2s Slide}')).not.toEqual(parseRules('.a{animation:2s slide}'));
      expect(parseRules('.a{counter-reset:Foo}')).not.toEqual(parseRules('.a{counter-reset:foo}'));
      expect(parseRules('.a{grid-area:Header}')).not.toEqual(parseRules('.a{grid-area:header}'));
      // Und die Gegenrichtung, damit die Ausnahme nicht die Formatierung
      // wieder falsch rot macht: der EIGENSCHAFTSname bleibt unempfindlich,
      // und Leerraum zaehlt auch hier nicht.
      expect(parseRules('.a{GRID-AREA: Header}')).toEqual(parseRules('.a{grid-area:Header}'));

      // ANDERS: `.foo\.bar` ist EINE Klasse mit einem Punkt im Namen, nicht
      // zwei Klassen - der Escape wird deshalb nicht aufgeloest.
      expect(parseRules('.foo\\.bar{color:red}')).not.toEqual(
        parseRules('.foo.bar{color:red}'),
      );

      // Und der Parser laesst sich von einer Klammer in einer Zeichenkette
      // nicht mehr aus der Regel druecken (Kritik R5, Proben Q3 und Q5).
      const tricky = parseRules('.a{--m:"}";padding:40px}');
      expect(tricky).toHaveLength(1);
      expect(tricky[0].decls).toEqual(['--m: "}"', 'padding: 40px']);
      // Ein Kommentar oder eine Zeichenkette ohne Ende wirft, statt still den
      // halben Block zu verschlucken.
      expect(() => parseRules('.a{color:red} /* offen')).toThrow(/Kommentar ohne Ende/);
      expect(() => parseRules('.a{content:"offen}')).toThrow(/Zeichenkette ohne Ende/);
    });

    /**
     * Der Name sagt genau, was hier gemessen wird, und nicht mehr: das
     * VERZEICHNIS `src/preview` traegt genau einen Stilblock und kein eigenes
     * Blatt. Frueher hiess dieser Test „bringt seinen Stil nur aus diesem
     * einen Block - kein zweites Blatt" - das behauptete drei Nummern zu viel
     * (Kritik R5: S1, S2, S3 sind drei zweite Blaetter, die er nicht sieht).
     * Was daneben liegt, misst der Wirkungsvergleich darunter.
     */
    it('legt im Vorschau-Verzeichnis genau einen Stilblock ab und kein eigenes Blatt', () => {
      // N1 war ein eigenes `preview-frame.css` im Vorschau-Chunk: dieselbe
      // Abweichung, nur ausserhalb des Blocks geschrieben.
      expect(previewStyleArtifacts()).toEqual(['PreviewPage.vue <style scoped>']);
    });

    /**
     * Die Gegenprobe zum `@import`-Leser: dass er die Zeile in ihren
     * ueblichen Schreibweisen findet und sein Ziel dort sucht, wo der Browser
     * es suchen wuerde - relativ zur IMPORTIERENDEN Datei, nicht zum
     * Verzeichnisscan. Was er nicht findet, gibt er als `null` zurueck und
     * landet damit in der ausgeschriebenen `unresolved`-Liste (Kritik R7, N4).
     */
    it('liest die @import-Zeilen eines Blattes und loest ihr Ziel auf', () => {
      expect(importTargets("@import '../../shared-preview.css';\n.a{color:red}")).toEqual([
        '../../shared-preview.css',
      ]);
      expect(importTargets('@import url("x/y.css") screen;')).toEqual(['x/y.css']);
      expect(importTargets('@import url(z.css);')).toEqual(['z.css']);
      expect(importTargets('.a{color:red}')).toEqual([]);

      const previewDir = join(repoRoot(), 'apps', 'visu', 'src', 'preview');
      expect(resolveImport('./PreviewPage.vue', previewDir)).toBe(
        join(previewDir, 'PreviewPage.vue'),
      );
      expect(resolveImport('@obs-visu-skins/ionic/ionic.css', previewDir)).not.toBeNull();
      // Ein Ziel ausserhalb der Platte gibt es hier nicht - es wird gemeldet.
      expect(resolveImport('https://example.test/a.css', previewDir)).toBeNull();
      expect(resolveImport('./gibtesnicht.css', previewDir)).toBeNull();
    });

    it('nennt in keinem anderen ausgelieferten Blatt einen Vorschau-Griff', () => {
      const foreign = foreignPreviewStyles();
      // Gegenprobe: der Scanner liest ueberhaupt Dateien - und zwar auch das
      // ausgelieferte Dokument selbst, nicht nur `src` (Kritik R5, Probe S2).
      expect(foreign.scanned).toBeGreaterThan(10);
      expect(deliveredStyleFiles().map((f) => f.path)).toContain(join('apps', 'visu', 'index.html'));
      expect(foreign.hits).toEqual([]);
    });

    /**
     * DER WIRKUNGSVERGLEICH - die Antwort auf S1 und S2. Nicht „welche Datei
     * nennt einen von vier Griffen", sondern: welcher Selektor GREIFT am Ende
     * in der Vorschau und nicht auf der echten Seite?
     *
     * Gelesen wird dafuer jedes Stylesheet und jeder `<style>`-Block unter
     * `apps/visu` und `packages` - ein- wie mehrzeilig geschrieben - UND die
     * drei per `link:` eingebundenen Skin-Pakete. Gehalten wird jeder Selektor
     * gegen zwei Boeden: die volle Seite und die leere
     * ({@link EMPTY_FLOOR_NODES}). Und zwar in drei Fragen:
     *
     *   1. Greift der ganze Selektor nur auf einer Seite?
     *   2. Gibt es eines seiner GLIEDER nur auf einer Seite? (Damit faellt auch
     *      eine Regel auf, deren Element KEIN Boden rendert - sie haengt dann an
     *      einem vorschau-eigenen Anker; Kritik R6, T6a.)
     *   3. Haengt der Selektor in einem groessenabhaengigen At-Kontext? Dann ist
     *      er in jsdom NICHT entscheidbar und steht ausgeschrieben da (T1).
     *
     * WAS DIESER TEST NICHT SAGT: er ist kein Pixelbeweis. Er misst, welcher
     * Selektor auf welcher Seite GREIFT - nicht, welche Deklaration am Ende
     * gewinnt und wie sie aussieht. Eine Deklaration in einem ausgelieferten
     * Blatt zu aendern (`inset: 0` -> `inset: 40%`) bewegt Pixel und ist hier
     * unsichtbar; das misst Teil E (E3).
     */
    it('haelt jeden gelesenen Selektor und jedes seiner Glieder gegen beide Boeden - vorschau-eigen ist nur .preview-page', async () => {
      const delivered = deliveredSelectors();
      // Gegenprobe 1: der Scanner findet ueberhaupt Selektoren - die des
      // globalen Blattes, an dem S1 hing, die des HTML-Dokuments und die der
      // drei Skin-Pakete, die frueher gar nicht gelesen wurden (T2).
      expect(delivered.length).toBeGreaterThan(20);
      const keys = delivered.map((d) => d.key);
      expect(keys).toContain('.skin-host-cell[data-link]');
      expect(keys).toContain('.skin-host-link:focus-visible');
      const set = deliveredStyleSet();
      const paths = set.files.map((f) => f.path);
      expect(paths).toContain(join('apps', 'visu', 'index.html'));
      expect(paths.filter((p) => p.startsWith('@obs-visu-skins/')).sort()).toEqual([
        join('@obs-visu-skins', 'edomi', 'src', 'edomi.css'),
        join('@obs-visu-skins', 'ionic', 'ionic.css'),
        join('@obs-visu-skins', 'terminal', 'terminal.css'),
      ]);
      // Gegenprobe 1b (N4): der `@import`-Kette wird gefolgt. Ein Blatt, das
      // ein gelesenes Blatt nachlaedt, steht mit eigener Zeile in dieser Liste
      // (der Name nennt den Weg dorthin); ein Ziel, das sich nicht aufloesen
      // laesst, steht in `unresolved` statt still uebersprungen zu werden.
      expect(set.unresolved).toEqual([]);
      expect(paths.filter((p) => p.includes('@import'))).toEqual([]);
      // Und die Kette wird wirklich gegangen: `edomi.css` laedt das ionic-Blatt
      // nach. Es ist damit ueber zwei Wege erreichbar und wird trotzdem genau
      // einmal gelesen (Zyklenschutz).
      const edomi = set.files.find(
        (f) => f.path === join('@obs-visu-skins', 'edomi', 'src', 'edomi.css'),
      );
      expect(importTargets(edomi!.css)).toEqual(['@obs-visu-skins/ionic/ionic.css']);
      expect(paths.filter((p) => p.endsWith(join('ionic', 'ionic.css')))).toHaveLength(1);

      // Gegenprobe 2: was `Element.matches` nicht lesen kann, wird nicht still
      // uebersprungen, sondern steht hier - heute ist die Liste leer.
      const whole = splitReadable(selectorProbes(delivered));
      const links = splitReadable(linkProbes(delivered));
      expect(whole.unreadable).toEqual([]);
      expect(links.unreadable).toEqual([]);

      // T1: was in jsdom NICHT entscheidbar ist, weil seine Bedingung an der
      // Groesse der Flaeche haengt - die Vorschau ist ein schmales `<iframe>`,
      // die echte Seite der ganze Bildschirm. Ausgeschrieben statt still als
      // „gleich" gezaehlt; entschieden wird das im Pixel-Diff von Teil E (E3).
      // Heute sind das genau die acht Regeln, mit denen der terminal-Skin sein
      // Raster ab 700px umbaut. Sie sind KEIN Fehler - aber sie greifen im
      // schmalen Vorschau-`<iframe>` anders als auf der vollflaechigen Seite,
      // und genau das gehoert nach E3.
      expect(delivered.filter((d) => isSizeBound(d.at)).map((d) => d.key)).toEqual([
        '@container (width <= 700px) .t-root .t-cmds',
        '@container (width <= 700px) .t-root .t-label',
        '@container (width <= 700px) .t-root .t-led',
        '@container (width <= 700px) .t-root .t-minmax',
        '@container (width <= 700px) .t-root .t-row',
        '@container (width <= 700px) .t-root .t-state',
        '@container (width > 700px) .t-root .t-label',
        '@container (width > 700px) .t-root .t-state',
      ]);

      const floors: [string, readonly PreviewDraftNode[]][] = [
        ['die volle Seite', DRAFT_NODES],
        ['die leere Seite', EMPTY_FLOOR_NODES],
      ];
      for (const [name, nodes] of floors) {
        const live = await mountLiveOnDraft('overview', undefined, nodes);
        const liveFrame = frameOf(live.wrapper.element);
        const liveWhole = matchingProbes(liveFrame, whole.readable);
        const liveLinks = matchingProbes(liveFrame, links.readable);
        const liveTree = structure(liveFrame, isEditorChrome);
        live.wrapper.unmount();

        const preview = await mountPreview('ionic', 'overview', { nodes });
        const previewFrame = frameOf(preview.wrapper.element);
        const previewWhole = matchingProbes(previewFrame, whole.readable);
        const previewLinks = matchingProbes(previewFrame, links.readable);

        // Gegenprobe 3: beide Boeden zeigen wirklich, was sie zeigen sollen -
        // sonst waere die leere Seite nur ein zweiter Fehlschlag. Und der
        // Abgleich trifft ueberhaupt etwas, sonst waeren zwei leere Mengen
        // still gleich.
        expect(contentFacts(liveTree).cells).toBe(nodes === DRAFT_NODES ? 15 : 0);
        // Auch der leere Boden ist eine gerenderte Seite und kein Nichts: die
        // Skin-Wurzel steht, sonst verglichen beide Seiten einen leeren Baum.
        expect(liveTree.some((l) => l.split(' | ')[2].split('.').includes('overview-root'))).toBe(
          true,
        );
        expect(structure(previewFrame)).toEqual(liveTree);
        expect(liveWhole.length).toBeGreaterThan(3);
        expect(liveLinks.length).toBeGreaterThan(3);

        // Was NUR in der Vorschau greift: genau die eine Regel des eigenen
        // Blocks, die A5 Deklaration fuer Deklaration an `.skin-page` bindet.
        expect([name, previewWhole.filter((s) => !liveWhole.includes(s))]).toEqual([
          name,
          ['.preview-page'],
        ]);
        expect([name, previewLinks.filter((s) => !liveLinks.includes(s))]).toEqual([
          name,
          ['.preview-page'],
        ]);
        // Und die Gegenrichtung, ausgeschrieben: die Live-Seite traegt ihren
        // eigenen Rahmennamen (A4) und ihr Editor-Chrome (A1).
        expect([name, liveWhole.filter((s) => !previewWhole.includes(s))]).toEqual([
          name,
          LIVE_ONLY_MATCHES,
        ]);
        expect([name, liveLinks.filter((s) => !previewLinks.includes(s))]).toEqual([
          name,
          LIVE_ONLY_LINKS,
        ]);
        preview.wrapper.unmount();
      }
    });

    /**
     * DER DRITTE FALL: die vorschau-EIGENEN Zustaende. Die beiden Boeden oben
     * sind gemeinsame Boeden - dieselbe Seite, zweimal gerendert. `waiting` und
     * `unknown-skin` sind das nicht: die Live-Seite hat sie nicht, also gibt es
     * keine zweite Seite, gegen die man sie stellen koennte. Genau deshalb sah
     * sie kein Boden, und genau dort lief `ion-page > p { position: fixed;
     * inset: 0 }` durch (Kritik R7, N2): das einzige `<p>` unter einer
     * `ion-page` ist der Wartehinweis der Vorschau, die Regel faerbt also
     * ausschliesslich sie - und weil KEIN Boden das Element rendert, hiess sie
     * auf beiden Seiten „trifft null Mal, also gleich".
     *
     * Gemessen wird hier deshalb in EINER Richtung, und der Testname sagt es:
     * was in diesen Zustaenden greift und auf der vollen Live-Seite nicht. Die
     * Gegenrichtung (was die Live-Seite hat und die wartende Vorschau nicht)
     * ist per Konstruktion die halbe Seite und wird hier nicht behauptet - sie
     * steht in den zwei gemeinsamen Boeden oben.
     */
    it('haelt jeden gelesenen Selektor und jedes Glied auch in den vorschau-eigenen Zustaenden gegen die Live-Seite - was nur dort greift, ist .preview-page und .preview-hint', async () => {
      const delivered = deliveredSelectors();
      const whole = splitReadable(selectorProbes(delivered));
      const links = splitReadable(linkProbes(delivered));
      expect(whole.unreadable).toEqual([]);
      expect(links.unreadable).toEqual([]);

      const live = await mountLiveOnDraft('overview');
      const liveFrame = frameOf(live.wrapper.element);
      const liveWhole = matchingProbes(liveFrame, whole.readable);
      const liveLinks = matchingProbes(liveFrame, links.readable);
      live.wrapper.unmount();
      // Gegenprobe: die Live-Seite trifft ueberhaupt etwas - sonst waere jede
      // Vorschau-Regel „nur in der Vorschau" und die Aussage wertlos.
      expect(liveWhole.length).toBeGreaterThan(3);
      expect(liveLinks.length).toBeGreaterThan(3);

      const eigene: [string, string | null][] = [
        ['waiting', null],
        ['unknown-skin', 'gibtesnichtimprodukt'],
      ];
      for (const [zustand, skin] of eigene) {
        const wrapper = await mountPreviewOwnState(skin);
        const frame = frameOf(wrapper.element);

        // Gegenprobe: dieser Zustand steht wirklich, und er rendert wirklich
        // das eine vorschau-eigene Element - sonst pruefte der Fall zwei leere
        // Mengen gegeneinander.
        expect(frame.getAttribute('data-preview-state')).toBe(zustand);
        expect(frame.querySelectorAll('.preview-hint')).toHaveLength(1);
        expect(frame.querySelector('[data-testid="preview-canvas"]')).toBeNull();

        const eigenWhole = matchingProbes(frame, whole.readable);
        const eigenLinks = matchingProbes(frame, links.readable);
        expect([zustand, eigenWhole.filter((s) => !liveWhole.includes(s))]).toEqual([
          zustand,
          PREVIEW_ONLY_STATE_MATCHES,
        ]);
        expect([zustand, eigenLinks.filter((s) => !liveLinks.includes(s))]).toEqual([
          zustand,
          PREVIEW_ONLY_STATE_MATCHES,
        ]);
        wrapper.unmount();
      }
    });

    /**
     * Die Gegenproben zu den drei Werkzeugen des Wirkungsvergleichs - dass sie
     * nicht nur deshalb nichts finden, weil sie nichts lesen. Jede steht fuer
     * einen Angriff, der genau hier durchlief (Kritik R6).
     */
    it('liest Zustands-Pseudoklassen ganz, einzeilige Bloecke und die Glieder eines Selektors', () => {
      // T6b: `focus` stand vor `focus-visible`, `\b` hielt vor dem Bindestrich -
      // aus dem Selektor wurde `.skin-host-link-visible`, der nirgends greift.
      expect(matchable('.skin-host-link:focus-visible')).toBe('.skin-host-link');
      expect(matchable('.a:focus-within .b')).toBe('.a .b');
      expect(matchable('.a:hover')).toBe('.a');
      // Und was KEINE bekannte Zustandsklasse ist, bleibt stehen, statt still
      // abgeschnitten zu werden.
      expect(matchable('.a:not(.b)')).toBe('.a:not(.b)');
      expect(matchable('.a:nth-child(2)')).toBe('.a:nth-child(2)');
      // Auch ein Zustandsname in einem Attributwert ist kein Pseudo.
      expect(matchable('[data-x=":hover"] .b')).toBe('[data-x=":hover"] .b');

      // N6: ein ESCAPTER Doppelpunkt gehoert zum Namen. `.md\:hover` ist eine
      // Klasse namens `md:hover`; frueher wurde daraus still `.md\` - ein
      // Selektor, den `matches` liest, ohne je etwas zu treffen (Kritik R7).
      expect(matchable('.md\\:hover')).toBe('.md\\:hover');
      // N6: die Kapsel-Pseudos werden GANZ ersetzt, nicht halb. `::slotted()`
      // wurde zu `.a: .b`, `::v-deep()` zu ` (.b)`.
      expect(matchable('.a::slotted(.b)')).toBe('.a .b');
      expect(matchable('.a::v-deep(.b)')).toBe('.a .b');
      expect(matchable('.a :deep(.b)')).toBe('.a .b');

      // T3: ein `<style>`-Block auf EINER Zeile - die normale Schreibweise in
      // einem HTML-Dokument - wurde von der alten Verankerung nicht gefunden.
      expect(styleBlocks('<style>.a{color:red}</style>')).toEqual([
        { attrs: '', css: '.a{color:red}' },
      ]);
      expect(styleBlocks('<style scoped>\n.a{color:red}\n</style>')).toEqual([
        { attrs: 'scoped', css: '\n.a{color:red}\n' },
      ]);

      // T6a: die Glieder eines Selektors einzeln - daran faellt ein
      // vorschau-eigener Anker auch dann auf, wenn sein Ziel nirgends rendert.
      expect(selectorLinks("ion-page[data-page='preview'] .skin-host-unsupported")).toEqual([
        "ion-page[data-page='preview']",
        '.skin-host-unsupported',
      ]);
      expect(selectorLinks('.a > .b + .c')).toEqual(['.a', '.b', '.c']);

      // T1: ein groessenabhaengiger At-Kontext wird als solcher erkannt, ein
      // groessenunabhaengiger nicht.
      expect(isSizeBound('@media (max-width:700px)')).toBe(true);
      expect(isSizeBound('@container (width > 700px)')).toBe(true);
      expect(isSizeBound('@media (prefers-reduced-motion: reduce)')).toBe(false);
      expect(isSizeBound('')).toBe(false);
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
