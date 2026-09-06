<script setup>
/**
 * Die Seiteneigenschaften des V2-Editors (M5 C1, Issue #168).
 *
 * Hier stehen die Messlatten-Zeilen **E9** (Seitentyp normal / Inkludeseite /
 * globale Inkludeseite / Popup), **E15** (Zugriff, PIN, Zielgruppe) und **E19**
 * (Skin je Seite) als Formular - und hier werden die verbotenen Kombinationen
 * ABGEFANGEN, bevor gespeichert wird: `store.problems` steht als Liste unter dem
 * Formular, und „Speichern" ist gesperrt, solange etwas gemeldet ist.
 *
 * Die Beschriftungen sind nicht frei gewaehlt - sie sind die Anforderung des
 * Playwright-Harness (`apps/visu/e2e/m5-editor-matrix.spec.ts`) und stehen in
 * den Locale-Dateien, nie im Template.
 *
 * Jede Beschriftung haengt per `for`/`id` an ihrem Bedienelement. Das ist keine
 * Formsache: `getByLabel` findet ein Feld nur ueber diese Verbindung, und ein
 * Screenreader ebenso.
 */
import { computed } from 'vue'

import { useVisuEditorStore } from '@/stores/visuEditor'
import { EDITOR_PAGE_KINDS, supportsIncludes, supportsPopup } from '@/utils/visuPageKind'
import { sortNodes } from '@/utils/visuPageTree'
import { VISU_SKIN_KEYS } from '@/utils/visuSkins'

const props = defineProps({
  /**
   * Laeuft gerade ein Wiederherstellen aus dem Verlauf? (M5 C6, Issue #173)
   *
   * Dann ist dieses Formular NICHT bedienbar. Der Grund ist derselbe, aus dem
   * die Ansicht waehrenddessen den Canvas vom Schirm nimmt: beide halten einen
   * Entwurf, der von der Sekunde des Klicks an nicht mehr die Seite beschreibt.
   * Der Canvas kann verschwinden, weil er neu aufgebaut wird; dieses Formular
   * bleibt stehen (es zeigt Name und Zugriff, nicht nur die Flaeche) - und
   * muesste ohne Sperre nur EINEN Klick abbekommen, um den Stand von vorher
   * ueber den wiederhergestellten zu schreiben. Genau das ist der dritte
   * Schreiber (Micsi/openbridgeserver#187), nur durch die Hintertuer.
   *
   * Vorgabe `false`: kein Aufrufer wird zur Sperre gezwungen, und die
   * C1-Montagen dieses Formulars bleiben unveraendert bedienbar.
   */
  restoring: { type: Boolean, default: false },
})

/** Die vier Stufen des OBS-Zugriffsmodells, in der Reihenfolge der Messlatte E15. */
const ACCESS_LEVELS = ['public', 'readonly', 'protected', 'user']

const store = useVisuEditorStore()
const draft = computed(() => store.draft)

/** Erbt dieser Knoten seinen Zugriff vom Elternknoten? (`access === null`) */
const inherits = computed(() => draft.value?.access == null)

/**
 * Die Seiten, die ueberhaupt als Include-Ziel taugen: eine andere Seite, kein
 * Ordner, kein Popup. Genau die drei Faelle lehnt das Backend mit 400 ab - der
 * Picker bietet sie deshalb gar nicht erst an (R14).
 */
const includeCandidates = computed(() => {
  if (!draft.value) return []
  return sortNodes(store.nodes).filter(
    (node) => node.type === 'PAGE' && node.id !== draft.value.id && node.kind !== 'popup',
  )
})

/** Die Auswahl EINER Include-Zeile: die Kandidaten ohne die Ziele der anderen Zeilen. */
function includeOptions(index) {
  const taken = new Set(draft.value.includes.filter((_, position) => position !== index))
  return includeCandidates.value.filter((node) => !taken.has(node.id))
}

/** Nutzer, die noch nicht in der Zielgruppe stehen. */
const addableUsers = computed(() =>
  store.allUsernames.filter((name) => !(draft.value?.usernames ?? []).includes(name)),
)

const problemText = (problem) => `visuEditor.problems.${problem.code}`

