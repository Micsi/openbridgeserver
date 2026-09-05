<script setup lang="ts">
/**
 * preview/PreviewPage - der Vorschau-Modus der Visu (C4, Issue #171).
 *
 * Diese Seite ist die eine Haelfte der Bruecke, ueber die der V2-Editor in der
 * Admin-GUI eine echte WYSIWYG-Vorschau bekommt (Messlatte **E3**). Sie wird
 * **nur** in diesem Modus geladen: die Route ist ein dynamischer Import, also
 * liegt der ganze Empfaenger in einem eigenen Chunk und das Gast-Bundle waechst
 * praktisch nicht.
 *
 * Der Weg des Entwurfs - und warum er so laeuft:
 *
 *   Editor (gui/) --postMessage--> receiver --> PreviewDataSource --> STORE
 *                                                                      |
 *                                              DetailModalHost/OverviewGrid/SkinHost
 *                                                                      |
 *                                                                    Skin
 *
 * Der Entwurf fliesst also ueber den HOST in den Skin, nie direkt hinein: der
 * Host besitzt den Zustand (aktuelle Seite, offene Popups, Timer), der Skin nur
 * die Erscheinung (Goldene Regel 4). Und es ist derselbe Render-Pfad wie in der
 * echten Visu (`SkinPage` benutzt exakt diese drei Komponenten) - kein zweiter
 * Renderer, deshalb kann der Pixel-Vergleich aus E3 ueberhaupt aufgehen.
 *
 * Navigation: `currentPage` ist auf die Entwurfsseite genagelt. Ein Link zeigt
 * damit seine Affordanz (der Host loest ihn ueber `PageHost.resolveLink` auf,
 * Contract 1.12), aber die Vorschau wandert nie von der Seite weg, die der Autor
 * gerade bearbeitet.
 *
 * Sicherheit: die Admin-Session lebt ausschliesslich in dieser Closure. Sie
 * steht in keiner URL, keiner Query und keinem Log, und sie verlaesst das Modul
 * nur als `Authorization`-Header an den eigenen Server.
 *
 * Wurzel-Bindungen (v1.1): derselbe Renderer allein macht noch nicht dieselbe
 * SEITE. Die Flaechen-, Kachel- und Rastertokens des Skins haengen an den
 * `data-*`-Attributen und `--vz-*`-Variablen der Wurzel, die der Host aus den
 * Tweak-Werten rechnet (`applyTweaks`). Diese Seite rechnet sie deshalb genauso
 * wie `SkinPage` und setzt sie an dieselben drei Stellen: Wurzel-Attribute,
 * Wurzel-Style und `root-bind` des Hosts (fuer die ausgelagerte Detail-Flaeche).
 *
 * Und die Wurzel ist nur die Haelfte: der Rahmen um sie kommt aus dem geteilten
 * Shell-Kanal (`shellContext`). Diese Seite speist ihn mit DEMSELBEN Satz Felder
 * wie `SkinPage` - Titel, Nav-Zustand, Wurzel-Bindung, Skin-Flaeche -, sonst
 * stuende im Kopf des Vorschaurahmens dauerhaft der Nav-Ruecktitel „Übersicht"
 * statt der Seite, die der Autor gerade bearbeitet.
 *
 * Wer das nachhaelt: `PreviewParity.spec.ts` stellt beide Seiten auf DENSELBEN
 * Entwurfsboden und vergleicht die GANZE gerenderte Flaeche Element fuer Element
 * - Tag, Klassen, alle Attribute, alle Stil-Eigenschaften, den Text; dazu den
 * ganzen `<style scoped>`-Block Regel fuer Regel; dazu, welcher GELESENE Selektor
 * in der Vorschau greift und auf der echten Seite nicht - gelesen werden alle
 * Stylesheets und alle `<style>`-Bloecke (ein- wie mehrzeilig) unter `apps/visu`
 * und `packages` sowie die drei per `link:` eingebundenen Skin-Pakete, jeweils
 * samt ihrer `@import`-Kette, gehalten gegen ZWEI gemeinsame Boeden (die volle
 * und die leere Seite) und je Selektor auch Glied fuer Glied. Dazu die zwei
 * Zustaende, die es nur in der Vorschau gibt (`waiting`, `unknown-skin` - der
 * Wartehinweis), und dort in DREI Fragen: welcher gelesene Selektor greift da
 * und auf der Live-Seite nicht; was diese Zustaende INNERHALB der `ion-page`
 * rendern, Rahmen und Baum Element fuer Element ausgeschrieben, samt Inline-Stil;
 * und - weil das erste beides nur den `ion-page`-Teilbaum misst - was sie
 * AUSSERHALB von ihm am Dokument stehen lassen, mit derselben Randmessung wie
 * die verglichene Seite. Ein `<Teleport to="body">` legt seinen Knoten neben den
 * Teilbaum; ohne diese dritte Frage bliebe ein Vollbild-Overlay im
 * `v-else`-Zweig unsichtbar. Und dazu den Zustand des Dokuments neben dem Rahmen -
 * `<html>`, `<head>` und `<body>` selbst, jedes Element darunter - auch eines,
 * das NEBEN `<head>` und `<body>` direkt an `<html>` haengt -, jede Stilquelle
 * im Testdokument, aufgenommen nach dem Mount UND nach einer Interaktion und in
 * beide Richtungen verglichen (dazugekommen, geaendert, entfernt). Weil ein
 * Unterschied immer nur gegen eine Aufnahme misst, steht daneben der BESTAND
 * absolut: unter `<html>` haengt kein Element - auch keines, das ein Modul
 * schon beim Laden anhaengt und behaelt. Alles, was
 * abweichen darf, steht dort als kurze, benannte Ausnahmeliste (A1-A6): das
 * Editor-Chrome der Live-Seite (der Tweak-Umschalter - im Vorschau-Modus
 * bedient der Autor ihn in der Admin-GUI), die Vorschau-Marker (nur an der
 * Wurzel, nur mit ihrem Wert), Vues Scoped-Marker, der Seitenrahmen, die
 * Umbenennung `.preview-page` -> `.skin-page` und die eine vorschau-eigene
 * Stilregel `.preview-hint`. Was hier also neu gerendert wird, muss auch auf der
 * echten Seite stehen oder in dieser Liste - sonst faellt der Nachweis.
 *
 * Und was er NICHT leistet - DREI Grenzen, die AN TEIL E (Szenario E3,
 * Pixel-Diff im echten Browser) UEBERGEBEN sind statt wegdefiniert. Keine davon
 * kann ein jsdom- oder happy-dom-Lauf entscheiden: keiner hat einen Viewport,
 * keiner rechnet CSS aus. Teil E misst sie:
 *
 *   E3-1  der CONTAINER-/VIEWPORT-ANTEIL groessenabhaengiger Regeln (`@media (max-width:…)`,
 *         `@container (width …)`): die Vorschau ist ein schmales `<iframe>`, die
 *         echte Seite der ganze Bildschirm, dieselbe Regel greift dort und hier
 *         nicht. Genauer: der terminal-Skin baut sein Raster ueber `@container`
 *         an einer 700-px-Schwelle um, und der Container ist die Skin-Wurzel
 *         `.t-root` (`container-type: inline-size`) - es entscheidet also ihre
 *         Breite, die der Rahmen vorgibt, nicht die des Viewports. Die Spec
 *         MELDET jeden solchen Selektor namentlich und schreibt ihn aus; ob er
 *         ein Pixel bewegt, entscheidet erst der Pixel-Diff.
 *   E3-2  was der RAHMEN um diese Seite am Bild aendert, soweit es nur ein
 *         Browser entscheiden kann. Der `<iframe>` steht in `gui/`; weder diese
 *         Seite noch ihr DOM wissen von ihm. GEMESSEN wird er in
 *         `gui/tests/components/visu/` an ATTRIBUTEN, vom `<iframe>` bis zum
 *         `<html>`: Klassenliste und `style`-Attribut des Rahmens in JEDEM
 *         Zustand der Komponente; JEDES Element seines Vorfahrenpfades - bis
 *         hinauf in die echte Schale aus `App.vue` und `AppLayout`, samt dem
 *         Inline-Stil, den `App.vue` dort durchreicht; und jede Regel eines
 *         handgeschriebenen Blattes unter `gui/src`, die diesen Pfad TREFFEN
 *         KANN (per `matches()` gegen den Pfad, nicht nur nach Klassennamen).
 *         OFFEN bleibt dreierlei, und keines davon ist eine Testluecke: was das
 *         GEBAUTE Utility-Blatt aus `rounded-lg`, `bg-white` oder `p-6`
 *         berechnet (steht in keinem Quelltext dieses Repos); OB eine
 *         erreichende Regel ein Pixel bewegt; und was erst das echte Layout
 *         entscheidet - Viewport, Beschnitt, Stapelung. Der lange Wortlaut steht
 *         im Kopf von `PreviewParity.spec.ts`.
 *   E3-3  jede AENDERUNG AN DEN DEKLARATIONEN eines ausgelieferten Blattes
 *         (`inset: 0` -> `inset: 40%`): ein jsdom-Lauf rechnet kein CSS aus. Der
 *         Wirkungsvergleich misst, welcher Selektor wo greift - nicht, welcher
 *         Wert am Ende gewinnt. Berechnete Stile und Pseudo-Elemente sind aus
 *         demselben Grund unsichtbar.
 */
