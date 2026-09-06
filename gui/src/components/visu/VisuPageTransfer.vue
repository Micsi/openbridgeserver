<script setup>
/**
 * Export und Import einer Seite als Datei (M5 C6, Issue #173, Messlatte E18).
 *
 * „Seite/Vorlage als Datei export-/importierbar", und die Zusage dahinter:
 * **Export gefolgt von Import ergibt dieselbe Seite.**
 *
 * KEIN neuer Endpunkt. Exportiert wird ueber `GET /visu/nodes/{id}/export`
 * (Seite samt allem, was darunter haengt), eingelesen ueber
 * `POST /visu/nodes/import`. Der Import vergibt neue Ids und haengt den Teilbaum
 * an die oberste Ebene: die Datei ist eine vollstaendige Seite und kein Verweis
 * auf die bestehende - der Baum traegt sie danach ein zweites Mal.
 *
 * IST DER NAME SCHON VERGEBEN, bekommt die eingelesene Wurzel einen freien
 * (`uniqueImportName`). Zwei Zeilen mit demselben Namen kann der Autor nicht
 * auseinanderhalten; das Backend verlangt beim Kopieren aus genau diesem Grund
 * einen neuen Namen (`CopyNodeRequest.new_name` ist Pflicht). In eine frische
 * Instanz eingelesen bleibt der Name unveraendert - dort gibt es nichts zu
 * unterscheiden.
 *
 * WAS HIER ABGELEHNT WIRD, statt es dem Backend zu ueberlassen: eine Datei, die
 * gar kein Visu-Export ist. Sie liefe dort in einen 400, den der Autor nicht
 * mehr seinem Griff in den falschen Ordner zuordnen kann.
 *
 * WAS DIE ERFOLGSMELDUNG NICHT SAGT: den Namen der importierten Seite. Er steht
 * nach dem Import im Baum, und eine Meldung daneben waere ein weiterer Fundort
 * desselben Namens - eine Suche nach ihm faende dann mehr als die Seiten.
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { visuApi } from '@/api/visu'
import { useVisuEditorStore } from '@/stores/visuEditor'
import {
  exportFileName,
  readExportDocument,
  triggerJsonDownload,
  uniqueImportName,
} from '@/utils/visuPageTransfer'

const props = defineProps({
  /** Die Seite, die exportiert wird. Der IMPORT braucht sie nicht. */
  pageId: { type: String, default: null },
})
const emit = defineEmits(['imported'])

const { t } = useI18n()
const editor = useVisuEditorStore()

const importing = ref(false)
const busy = ref(false)
const errorKey = ref(null)
const done = ref(false)
const fileInput = ref(null)
const chosen = ref(null)

async function exportPage() {
  if (!props.pageId || busy.value) return
  busy.value = true
  errorKey.value = null
  done.value = false
  try {
    const { data } = await visuApi.exportNode(props.pageId)
    // Der Name kommt aus dem Export selbst: der Wurzelknoten ist die Seite, die
    // der Autor gerade offen hat, und der Editor muss ihn nicht zweimal wissen.
    const name = Array.isArray(data?.nodes) && data.nodes.length > 0 ? data.nodes[0].name : ''
    triggerJsonDownload(data, exportFileName(name))
  } catch {
    errorKey.value = 'export'
  } finally {
    busy.value = false
  }
}

function openImport() {
  importing.value = true
  errorKey.value = null
  done.value = false
  chosen.value = null
}

function cancelImport() {
  importing.value = false
  chosen.value = null
  errorKey.value = null
}

function onFile(event) {
  const files = event?.target?.files
  chosen.value = files && files.length > 0 ? files[0] : null
  errorKey.value = null
}

async function startImport() {
  if (busy.value) return
  errorKey.value = null
  done.value = false
  const gelesen = await readExportDocument(chosen.value)
  if (!gelesen.ok) {
    errorKey.value = gelesen.reason === 'missing' ? 'noFile' : 'invalid'
    return
  }
  busy.value = true
  try {
    // Die oberste Ebene ist das Ziel: der Import legt eine EIGENE Seite an, und
    // wo sie hingehoert, entscheidet der Autor danach im Baum (Verschieben).
    //
    // Die Wurzel bekommt einen freien Namen, falls ihrer schon vergeben ist
    // (siehe `uniqueImportName`): zwei gleichnamige Zeilen im Baum sind fuer
    // den Autor nicht auseinanderzuhalten. Die Seiten UNTER ihr behalten ihre
    // Namen; sie sind durch ihren Elternknoten unterschieden.
    const [wurzel, ...rest] = gelesen.document.nodes
    const name = uniqueImportName(
      wurzel.name,
      editor.nodes.map((node) => node.name),
      (basis, index) => t('visuEditor.transfer.copyName', { name: basis, index }),
    )
    await visuApi.importNodes({
      ...gelesen.document,
      nodes: [{ ...wurzel, name }, ...rest],
      target_parent_id: null,
    })
    importing.value = false
    chosen.value = null
    done.value = true
    emit('imported')
  } catch {
    errorKey.value = 'import'
  } finally {
    busy.value = false
  }
}

// Ein Seitenwechsel raeumt eine halb begonnene Ausfuhr-Meldung weg: sie gehoerte
// zur vorigen Seite.
watch(
  () => props.pageId,
  () => {
    errorKey.value = null
    done.value = false
  },
)
</script>

<template>
  <section
    data-testid="visu-page-transfer"
    class="visu-page-transfer flex flex-col gap-2"
  >
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-if="pageId"
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="busy"
        @click="exportPage"
      >
        {{ $t('visuEditor.transfer.export') }}
      </button>
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
        :disabled="busy"
        @click="openImport"
      >
        {{ $t('visuEditor.transfer.import') }}
      </button>
      <span
        v-if="done"
        data-testid="editor-transfer-done"
        class="text-xs text-emerald-600 dark:text-emerald-400"
      >
        {{ $t('visuEditor.transfer.imported') }}
      </span>
      <span
        v-if="errorKey"
        data-testid="editor-transfer-error"
        class="text-xs text-amber-600 dark:text-amber-400"
      >
        {{ $t(`visuEditor.transfer.${errorKey}Error`) }}
      </span>
    </div>

    <div
      v-if="importing"
      class="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-2 dark:border-slate-700"
    >
      <div class="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
        <label for="visu-import-file">{{ $t('visuEditor.transfer.file') }}</label>
        <input
          id="visu-import-file"
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="text-sm text-slate-700 dark:text-slate-200"
          @change="onFile"
        >
      </div>
      <button
        type="button"
        class="rounded bg-sky-600 px-2 py-1 text-sm whitespace-nowrap text-white disabled:opacity-40"
        :disabled="busy"
        @click="startImport"
      >
        {{ $t('visuEditor.transfer.start') }}
      </button>
      <button
        type="button"
        class="rounded border border-slate-300 px-2 py-1 text-sm whitespace-nowrap text-slate-700 dark:border-slate-600 dark:text-slate-200"
        @click="cancelImport"
      >
        {{ $t('visuEditor.transfer.cancel') }}
      </button>
      <p class="w-full text-xs text-slate-500 dark:text-slate-400">
        {{ $t('visuEditor.transfer.hint') }}
      </p>
    </div>
  </section>
</template>
