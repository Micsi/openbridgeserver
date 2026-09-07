<script setup>
/**
 * Der Seitenverlauf des V2-Editors (M5 C6, Issue #173, Messlatte E12).
 *
 * „Seitenversionen einsehbar, fruehere Version wiederherstellbar" - und die
 * Zusage dahinter lautet: **wiederherstellen ergibt exakt den alten `GET`**.
 *
 * WIE DAS EINGEHALTEN WIRD, in einem Satz: dieser Kasten schreibt nichts
 * Eigenes. Er liest einen alten Stand (`GET /visu/nodes/{id}/versions/{rev}`)
 * und legt ihn ueber denselben Weg ab, den auch der Canvas benutzt
 * (`PUT /visu/pages/{id}`). Es gibt keinen Restore-Endpunkt, weil es keinen
 * dritten Schreiber auf `page_config` geben soll
 * (Micsi/openbridgeserver#187) - und weil ein eigener Weg an der Validierung
 * des Seitentyp-Modells vorbeikaeme, die im `PUT` sitzt.
 *
 * DREI MELDUNGEN, und jede meint etwas anderes:
 *
 *  - `restore-start` geht hinaus, BEVOR die erste Anfrage laeuft. Die Ansicht
 *    nimmt daraufhin den Canvas vom Schirm: er haelt einen Entwurf, der von
 *    diesem Augenblick an nicht mehr die Seite beschreibt.
 *  - `restored` mit `{ ok: true }` geht erst hinaus, wenn die Seite
 *    ZURUECKGELESEN wurde und den alten Stand wirklich traegt. Ein 204 allein
 *    ist kein Beleg - dieselbe Lehre, die der Canvas in seiner Runde 1 teuer
 *    bezahlt hat.
 *  - `restored` mit `{ ok: false }` geht bei jedem Fehlschlag hinaus, damit die
 *    Ansicht den Canvas auch dann zurueckholt, wenn nichts geschrieben wurde.
 */
import { computed, onMounted, ref, watch } from 'vue'

import { visuApi } from '@/api/visu'
import { sameConfig } from '@/utils/visuPageJson'
import HelpButton from '@/components/ui/HelpButton.vue'

const props = defineProps({
  /** Die Seite, deren Verlauf gezeigt wird. Ohne sie gibt es keinen Verlauf. */
  pageId: { type: String, default: null },
})
const emit = defineEmits(['restore-start', 'restored'])

const open = ref(false)
const versions = ref([])
const loading = ref(false)
const errorKey = ref(null)
const busy = ref(false)

/** Die neueste Version ist der zuletzt GESPEICHERTE Stand - nicht zwingend der auf dem Schirm. */
const newestRevision = computed(() => (versions.value.length > 0 ? versions.value[0].revision : null))

/**
 * Den Verlauf holen - IM VORAUS, nicht erst beim Aufklappen.
 *
 * Der Grund ist eine Zusage, keine Optimierung: „Verlauf" ist ein Schalter und
 * kein Ladevorgang. Wer ihn drueckt, sieht die Liste, statt erst ein leeres
 * Feld zu sehen, das sich gleich fuellt. Das kostet eine Anfrage je gewaehlter
 * Seite und macht die Liste zu etwas, das der Editor HAT, statt zu etwas, das
 * er sich holen geht.
 *
 * Beim Auffrischen wird die vorhandene Liste NICHT geleert. Eine Liste, die
 * waehrend jeder Aktualisierung kurz verschwindet, ist waehrend dieser
 * Sekundenbruchteile eine falsche Aussage („diese Seite hat keinen Verlauf").
 */
async function loadVersions() {
  if (!props.pageId) return
  loading.value = true
  errorKey.value = null
  try {
    const { data } = await visuApi.pageVersions(props.pageId)
    versions.value = Array.isArray(data) ? data : []
  } catch {
    // Ein Fehlschlag ist NICHT „diese Seite hat keinen Verlauf": der Unterschied
    // entscheidet, ob der Autor es noch einmal versucht oder aufgibt.
    versions.value = []
    errorKey.value = 'load'
  } finally {
    loading.value = false
  }
}

function toggle() {
  open.value = !open.value
}

