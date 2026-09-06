<script setup>
/**
 * Das Bindungsformular eines Elements (Messlatten **E11** und **E16**, #170).
 *
 * Ein Formular je Kern-Typ - aber KEIN Formular je Kern-Typ im Code: gerendert
 * wird die Feldbeschreibung aus `visuWidgetTypes.js`, die ihrerseits aus Vertrag
 * und Abbildung der Visu abgeleitet ist. Ein neuer Typ oder ein neuer
 * Konfig-Schluessel aendert deshalb Daten, nicht diese Datei (Goldene Regel:
 * Daten = JSON, Verhalten = Code).
 *
 * Das Formular MUTIERT nichts: jede Eingabe meldet eine neue Fassung des
 * Widgets nach oben (`update:widget`). Der Editor legt sie in den Entwurf, die
 * Bruecke schickt den Entwurf in die Vorschau - so und nur so entsteht der
 * Live-Wert im Vorschaubild (E11).
 *
 * Die Sichtbarkeitsregel (E16) steht im selben Formular, weil sie zum Element
 * gehoert: ein Datenpunkt, ein Vergleich, eine Schwelle. Der Autor tippt den
 * NAMEN des Datenpunkts; gespeichert wird die Id, denn Namen aendern sich.
 */
import { computed, ref, watch } from 'vue'

import { searchApi } from '@/api/client'
import VisuDatapointPicker from '@/components/visu/VisuDatapointPicker.vue'
import HelpButton from '@/components/ui/HelpButton.vue'
import { coreTypeOf, readField, widgetFormFields, writeField, WIDGET_FORMS } from '@/utils/visuWidgetTypes'
import { VISIBILITY_OPS, normalizeRule, readVisibilityRule, writeVisibilityRule } from '@/utils/visuVisibility'

const props = defineProps({
  /** Das ausgewaehlte Element in Backend-Form. */
  widget: { type: Object, required: true },
})
const emit = defineEmits(['update:widget'])

const coreType = computed(() => coreTypeOf(props.widget))
const fields = computed(() => (coreType.value ? widgetFormFields(coreType.value) : []))
const previewMapped = computed(() =>
  coreType.value ? WIDGET_FORMS[coreType.value].previewMapped : false,
)
const feldId = (key) => `binding-${props.widget.id}-${key}`

function setzeFeld(field, value) {
  emit('update:widget', writeField(props.widget, field, value))
}

function setzeNamen(event) {
  emit('update:widget', { ...props.widget, name: event.target.value })
}

/* ------------------------------------------------------ Sichtbarkeitsregel */

const regelOffen = ref(false)
const regel = readVisibilityRule(props.widget)
const regelDatapoint = ref(regel ? regel.datapoint_id : '')
const regelOp = ref(regel ? regel.op : '')
const regelSchwelle = ref(regel && regel.value !== undefined ? String(regel.value) : '')
/** Aufgeloeste Id des eingetippten Namens; null = noch nichts, '' = unbekannt. */
const aufgeloest = ref(regel ? regel.datapoint_id : null)
const unbekannt = ref(false)

const regelId = (key) => `visibility-${props.widget.id}-${key}`

/**
 * Den eingetippten Namen zu einer Id aufloesen. Exakt: ein Teiltreffer waere
 * eine Bindung, die der Autor nicht gewaehlt hat.
 */
async function aufloesen(name) {
  const gesucht = (name || '').trim()
  if (!gesucht) {
    aufgeloest.value = null
    unbekannt.value = false
    return
  }
  try {
    const { data } = await searchApi.search({ q: gesucht, page: 0, size: 50, sort: 'name', order: 'asc' })
    const treffer = (data?.items ?? []).find((item) => item.name === gesucht)
    aufgeloest.value = treffer ? treffer.id : null
    unbekannt.value = !treffer
  } catch {
    aufgeloest.value = null
    unbekannt.value = true
  }
}

/** Die Regel schreiben, sobald sie vollstaendig ist - halbe Regeln nicht. */
function regelSchreiben() {
  const kandidat = normalizeRule({
    datapoint_id: aufgeloest.value,
    op: regelOp.value,
    value: regelSchwelle.value,
  })
  if (!kandidat) return
  emit('update:widget', writeVisibilityRule(props.widget, kandidat))
}

function regelEntfernen() {
  regelDatapoint.value = ''
  regelOp.value = ''
  regelSchwelle.value = ''
  aufgeloest.value = null
  unbekannt.value = false
  emit('update:widget', writeVisibilityRule(props.widget, null))
}

watch(regelDatapoint, async (name) => {
  await aufloesen(name)
  regelSchreiben()
})
watch([regelOp, regelSchwelle], () => regelSchreiben())
</script>

