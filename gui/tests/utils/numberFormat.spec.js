import { describe, it, expect } from 'vitest'
import {
  FALLBACK_REGION_FORMAT,
  formatCurrency,
  formatNumber,
  formatPercent,
  toFiniteNumber,
} from '@/utils/numberFormat'

const NBSP = '\u00A0'
const NARROW_NBSP = '\u202F'

describe('numberFormat (#1073)', () => {
  describe('toFiniteNumber', () => {
    it.each([
      [42, 42],
      [-0.5, -0.5],
      ['1.05', 1.05],
      ['  7 ', 7],
    ])('accepts %p as a number', (input, expected) => {
      expect(toFiniteNumber(input)).toBe(expected)
    })

    it.each([[null], [undefined], [''], ['   '], ['abc'], [true], [false], [NaN], [Infinity], [{}]])(
      'rejects %p',
      (input) => {
        expect(toFiniteNumber(input)).toBeNull()
      },
    )
  })

  describe('formatNumber', () => {
    it.each([
      ['de-DE', '1,050'],
      ['de-CH', '1.050'],
      ['en-US', '1.050'],
      ['fr-FR', '1,050'],
    ])('formats the issue example 1.05 with three decimals for %s', (locale, expected) => {
      expect(formatNumber(1.05, locale, { decimals: 3 })).toBe(expected)
    })

    it('groups thousands per regional format', () => {
      expect(formatNumber(1234567.5, 'de-DE', { decimals: 2 })).toBe('1.234.567,50')
      expect(formatNumber(1234567.5, 'de-CH', { decimals: 2 })).toBe("1'234'567.50")
      expect(formatNumber(1234567.5, 'en-US', { decimals: 2 })).toBe('1,234,567.50')
    })

    it('can suppress grouping', () => {
      expect(formatNumber(1234567.5, 'de-DE', { decimals: 2, grouping: false })).toBe('1234567,50')
    })

    it('keeps the value precision when no decimals are given', () => {
      expect(formatNumber(1.05, 'de-DE')).toBe('1,05')
      expect(formatNumber(42, 'de-DE')).toBe('42')
    })

    it('clamps out-of-range decimal counts', () => {
      expect(formatNumber(1.005, 'de-DE', { decimals: -3 })).toBe('1')
      expect(formatNumber(1.5, 'de-DE', { decimals: 99 })).toContain('1,5')
    })

    it('returns non-numeric input unchanged', () => {
      expect(formatNumber('AN', 'de-DE')).toBe('AN')
      expect(formatNumber(null, 'de-DE')).toBe('')
      expect(formatNumber(undefined, 'de-DE')).toBe('')
      expect(formatNumber(true, 'de-DE')).toBe('true')
    })

    it('falls back to the default regional format for an invalid locale', () => {
      expect(formatNumber(1234.5, 'not a locale', { decimals: 1 })).toBe(
        formatNumber(1234.5, FALLBACK_REGION_FORMAT, { decimals: 1 }),
      )
    })

    it('uses the default locale when none is given', () => {
      expect(formatNumber(1.5)).toBe('1,5')
    })
  })

  describe('formatCurrency', () => {
    it('renders the configured currency for the regional format', () => {
      expect(formatCurrency(1234.5, 'de-DE', 'EUR')).toBe(`1.234,50${NBSP}€`)
      expect(formatCurrency(1234.5, 'de-CH', 'CHF')).toBe(`CHF${NBSP}1'234.50`)
    })

    it('honours a decimals override and non-numeric input', () => {
      expect(formatCurrency(1234.5, 'de-DE', 'EUR', { decimals: 0 })).toBe(`1.235${NBSP}€`)
      expect(formatCurrency('n/a', 'de-DE', 'EUR')).toBe('n/a')
      expect(formatCurrency(null, 'de-DE', 'EUR')).toBe('')
    })

    it('uses the defaults when locale and currency are omitted', () => {
      expect(formatCurrency(1)).toBe(`1,00${NBSP}€`)
    })
  })

  describe('formatPercent', () => {
    it('appends a percent sign to the localized number', () => {
      expect(formatPercent(42.55, 'de-DE')).toBe(`42,6${NARROW_NBSP}%`)
      expect(formatPercent(42.55, 'en-US', { decimals: 2 })).toBe(`42.55${NARROW_NBSP}%`)
    })

    it('returns non-numeric input unchanged', () => {
      expect(formatPercent('—', 'de-DE')).toBe('—')
      expect(formatPercent(undefined, 'de-DE')).toBe('')
    })

    it('uses the default locale when none is given', () => {
      expect(formatPercent(1)).toBe(`1,0${NARROW_NBSP}%`)
    })
  })
})
