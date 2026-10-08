<template>
  <span class="flex min-w-0 flex-1 items-center gap-2" :title="tooltip" data-testid="dp-path-row">
    <span class="min-w-0 flex-1">
      <span
        v-for="(line, i) in lines"
        :key="i"
        class="block overflow-hidden text-ellipsis whitespace-pre"
        data-testid="dp-path-line"
      >{{ line }}</span>
    </span>
    <span
      v-if="row.groupAddress"
      class="shrink-0 font-mono text-xs text-blue-700 dark:text-blue-300"
      data-testid="dp-path-ga"
    >{{ row.groupAddress }}</span>
    <span
      v-if="row.label === null"
      class="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500 dark:bg-slate-700/60 dark:text-slate-300"
      data-testid="dp-path-several"
    >{{ $t('datapoints.picker.severalPaths') }}</span>
    <span
      v-else-if="row.ambiguous"
      class="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
      data-testid="dp-path-ambiguous"
    >{{ $t('datapoints.picker.ambiguous') }}</span>
    <span v-if="showType" class="shrink-0 text-xs text-slate-500">{{ row.datapoint.data_type }}</span>
    <span v-if="showType && row.datapoint.unit" class="shrink-0 text-xs text-slate-600">{{ row.datapoint.unit }}</span>
  </span>
</template>

<script setup>
// One datapoint line of a picker (#1266): the row datapointPathRows() built –
// its path with the name once, the group address only where two lines would
// otherwise read the same, a hint where the main path is undecided. The
// tooltip names every path and the command group address.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useKnxProjectStore } from '@/stores/knxProject'
import { formatGa } from '@/utils/groupAddress'
import { datapointRowLines } from '@/utils/hierarchyDisplay'

const props = defineProps({
  row: { type: Object, required: true },
  showType: { type: Boolean, default: true },
})

const { t } = useI18n()
const knxProject = useKnxProjectStore()

const lines = computed(() => datapointRowLines(props.row))

const tooltip = computed(() => {
  const paths = props.row.paths.length ? props.row.paths : [props.row.datapoint.name]
  const command = props.row.datapoint.group_address
  if (!command) return paths.join('\n')
  return [...paths, t('datapoints.picker.groupAddressTitle', { ga: formatGa(command, knxProject.groupAddressStyle) })].join('\n')
})
</script>
