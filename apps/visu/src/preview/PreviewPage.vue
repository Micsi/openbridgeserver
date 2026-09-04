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
 * `PreviewParity.spec.ts` haelt beide Wurzeln gegeneinander.
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

// Die App-Shell liegt auch im Vorschau-Modus um die Seite (App.vue). Sie zeichnet
// ihr Chrome auf der Flaeche des aktiven Skins - genau wie bei der echten Seite,
// die diese Naht fuellt. Ohne das saesse die Vorschau in einem Chrome, das eine
// andere Oberflaeche traegt als die Seite darin.
const shellContext = useShellContext();
watchEffect(() => {
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
/* Wie `.skin-page`: die Seite liegt im scrollenden Shell-Content, nicht im
   Outlet-eigenen Kasten (#118). */
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