/**
 * Die Ablehnungen, die das Backend als CODE meldet und der Editor als SATZ zeigt.
 *
 * Zwei davon nimmt der Editor bewusst nicht vorweg: die Datenpunkt-Rechte der
 * Zielgruppe (`visu_target_audience_datapoints_denied`) waeren zwar abfragbar
 * (`POST /api/v1/authz/preview`), aber nur je Mitglied MAL Datenpunkt und bei
 * jedem Zugriffswechsel - siehe `draftBindsDatapoints` in `stores/visuEditor.js`;
 * und die Nutzerliste kann fehlen (`visu_target_audience_invalid_users` bei
 * nicht geladener Liste). Dann soll der Autor wenigstens lesen, was der
 * Server meint - samt Namen und Datenpunkten, die der Server mitschickt.
 */
const REJECTION_CODES = Object.freeze([
  'visu_target_audience_invalid_users',
  'visu_target_audience_datapoints_denied',
  'visu_target_audience_requires_user_access',
])

const rejectionKey = computed(() =>
  REJECTION_CODES.includes(store.saveError) ? `visuEditor.rejections.${store.saveError}` : null,
)

/** Was der Satz einer Ablehnung einsetzt - genau die Angaben aus dem `detail`. */
const rejectionParams = computed(() => {
  const detail = store.saveErrorDetail ?? {}
  const users = Array.isArray(detail.usernames) ? detail.usernames : []
  const datapoints = Array.isArray(detail.datapoint_ids) ? detail.datapoint_ids : []
  return {
    user: detail.username ?? users.join(', '),
    datapoints: datapoints.join(', '),
  }
})

/* ------------------------------------------------------------- Bedienung */

function onKind(event) {
  store.setEditorKind(event.target.value)
}

/** Eine Zahl oder `null` - ein geleertes Feld ist KEINE 0 (R2: dann zentriert der Host). */
function setPopupNumber(field, value) {
  const trimmed = String(value ?? '').trim()
  draft.value.popup[field] = trimmed === '' ? null : Number(trimmed)
}

function addInclude() {
  const next = includeCandidates.value.find((node) => !draft.value.includes.includes(node.id))
  draft.value.includes = [...draft.value.includes, next ? next.id : '']
}

function setInclude(index, value) {
  draft.value.includes = draft.value.includes.map((entry, position) =>
    position === index ? value : entry,
  )
}

function removeInclude(index) {
  draft.value.includes = draft.value.includes.filter((_, position) => position !== index)
}

/**
 * Der Zugriffswechsel raeumt die Zielgruppe mit weg. Ohne das entstuende genau
 * die Lage, die `update_node` mit 422 (`visu_target_audience_requires_user_access`)
 * ablehnt - und der Autor saehe einen Statuscode statt einer Erklaerung.
 */
function setAccess(value) {
  draft.value.access = value
  if (value !== 'user') draft.value.usernames = []
  if (value !== 'protected') draft.value.pin = ''
}

function setInherit(checked) {
  setAccess(checked ? null : 'public')
}

function addUser(event) {
  const name = event.target.value
  event.target.value = ''
  if (!name) return
  draft.value.usernames = [...draft.value.usernames, name]
}

const removeUser = (name) => {
  draft.value.usernames = draft.value.usernames.filter((entry) => entry !== name)
}

async function onSubmit() {
  // Der zweite Riegel neben dem `<fieldset disabled>`: ein Formular laesst sich
  // auch ohne seinen Knopf abschicken (Eingabetaste in einem Textfeld), und ein
  // gesperrtes Feld verhindert das Absenden nicht.
  if (props.restoring) return
  await store.save()
}
</script>

