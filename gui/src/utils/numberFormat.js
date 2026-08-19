/**
 * Locale-aware number/currency display formatting (issue #1073).
 *
 * The formatting locale is the *regional format* setting, which is deliberately
 * independent of the UI language: a German UI in Switzerland shows `1'234.50`,
 * the same German UI in Germany shows `1.234,50`.
 *
 * These helpers are display-only. Datapoint values, calculations, API payloads,
 * CSV/JSON exports and stored history must keep using locale-neutral numbers.
 */

export const FALLBACK_REGION_FORMAT = 'de-DE'

/** Typographic separator between number and percent sign. */
const NARROW_NBSP = '\u202F'

const formatterCache = new Map()

function getFormatter(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, options)
    } catch {
      formatter = new Intl.NumberFormat(FALLBACK_REGION_FORMAT, options)
    }
    formatterCache.set(key, formatter)
  }
  return formatter
}

/**
 * Coerce a value to a finite number, or return `null` when it is not numeric.
 * Booleans are not numbers here — they are rendered as labels, not values.
 */
export function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Format a number for display.
 *
 * @param {unknown} value              value to format
 * @param {string}  locale             BCP-47 regional format, e.g. `de-CH`
 * @param {object}  [options]
 * @param {number|null} [options.decimals]  fixed fraction digits; `null` keeps
 *                                          the value's own precision
 * @param {boolean} [options.grouping] thousands grouping (default `true`)
 * @returns {string} formatted text; non-numeric input is returned unchanged
 */
export function formatNumber(value, locale = FALLBACK_REGION_FORMAT, options = {}) {
  const { decimals = null, grouping = true } = options
  const number = toFiniteNumber(value)
  if (number === null) return value === null || value === undefined ? '' : String(value)
  const intlOptions = { useGrouping: grouping }
  if (decimals !== null && decimals !== undefined) {
    const digits = Math.max(0, Math.min(20, Math.trunc(decimals)))
    intlOptions.minimumFractionDigits = digits
    intlOptions.maximumFractionDigits = digits
  } else {
    intlOptions.maximumFractionDigits = 20
  }
  return getFormatter(locale, intlOptions).format(number)
}

/**
 * Format a monetary amount with the configured currency.
 */
export function formatCurrency(value, locale = FALLBACK_REGION_FORMAT, currency = 'EUR', options = {}) {
  const { decimals = 2 } = options
  const number = toFiniteNumber(value)
  if (number === null) return value === null || value === undefined ? '' : String(value)
  const digits = Math.max(0, Math.min(20, Math.trunc(decimals)))
  return getFormatter(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number)
}

/**
 * Format a ratio already expressed in percent (e.g. `42.5` → `42,5 %`).
 */
export function formatPercent(value, locale = FALLBACK_REGION_FORMAT, options = {}) {
  const { decimals = 1 } = options
  const number = toFiniteNumber(value)
  if (number === null) return value === null || value === undefined ? '' : String(value)
  return `${formatNumber(number, locale, { decimals })}${NARROW_NBSP}%`
}
