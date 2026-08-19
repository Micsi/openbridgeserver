import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { displaySettings } from '@/api/client'
import { useFormatStore } from './format'

vi.mock('@/api/client', () => ({
  displaySettings: { get: vi.fn() },
}))

const NBSP = '\u00A0'
const getMock = vi.mocked(displaySettings.get)

function payload(overrides: Record<string, unknown> = {}) {
  return {
    language: 'de',
    timezone: 'Europe/Zurich',
    date_format: 'dd.MM.yyyy',
    time_format: 'HH:mm:ss',
    region_format: 'auto',
    currency: 'auto',
    resolved_region_format: 'de-DE',
    resolved_currency: 'EUR',
    supported_region_formats: ['auto', 'de-DE', 'de-CH'],
    supported_currencies: ['auto', 'EUR', 'CHF'],
    ...overrides,
  }
}

describe('useFormatStore (#1073)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getMock.mockReset()
  })

  it('starts on the German default before the settings are loaded', () => {
    const store = useFormatStore()

    expect(store.loaded).toBe(false)
    expect(store.regionFormat).toBe('de-DE')
    expect(store.currency).toBe('EUR')
    expect(store.fmtNumber(1.05, { decimals: 3 })).toBe('1,050')
  })

  it('applies the resolved regional format from the public endpoint', async () => {
    getMock.mockResolvedValue(payload({ resolved_region_format: 'de-CH', resolved_currency: 'CHF' }))
    const store = useFormatStore()

    await store.load()

    expect(store.loaded).toBe(true)
    expect(store.regionFormat).toBe('de-CH')
    expect(store.currency).toBe('CHF')
    expect(store.fmtNumber(1.05, { decimals: 3 })).toBe('1.050')
    expect(store.fmtCurrency(1234.5)).toBe(`CHF${NBSP}1'234.50`)
    expect(store.fmtPercent(12.34)).toBe('12.3\u202F%')
  })

  it('keeps the format independent of the UI language', async () => {
    getMock.mockResolvedValue(payload({ language: 'en', resolved_region_format: 'de-DE', resolved_currency: 'EUR' }))
    const store = useFormatStore()

    await store.load()

    expect(store.language).toBe('en')
    expect(store.regionFormat).toBe('de-DE')
    expect(store.fmtNumber(1.05, { decimals: 3 })).toBe('1,050')
  })

  it('falls back to the unresolved setting when the server omits the resolved fields', async () => {
    getMock.mockResolvedValue(payload({
      language: '',
      region_format: 'en-GB',
      currency: 'GBP',
      resolved_region_format: '',
      resolved_currency: '',
      timezone: '',
    }))
    const store = useFormatStore()

    await store.load()

    expect(store.language).toBe('de')
    expect(store.regionFormat).toBe('en-GB')
    expect(store.currency).toBe('GBP')
    expect(store.timezone).toBeNull()
  })

  it('stays usable with the default format when the endpoint is unreachable', async () => {
    getMock.mockRejectedValue(new Error('offline'))
    const store = useFormatStore()

    await store.load()

    expect(store.loaded).toBe(true)
    expect(store.regionFormat).toBe('de-DE')
    expect(store.fmtNumber(1234.5, { decimals: 1 })).toBe('1.234,5')
  })

  describe('fmtDateTime', () => {
    it('formats in the configured timezone and regional format', async () => {
      getMock.mockResolvedValue(payload({ resolved_region_format: 'de-CH', timezone: 'UTC' }))
      const store = useFormatStore()
      await store.load()

      const text = store.fmtDateTime('2026-06-08T14:05:00Z', { hour: '2-digit', minute: '2-digit' })

      expect(text).toBe('14:05')
    })

    it('accepts Date and epoch-millisecond input', () => {
      const store = useFormatStore()
      const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }

      const fromDate = store.fmtDateTime(new Date('2026-06-08T00:00:00Z'), options)
      const fromMs = store.fmtDateTime(Date.UTC(2026, 5, 8), options)

      expect(fromDate).toBe('08.06.2026')
      expect(fromMs).toBe(fromDate)
    })

    it('returns an empty string for an unparsable timestamp', () => {
      const store = useFormatStore()

      expect(store.fmtDateTime('not a date')).toBe('')
    })

    it('falls back to the default locale when the regional format is invalid', async () => {
      getMock.mockResolvedValue(payload({ resolved_region_format: 'not a locale', timezone: '' }))
      const store = useFormatStore()
      await store.load()

      const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }

      expect(store.fmtDateTime('2026-06-08T00:00:00Z', options)).toBe('08.06.2026')
    })
  })
})