<template>
  <p
    v-if="!draft"
    data-testid="visu-props-empty"
    class="text-sm text-slate-500 dark:text-slate-400"
  >
    {{ $t('visuEditor.props.empty') }}
  </p>

  <form
    v-else
    class="visu-page-properties flex flex-col gap-3 text-sm"
    @submit.prevent="onSubmit"
  >
    <!-- EIN `<fieldset disabled>` statt eines `disabled` je Feld: das ist die
         HTML-Antwort auf „diese Gruppe ist gerade nicht bedienbar", sie gilt
         fuer jedes Bedienelement darin (auch fuer jedes kuenftige) und sie
         reicht bis in die Tastaturbedienung. `contents` haelt das Gitter des
         Formulars unveraendert - das Feldgruppen-Element selbst nimmt keinen
         Platz ein und aendert keine Anordnung. -->
    <fieldset
      data-testid="visu-props-fields"
      class="contents"
      :disabled="restoring"
    >
      <h2 class="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {{ $t('visuEditor.props.title') }}
      </h2>

      <div class="flex flex-col gap-1">
        <label
          for="visu-prop-name"
          class="label"
        >{{ $t('visuEditor.props.name') }}</label>
        <input
          id="visu-prop-name"
          v-model="draft.name"
          class="input"
          type="text"
        >
      </div>

      <div class="flex flex-col gap-1">
        <label
          for="visu-prop-order"
          class="label"
        >{{ $t('visuEditor.props.order') }}</label>
        <input
          id="visu-prop-order"
          class="input"
          type="number"
          :value="draft.order"
          @input="draft.order = Number($event.target.value || 0)"
        >
      </div>

      <div
        v-if="draft.type === 'PAGE'"
        class="flex flex-col gap-1"
      >
        <label
          for="visu-prop-kind"
          class="label"
        >{{ $t('visuEditor.props.kind') }}</label>
        <select
          id="visu-prop-kind"
          class="input"
          :value="draft.editorKind"
          @change="onKind"
        >
          <option
            v-for="kind in EDITOR_PAGE_KINDS"
            :key="kind"
            :value="kind"
          >{{ $t(`visuEditor.kind.${kind}`) }}</option>
        </select>
      </div>

      <!-- Popup-Eigenschaften (R2-R6) - nur beim Seitentyp Popup, und zwar aus dem
           DOM heraus, nicht nur verborgen: ein verstecktes Feld waere ein Wert,
           den das Backend an einem Nicht-Popup mit 400 ablehnt. -->
      <fieldset
        v-if="supportsPopup(draft.editorKind)"
        data-testid="visu-props-popup"
        class="flex flex-col gap-2 rounded border border-slate-200 dark:border-slate-700 p-2"
      >
        <p class="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          {{ $t('visuEditor.props.popupSection') }}
        </p>
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <label
              for="visu-prop-popup-x"
              class="label"
            >{{ $t('visuEditor.props.x') }}</label>
            <input
              id="visu-prop-popup-x"
              class="input"
              type="number"
              :value="draft.popup.x ?? ''"
              @input="setPopupNumber('x', $event.target.value)"
            >
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="visu-prop-popup-y"
              class="label"
            >{{ $t('visuEditor.props.y') }}</label>
            <input
              id="visu-prop-popup-y"
              class="input"
              type="number"
              :value="draft.popup.y ?? ''"
              @input="setPopupNumber('y', $event.target.value)"
            >
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="visu-prop-popup-w"
              class="label"
            >{{ $t('visuEditor.props.width') }}</label>
            <input
              id="visu-prop-popup-w"
              class="input"
              type="number"
              :value="draft.popup.w ?? ''"
              @input="setPopupNumber('w', $event.target.value)"
            >
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="visu-prop-popup-h"
              class="label"
            >{{ $t('visuEditor.props.height') }}</label>
            <input
              id="visu-prop-popup-h"
              class="input"
              type="number"
              :value="draft.popup.h ?? ''"
              @input="setPopupNumber('h', $event.target.value)"
            >
          </div>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {{ $t('visuEditor.props.centerHint') }}
        </p>

        <div class="flex flex-col gap-1">
          <label
            for="visu-prop-popup-autoclose"
            class="label"
          >{{ $t('visuEditor.props.autoClose') }}</label>
          <input
            id="visu-prop-popup-autoclose"
            class="input"
            type="number"
            :value="draft.popup.auto_close_ms ?? ''"
            @input="setPopupNumber('auto_close_ms', $event.target.value)"
          >
        </div>

        <div class="flex items-center gap-2">
          <input
            id="visu-prop-popup-modal"
            v-model="draft.popup.modal"
            type="checkbox"
          >
          <label for="visu-prop-popup-modal">{{ $t('visuEditor.props.modal') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="visu-prop-popup-animate"
            v-model="draft.popup.animate"
            type="checkbox"
          >
          <label for="visu-prop-popup-animate">{{ $t('visuEditor.props.animate') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="visu-prop-popup-shadow"
            v-model="draft.popup.shadow"
            type="checkbox"
          >
          <label for="visu-prop-popup-shadow">{{ $t('visuEditor.props.shadow') }}</label>
        </div>
        <div class="flex items-center gap-2">
          <input
            id="visu-prop-popup-dim"
            v-model="draft.popup.dim_backdrop"
            type="checkbox"
          >
          <label for="visu-prop-popup-dim">{{ $t('visuEditor.props.dimBackdrop') }}</label>
        </div>
      </fieldset>

      <!-- Includes (R13/R14). Der Knopf steht auch bei einem Seitentyp da, der gar
           nicht inkludieren darf: genau daran zeigt der Editor die verbotene
           Kombination, statt sie zu verstecken (Messlatte E9). -->
      <div
        v-if="draft.type === 'PAGE'"
        class="flex flex-col gap-2 rounded border border-slate-200 dark:border-slate-700 p-2"
      >
        <p class="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          {{ $t('visuEditor.props.includesSection') }}
        </p>

        <div
          v-for="(target, index) in draft.includes"
          :key="`include-${index}`"
          data-include-row
          class="flex items-center gap-2"
        >
          <label
            :for="`visu-prop-include-${index}`"
            class="sr-only"
          >{{ $t('visuEditor.props.includeTarget', { index: index + 1 }) }}</label>
          <select
            :id="`visu-prop-include-${index}`"
            class="input"
            :value="target"
            @change="setInclude(index, $event.target.value)"
          >
            <option
              v-for="node in includeOptions(index)"
              :key="node.id"
              :value="node.id"
            >{{ node.name }}</option>
          </select>
          <button
            type="button"
            data-action="remove-include"
            class="rounded px-1 text-xs text-rose-600 dark:text-rose-400"
            :aria-label="$t('visuEditor.props.removeInclude', { name: target })"
            @click="removeInclude(index)"
          >&#10005;</button>
        </div>

        <button
          type="button"
          data-testid="visu-props-add-include"
          class="btn-secondary self-start text-xs"
          @click="addInclude"
        >
          {{ $t('visuEditor.props.addInclude') }}
        </button>
        <p
          v-if="includeCandidates.length === 0"
          class="text-xs text-slate-500 dark:text-slate-400"
        >
          {{ $t('visuEditor.props.noIncludeTargets') }}
        </p>

        <div
          v-if="supportsIncludes(draft.editorKind)"
          class="flex items-center gap-2"
        >
          <input
            id="visu-prop-ignore-global"
            v-model="draft.ignoreGlobalIncludes"
            type="checkbox"
          >
          <label for="visu-prop-ignore-global">{{ $t('visuEditor.props.ignoreGlobal') }}</label>
        </div>
      </div>

      <!-- Zugriff, PIN, Zielgruppe (E15). -->
      <div class="flex flex-col gap-2 rounded border border-slate-200 dark:border-slate-700 p-2">
        <p class="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
          {{ $t('visuEditor.props.accessSection') }}
        </p>

        <div class="flex items-center gap-2">
          <input
            id="visu-prop-inherit"
            type="checkbox"
            :checked="inherits"
            @change="setInherit($event.target.checked)"
          >
          <label for="visu-prop-inherit">{{ $t('visuEditor.props.inherit') }}</label>
        </div>

        <div class="flex flex-col gap-1">
          <label
            for="visu-prop-access"
            class="label"
          >{{ $t('visuEditor.props.access') }}</label>
          <select
            id="visu-prop-access"
            class="input"
            :disabled="inherits"
            :value="draft.access ?? ''"
            @change="setAccess($event.target.value)"
          >
            <option
              v-for="level in ACCESS_LEVELS"
              :key="level"
              :value="level"
            >{{ $t(`visuEditor.access.${level}`) }}</option>
          </select>
        </div>

        <div
          v-if="draft.access === 'protected'"
          class="flex flex-col gap-1"
        >
          <label
            for="visu-prop-pin"
            class="label"
          >{{ $t('visuEditor.props.pin') }}</label>
          <input
            id="visu-prop-pin"
            v-model="draft.pin"
            class="input"
            type="password"
            autocomplete="new-password"
          >
          <!-- Der BLEIBENDE Fundort fuer eine geschuetzte Seite ohne PIN (C6,
               E18). Die Meldung des Imports ist fluechtig - sie verschwindet
               beim ersten Seitenwechsel; dieser Zustand ist es nicht. Das leere
               Feld darueber unterscheidet nichts: es steht auch dann leer, wenn
               eine PIN gesetzt ist, denn der Hash geht nie an den Browser. -->
          <p
            v-if="draft.hasPin === false"
            data-testid="visu-props-no-pin"
            class="text-xs text-amber-600 dark:text-amber-400"
          >
            {{ $t('visuEditor.props.noPinYet') }}
          </p>
        </div>

        <div class="flex flex-col gap-1">
          <label
            for="visu-prop-audience"
            class="label"
          >{{ $t('visuEditor.props.audience') }}</label>
          <!-- Die Liste ist das beschriftete Bedienelement (Harness + Screenreader);
               die Knoepfe darunter tragen die Aktion, die ein <select> nicht kann. -->
          <select
            id="visu-prop-audience"
            class="input"
            multiple
            size="3"
            :disabled="draft.access !== 'user'"
          >
            <option
              v-for="name in draft.usernames"
              :key="name"
              :value="name"
            >{{ name }}</option>
          </select>
          <p
            v-if="draft.access === 'user' && store.draftBindsDatapoints"
            data-testid="visu-props-audience-datapoint-hint"
            class="text-xs text-slate-500 dark:text-slate-400"
          >
            {{ $t('visuEditor.props.audienceDatapointHint') }}
          </p>
          <ul
            v-if="draft.usernames.length > 0"
            class="flex flex-wrap gap-1"
          >
            <li
              v-for="name in draft.usernames"
              :key="name"
            >
              <button
                type="button"
                data-action="remove-user"
                class="rounded bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 text-xs"
                :aria-label="$t('visuEditor.props.removeUser', { name })"
                @click="removeUser(name)"
              >{{ name }} &#10005;</button>
            </li>
          </ul>
        </div>

        <div class="flex flex-col gap-1">
          <label
            for="visu-prop-add-user"
            class="label"
          >{{ $t('visuEditor.props.addUser') }}</label>
          <select
            id="visu-prop-add-user"
            class="input"
            :disabled="draft.access !== 'user'"
            @change="addUser"
          >
            <option value="" />
            <option
              v-for="name in addableUsers"
              :key="name"
              :value="name"
            >{{ name }}</option>
          </select>
        </div>
      </div>

      <!-- Skin je Seite (E19). -->
      <div
        v-if="draft.type === 'PAGE'"
        class="flex flex-col gap-1"
      >
        <label
          for="visu-prop-skin"
          class="label"
        >{{ $t('visuEditor.props.skin') }}</label>
        <select
          id="visu-prop-skin"
          class="input"
          :value="store.skin"
          @change="store.setSkin($event.target.value)"
        >
          <option
            v-for="key in VISU_SKIN_KEYS"
            :key="key"
            :value="key"
          >{{ key }}</option>
        </select>
        <!-- Der Hinweis MUSS vor und nach dem Merge von Teil C2 stimmen, deshalb
             haengt er an derselben Erkennung wie die Naht selbst: solange
             `PageConfig` kein Skin-Feld fuehrt, lebt die Wahl im Browser des
             Autors; sobald das Feld da ist, gehoert sie der Seite. Ohne diese
             Fallunterscheidung waere ein fester Satz nach dem Merge eine
             Falschaussage, und
             niemand haette einen Anlass, ihn nachzuziehen (gepinnt in
             `tests/components/visu/VisuPageProperties.spec.js`, E19). -->
        <p
          data-testid="visu-props-skin-hint"
          :data-skin-storage="store.skinSupported ? 'page' : 'browser'"
          class="text-xs text-slate-500 dark:text-slate-400"
        >
          {{ store.skinSupported ? $t('visuEditor.props.skinHintPage') : $t('visuEditor.props.skinHintBrowser') }}
        </p>
      </div>

      <ul
        v-if="store.problems.length > 0"
        class="flex flex-col gap-1"
      >
        <li
          v-for="problem in store.problems"
          :key="`${problem.code}-${problem.params?.target ?? ''}`"
          :data-problem="problem.code"
          class="text-sm text-rose-600 dark:text-rose-400"
        >
          {{ $t(problemText(problem), problem.params ?? {}) }}
        </li>
      </ul>

      <p
        v-if="store.saveError"
        data-testid="visu-props-error"
        class="text-sm text-rose-600 dark:text-rose-400"
      >
        {{ $t('visuEditor.props.saveFailed') }}
        {{ rejectionKey ? $t(rejectionKey, rejectionParams) : store.saveError }}
      </p>

      <div class="flex items-center gap-2">
        <button
          type="submit"
          data-testid="visu-props-save"
          class="btn-primary text-xs"
          :disabled="!store.canSave"
        >
          {{ $t('visuEditor.props.save') }}
        </button>
        <span
          v-if="store.savedAt"
          data-testid="visu-props-saved"
          class="text-sm text-emerald-600 dark:text-emerald-400"
        >{{ $t('visuEditor.props.saved') }}</span>
      </div>
    </fieldset>
  </form>
</template>