<template>
  <section
    class="binding-form flex flex-col gap-3"
    data-testid="visu-binding-form"
  >
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {{ $t('visuEditor.binding.title') }}
      </h2>
      <HelpButton help-id="visu-datapoint-binding" />
    </div>

    <div class="flex flex-col gap-1">
      <label
        :for="`binding-${widget.id}-name`"
        class="text-xs text-slate-500 dark:text-slate-400"
      >{{ $t('visuEditor.binding.name') }}</label>
      <input
        :id="`binding-${widget.id}-name`"
        class="binding-name rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        type="text"
        :value="widget.name"
        @input="setzeNamen"
      >
    </div>

    <p
      v-if="coreType && !previewMapped"
      class="binding-not-rendered text-xs text-amber-600 dark:text-amber-400"
    >
      {{ $t('visuEditor.palette.notRendered') }}
    </p>
    <p
      v-if="!coreType"
      class="binding-unknown-type text-xs text-slate-500 dark:text-slate-400"
    >
      {{ $t('visuEditor.binding.unknownType') }}
    </p>

    <div
      v-for="field in fields"
      :key="field.key"
      class="binding-field flex flex-col gap-1"
      :data-field="field.key"
    >
      <!-- Bei einem Datenpunkt-Feld ist die Schaltflaeche des Waehlers das
           bedienbare Element; sie traegt deshalb die Id, auf die das Etikett
           zeigt (ein `<button>` ist beschriftbar). -->
      <label
        :for="field.kind === 'datapoint' ? `${feldId(field.key)}-open` : feldId(field.key)"
        class="text-xs text-slate-500 dark:text-slate-400"
      >{{ $t(field.labelKey) }}</label>

      <VisuDatapointPicker
        v-if="field.kind === 'datapoint'"
        :id-prefix="feldId(field.key)"
        :model-value="readField(widget, field) || null"
        @update:model-value="setzeFeld(field, $event)"
      />
      <input
        v-else-if="field.kind === 'flag'"
        :id="feldId(field.key)"
        type="checkbox"
        class="h-4 w-4"
        :checked="Boolean(readField(widget, field))"
        @change="setzeFeld(field, $event.target.checked)"
      >
      <select
        v-else-if="field.kind === 'choice'"
        :id="feldId(field.key)"
        class="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        :value="readField(widget, field)"
        @change="setzeFeld(field, $event.target.value)"
      >
        <option
          v-for="option in field.choices"
          :key="option"
          :value="option"
        >
          {{ $t(`visuEditor.fieldOptions.${option}`) }}
        </option>
      </select>
      <input
        v-else
        :id="feldId(field.key)"
        type="text"
        class="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
        :value="readField(widget, field)"
        @input="setzeFeld(field, $event.target.value)"
      >
    </div>

    <div class="flex flex-col gap-2">
      <button
        type="button"
        class="visibility-toggle self-start rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        @click="regelOffen = !regelOffen"
      >
        {{ $t('visuEditor.visibility.button') }}
      </button>

      <div
        v-if="regelOffen"
        class="visibility-rule flex flex-col gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-700"
      >
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('visuEditor.visibility.hint') }}
        </p>
        <div class="flex flex-col gap-1">
          <label
            :for="regelId('datapoint')"
            class="text-xs text-slate-500 dark:text-slate-400"
          >{{ $t('visuEditor.visibility.datapoint') }}</label>
          <input
            :id="regelId('datapoint')"
            v-model="regelDatapoint"
            class="visibility-datapoint rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
            type="text"
          >
          <p
            v-if="unbekannt"
            class="visibility-unknown text-xs text-amber-600 dark:text-amber-400"
          >
            {{ $t('visuEditor.visibility.unknown') }}
          </p>
        </div>
        <div class="flex flex-col gap-1">
          <label
            :for="regelId('op')"
            class="text-xs text-slate-500 dark:text-slate-400"
          >{{ $t('visuEditor.visibility.condition') }}</label>
          <select
            :id="regelId('op')"
            v-model="regelOp"
            class="visibility-op rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="">
              {{ $t('visuEditor.visibility.chooseCondition') }}
            </option>
            <option
              v-for="op in VISIBILITY_OPS"
              :key="op"
              :value="op"
            >
              {{ $t(`visuEditor.visibility.ops.${op}`) }}
            </option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label
            :for="regelId('threshold')"
            class="text-xs text-slate-500 dark:text-slate-400"
          >{{ $t('visuEditor.visibility.threshold') }}</label>
          <input
            :id="regelId('threshold')"
            v-model="regelSchwelle"
            class="visibility-threshold rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
            type="text"
          >
        </div>
        <button
          type="button"
          class="visibility-remove self-start text-sm text-slate-500 underline dark:text-slate-400"
          @click="regelEntfernen"
        >
          {{ $t('visuEditor.visibility.remove') }}
        </button>
      </div>
    </div>
  </section>
</template>