import { computed, onBeforeUnmount, onMounted, ref, nextTick, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { IonPage } from '@ionic/vue';
import { applyTweaks, type IonicTweaks } from '@obs-visu-skins/ionic';

import DetailModalHost from '../app/DetailModalHost.vue';
import OverviewGrid from '../pages/OverviewGrid';
import { groupDevicesByRoom } from '../pages/pages';
import { resolveSkin } from '../skin-host/skins';
import { useDeviceStore } from '../core/store';

import { useShellContext } from '../app/shell/shellContext';
import { NAV_KEYS, type NavKey, type ShellStateOptions } from '../app/shell/useShellState';

import { PreviewDataSource } from './PreviewDataSource';
import { createHttpValueBackend } from './values';
import { createPreviewReceiver } from './receiver';
import { allowedPreviewOrigins } from './origins';
import { themeOfTweaks, type PreviewDraft, type PreviewSession, type PreviewTheme } from './protocol';

const { t } = useI18n();
const store = useDeviceStore();
const { devices, positions, links } = storeToRefs(store);

/** Nur im Speicher. Kein localStorage, keine URL, kein Log. */
let session: PreviewSession | null = null;

const draft = ref<PreviewDraft | null>(null);
/** `waiting` = noch kein Entwurf, `ready` = gerendert, `unknown-skin` = Fehler. */
const state = ref<'waiting' | 'ready' | 'unknown-skin'>('waiting');

const source = new PreviewDataSource(createHttpValueBackend(() => session));

const receiver = createPreviewReceiver({
  allowedOrigins: allowedPreviewOrigins(import.meta.env, window.location),
  parent: window.parent,
  listener: window,
  onSession: (s) => {
    session = s;
  },
  onDraft: (d) => {
    void applyDraft(d);
  },
});

/** Wie viele Widgets der Entwurf traegt - reine Rueckmeldung an den Editor. */
function widgetCount(d: PreviewDraft): number {
  return d.nodes.reduce((sum, n) => sum + (n.page_config?.widgets?.length ?? 0), 0);
}

/**
 * Den Entwurf uebernehmen: in die Quelle, von dort ueber `store.init` in den
 * Host. Nichts wird gespeichert - `PreviewDataSource` hat dafuer gar keinen Weg.
 */
async function applyDraft(d: PreviewDraft): Promise<void> {
  try {
    resolveSkin(d.skin);
  } catch {
    // Ein Skin, den diese Visu nicht ausliefert, ist ein sichtbarer Fehler, kein
    // stiller Fallback (Goldene Regel 3 - die Registry wirft aus demselben Grund).
    draft.value = null;
    state.value = 'unknown-skin';
    return;
  }
  source.setDraft(d);
  await store.init(source);
  draft.value = d;
  state.value = 'ready';
  await nextTick();
  receiver.applied({ pageId: d.pageId, widgetCount: widgetCount(d) });
}

/** Der Boden: die Geraete des Entwurfs, nach Seite gruppiert (wie im Live-Fall). */
const groups = computed(() => groupDevicesByRoom(devices.value, positions.value, links.value));
const skinRootClass = computed(() => (draft.value ? resolveSkin(draft.value.skin).rootClass : ''));

/**
 * Die Wurzel-Bindungen aus den Tweak-Werten des Entwurfs - dieselbe reine
 * Abbildung wie auf der echten Seite (`SkinPage.vue`). `applyTweaks` klemmt jeden
 * Wert gegen das Manifest und faellt bei unbekannten Auswahlwerten auf den
 * Default zurueck, weshalb hier auch ein fremder Entwurf nichts Unerwartetes in
 * Attribute oder CSS-Variablen schreiben kann.
 */
const rootTweaks = computed(() => applyTweaks((draft.value?.tweaks ?? {}) as IonicTweaks));

/** Das Token-Theme: was der Entwurf sagt, sonst dieselbe Ableitung wie live. */
const theme = computed<PreviewTheme>(
  () => draft.value?.theme ?? themeOfTweaks(draft.value?.tweaks),
);

/** Der Knoten, den der Entwurf gerade zeigt - die Seite des Autors. */
const draftPage = computed(() =>
  draft.value ? (draft.value.nodes.find((n) => n.id === draft.value?.pageId) ?? null) : null,
);

/**
 * Der Titel der bearbeiteten Seite. Auf der echten Seite ist das der lokalisierte
 * Titel der Seitendefinition (`SkinPage.vue`); im Entwurf gibt es keine
 * Definition, wohl aber den Namen, den der Autor der Seite gegeben hat - und
 * genau der steht spaeter auch in der ausgelieferten Visu im Kopf des Rahmens.
 * Ohne ihn faellt `AppShell` auf `t('shell.nav.<aktiver Key>')` zurueck und
 * zeigte in der Vorschau dauerhaft „Übersicht", egal welche Seite offen ist.
 */
const pageTitle = computed<string | undefined>(() => {
  const name = draftPage.value?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name : undefined;
});

/**
 * Der Nav-Zustand des Rahmens - dieselbe Regel wie live (`SkinPage.vue`): nur
 * eine Seite, die selbst ein Nav-Schluessel ist, markiert ihren Eintrag; sonst
 * bleibt der Default, damit das Menue nicht faelschlich „Übersicht" hervorhebt.
 */
const shellState = computed<ShellStateOptions>(() =>
  draft.value && (NAV_KEYS as readonly string[]).includes(draft.value.pageId)
    ? { active: draft.value.pageId as NavKey }
    : {},
);

/**
 * Anzeigenamen der Linkziele (#1194) - aus dem Entwurfsbaum statt aus den
 * statischen Seitendefinitionen. Der Host bevorzugt ohnehin den Namen aus dem
 * Nav-Baum; das hier ist derselbe Boden wie live, damit ein Link auch dann
 * seinen eigenen Namen traegt, wenn sein Ziel (noch) nicht im Nav-Baum haengt.
 */
const pageNames = computed<Record<string, string> | undefined>(() => {
  if (!draft.value) return undefined;
  const out: Record<string, string> = {};
  for (const node of draft.value.nodes) {
    if (node.type !== 'PAGE') continue;
    if (typeof node.name === 'string' && node.name.length > 0) out[node.id] = node.name;
  }
  return Object.keys(out).length > 0 ? out : undefined;
});

// Die App-Shell liegt auch im Vorschau-Modus um die Seite (App.vue). Sie zeichnet
// ihr Chrome auf der Flaeche des aktiven Skins - genau wie bei der echten Seite,
// die diese Naht fuellt. Ohne das saesse die Vorschau in einem Chrome, das eine
// andere Oberflaeche traegt als die Seite darin. Geschrieben wird deshalb
// DERSELBE Satz Felder wie in `SkinPage.vue` - ein halb gefuellter Kanal ist ein
// sichtbarer Unterschied im Kopf des Rahmens, kein Editor-Chrome.
const shellContext = useShellContext();
watchEffect(() => {
  shellContext.title = pageTitle.value;
  shellContext.state = shellState.value;
  shellContext.rootBind = rootTweaks.value;
  shellContext.rootClass = skinRootClass.value;
});

onMounted(() => {
  // Ohne Elternfenster gibt es keine Bruecke - die Vorschau ist dann nur eine
  // leere Seite statt einer Naht, die mit sich selbst spricht.
  if (window.parent !== window) receiver.start();
});
onBeforeUnmount(() => receiver.stop());
</script>

<template>
  <IonPage
    class="preview-page"
    data-page="preview"
    :data-preview-state="state"
  >
    <DetailModalHost
      v-if="draft"
      :skin="draft.skin"
      :theme="theme"
      :root-bind="rootTweaks"
    >
      <div
        class="overview-root"
        :class="skinRootClass"
        v-bind="rootTweaks.attrs"
        :style="rootTweaks.style"
        data-testid="preview-canvas"
        :data-preview-page="draft.pageId"
      >
        <OverviewGrid
          :skin="draft.skin"
          :groups="groups"
          :theme="theme"
          :current-page="draft.pageId"
          :page-names="pageNames"
        />
      </div>
    </DetailModalHost>
    <p
      v-else
      class="preview-hint"
      data-testid="preview-hint"
    >
      {{ state === 'unknown-skin' ? t('preview.unknownSkin') : t('preview.waiting') }}
    </p>
  </IonPage>
</template>

<style scoped>
/* QUELLE DIESER REGELN IST `pages/SkinPage.vue` (`.skin-page` /
   `.overview-root`), nicht diese Datei. Warum sie hier trotzdem noch einmal
   stehen: `<style scoped>` traegt den `data-v-*`-Marker genau EINES SFC, eine
   Regel laesst sich zwischen zwei Komponenten also nicht teilen - und ein
   globales Stylesheet daraus zu machen hiesse, die Kasten-Regel der echten Seite
   umzubauen. Die Kopie ist damit unvermeidbar, das Auseinanderlaufen nicht:
   `PreviewParity.spec.ts` ("der Stilblock beider Seiten") vergleicht den GANZEN
   Block - jede Regel dieser Datei muss eine Entsprechung in `SkinPage.vue`
   haben oder dort als benannte Ausnahme stehen. Benannt ist genau eine:
   `.preview-hint`, der Platzhalter VOR dem ersten Entwurf, der aus dem DOM ist,
   sobald etwas zu vergleichen da ist. Alles andere faellt: eine zweite Regel
   mit demselben Selektor, eine in `@media`, eine mit `:deep()`, ein `@import` -
   und ebenso ein eigenes Stylesheet neben dieser Datei. Und was NICHT in
   diesem Block steht, faellt trotzdem auf: die Probe haelt jeden GELESENEN
   Selektor gegen den wirklichen Vorschau- und Live-DOM, und zwar auch Glied
   fuer Glied, auf zwei gemeinsamen Boeden (die volle und die leere Seite) und
   dazu in den zwei Zustaenden, die es nur hier gibt (`waiting`,
   `unknown-skin` - der Wartehinweis darunter). Gelesen wird dabei jedes
   Stylesheet und jeder `<style>`-Block - ein- wie mehrzeilig geschrieben -
   unter `apps/visu` und `packages` sowie in den drei per `link:` eingebundenen
   Skin-Paketen, jeweils samt der `@import`-Kette dieser Blaetter; also auch das
   ausgelieferte `index.html` und das globale `link-affordance.css`.

   GRENZEN, damit niemand mehr hineinliest, als dort gemessen wird: das ist ein
   QUELLTEXT-Vergleich, und der Wirkungsvergleich daneben misst, welcher
   SELEKTOR wo greift - nicht, welche Deklaration am Ende gewinnt. Ein
   jsdom-Lauf rechnet keine Stylesheets aus, also sind berechnete Stile aus
   globalen Blaettern und Pseudo-Elemente (`::before`/`::after`) unsichtbar
   (E3-3). Nicht gelesen wird ausserdem CSS, das erst ein Loader zur Laufzeit zu
   einem Blatt macht, und `gui/` - der Rahmen um die Vorschau; dessen
   Klassenliste, `style`-Attribut, Vorfahrenpfad und handgeschriebene Blaetter
   pinnt dafuer `gui/tests/components/visu/VisuPreviewFrame.spec.js`. Und ob eine
   groessenabhaengige Regel (`@media (max-width:…)`, `@container (width …)`) im
   schmalen Vorschau-`<iframe>` anders greift als auf der vollflaechigen Seite,
   kann jsdom nicht entscheiden - die Spec meldet solche Selektoren namentlich
   (E3-1). Diese zwei Grenzen misst Teil E als Szenario E3 (Pixel-Diff im echten
   Browser); dieser Block ist die Vorbedingung dafuer, nicht sein Ersatz.

   Der Inhalt: `.ion-page` ist `position: absolute; inset: 0`, der Kasten einer
   Ansicht, die den Viewport BESITZT. Hier liegt die Seite im scrollenden
   Shell-Content (#118), also zurueck in den Fluss - genau wie `.skin-page`. */
.preview-page {
  position: relative;
  contain: layout style;
}

.overview-root {
  display: block;
}

.preview-hint {
  margin: var(--obs-space, 12px);
  color: var(--ion-text-color, #1b2027);
  font: inherit;
  opacity: 0.7;
}
</style>
