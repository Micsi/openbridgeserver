/**
 * Pinia-Store: Regionalformat für die Visu (Issue #1073)
 *
 * Das Regionalformat ist eine eigene Server-Einstellung und bewusst *unabhängig*
 * von der UI-Sprache: Deutsch in der Schweiz formatiert `1'234.50`, Deutsch in
 * Deutschland `1.234,50`. Der Store lädt die öffentliche Display-Settings-Route
 * (auch ohne Login erreichbar, weil die Visu anonym/per PIN genutzt wird) und
 * stellt daraus abgeleitete Formatierer bereit.
 *
 * Nur Darstellung — Datenpunktwerte, Konfiguration, Berechnungen, API-Payloads
 * und History bleiben locale-neutrale Zahlen.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { displaySettings as displaySettingsApi } from '@/api/client'
import {
  FALLBACK_REGION_FORMAT,
  formatCurrency,
  formatNumber,
  formatPercent,
  resolveCurrency,
  resolveRegionFormat,
  type NumberFormatOptions,
} from '@/utils/numberFormat'

export const useFormatStore = defineStore('format', () => {
  const language = ref('de')
  // Holds the server-resolved format when the endpoint supplies one, otherwise
  // the raw setting (possibly `auto`) — `regionFormat` below resolves either.
  const regionFormatSetting = ref('auto')
  const currencySetting = ref('auto')
  const timezone = ref<string | null>(null)
  const loaded = ref(false)

  const regionFormat = computed(() => resolveRegionFormat(regionFormatSetting.value, language.value))
  const currency = computed(() => resolveCurrency(currencySetting.value, regionFormat.value))

  /** Load once at app start; failures keep the German defaults. */
  async function load(): Promise<void> {
    try {
      const data = await displaySettingsApi.get()
      language.value = data.language || language.value
      regionFormatSetting.value = data.resolved_region_format || data.region_format || regionFormatSetting.value
      currencySetting.value = data.resolved_currency || data.currency || currencySetting.value
      timezone.value = data.timezone || null
    } catch {
      // Visu stays usable with the fallback format when the route is unreachable.
    }
    loaded.value = true
  }

  function fmtNumber(value: unknown, options?: NumberFormatOptions): string {
    return formatNumber(value, regionFormat.value, options)
  }

  function fmtCurrency(value: unknown, options?: { decimals?: number }): string {
    return formatCurrency(value, regionFormat.value, currency.value, options)
  }

  function fmtPercent(value: unknown, options?: { decimals?: number }): string {
    return formatPercent(value, regionFormat.value, options)
  }

  /** Locale-aware date/time text for chart axes, tooltips and timestamps. */
  function fmtDateTime(value: number | string | Date, options?: Intl.DateTimeFormatOptions): string {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    // Server timezone as the default; an explicit caller option still wins.
    const intlOptions: Intl.DateTimeFormatOptions = timezone.value
      ? { timeZone: timezone.value, ...options }
      : { ...options }
    try {
      return new Intl.DateTimeFormat(regionFormat.value, intlOptions).format(date)
    } catch {
      // Unusable regional format — keep the configured timezone …
    }
    try {
      return new Intl.DateTimeFormat(FALLBACK_REGION_FORMAT, intlOptions).format(date)
    } catch {
      // … and only drop it when the timezone itself is the unusable part.
      return new Intl.DateTimeFormat(FALLBACK_REGION_FORMAT, options).format(date)
    }
  }

  return {
    language,
    regionFormatSetting,
    currencySetting,
    timezone,
    loaded,
    regionFormat,
    currency,
    load,
    fmtNumber,
    fmtCurrency,
    fmtPercent,
    fmtDateTime,
  }
})