/**
 * Den Verlauf nachziehen, nachdem JEMAND ANDERES die Seite geschrieben hat.
 *
 * Aufgerufen wird das vom Canvas, und zwar BEVOR er „Gespeichert" meldet
 * (`afterSave` dort). Damit heisst diese Quittung: der Server traegt es, und der
 * Editor zeigt es - auch im Verlauf. Ohne diese Reihenfolge zeigte ein Blick in
 * den Verlauf unmittelbar nach dem Speichern den Stand von VOR dem Speichern,
 * und die Quittung waere eine halbe Wahrheit.
 */
defineExpose({ reload: loadVersions })

/**
 * Ein Zeitpunkt, wie ihn der Browser dieses Autors schreibt. Ein unlesbarer
 * Zeitstempel wird durchgereicht statt zu „Invalid Date" zu werden.
 */
function formatDate(iso) {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? String(iso ?? '') : at.toLocaleString()
}

/**
 * Wiederherstellen: alten Stand lesen, ablegen, zuruecklesen, pruefen.
 *
 * Der Vergleich am Ende ist der Kern. Ohne ihn hiesse „wiederhergestellt" nur
 * „der Server hat geantwortet", und genau daran ist der Canvas in Runde 1
 * gescheitert: er meldete Erfolg fuer eine Eingabe, die keinen Traeger gefunden
 * hatte.
 */
async function restore(revision) {
  if (!props.pageId || busy.value) return
  busy.value = true
  errorKey.value = null
  emit('restore-start')
  let ok = false
  try {
    const { data: alt } = await visuApi.pageVersion(props.pageId, revision)
    await visuApi.savePage(props.pageId, alt)
    const { data: server } = await visuApi.getPage(props.pageId)
    ok = sameConfig(server, alt)
    if (!ok) errorKey.value = 'restore'
  } catch {
    errorKey.value = 'restore'
  }
  if (ok) await loadVersions()
  busy.value = false
  emit('restored', { ok })
}

// Eine andere Seite hat einen anderen Verlauf. Der Kasten schliesst sich dabei:
// eine stehengebliebene Liste gehoerte zur vorigen Seite und waere die
// gefaehrlichste Sorte Anzeige - richtig aussehend und falsch.
watch(
  () => props.pageId,
  async () => {
    open.value = false
    versions.value = []
    errorKey.value = null
    await loadVersions()
  },
)

onMounted(loadVersions)
</script>

<template>
  <section
    v-if="pageId"
    data-testid="visu-page-history"
    class="visu-page-history flex flex-col gap-2"
  >
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 dark:border-slate-600 dark:text-slate-200"
        :aria-expanded="open ? 'true' : 'false'"
        @click="toggle"
      >
        {{ $t('visuEditor.history.toggle') }}
      </button>
      <HelpButton help-id="visu-versions" />
      <span
        v-if="busy"
        data-testid="editor-history-busy"
        class="text-xs text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.history.restoring') }}
      </span>
      <span
        v-if="errorKey"
        data-testid="editor-history-error"
        class="text-xs text-amber-600 dark:text-amber-400"
      >
        {{ errorKey === 'load' ? $t('visuEditor.history.loadError') : $t('visuEditor.history.restoreError') }}
      </span>
    </div>

    <div v-if="open">
      <!-- Die LISTE hat Vorrang vor dem Ladehinweis: beim Auffrischen bleibt
           stehen, was schon da ist. Der Hinweis gilt nur dem ersten Mal. -->
      <p
        v-if="versions.length === 0 && loading"
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.history.loading') }}
      </p>
      <p
        v-else-if="versions.length === 0 && !errorKey"
        data-testid="editor-history-empty"
        class="text-sm text-slate-500 dark:text-slate-400"
      >
        {{ $t('visuEditor.history.empty') }}
      </p>
      <ul
        v-else-if="versions.length > 0"
        class="flex flex-col gap-1"
      >
        <li
          v-for="version in versions"
          :key="version.revision"
          class="editor-version flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
          :data-revision="version.revision"
        >
          <span class="font-mono">{{ $t('visuEditor.history.entry', { revision: version.revision }) }}</span>
          <span class="text-slate-500 dark:text-slate-400">{{ formatDate(version.created_at) }}</span>
          <span
            v-if="version.created_by"
            class="text-slate-500 dark:text-slate-400"
          >{{ version.created_by }}</span>
          <span
            v-if="version.revision === newestRevision"
            class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
          >{{ $t('visuEditor.history.newest') }}</span>
          <button
            type="button"
            class="ml-auto rounded border border-slate-300 px-2 py-0.5 whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
            :disabled="busy"
            @click="restore(version.revision)"
          >
            {{ $t('visuEditor.history.restore') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
