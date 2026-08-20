// @vitest-environment jsdom
/**
 * Uhr widget date line (issue #1073).
 *
 * The date follows the administrator-configured `date_format` pattern, renders
 * in the widget's own timezone so it matches the clock hands, and takes its
 * weekday/month names from the UI language rather than the regional format.
 * The *time* stays widget-owned — its `showSeconds` option governs it.
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFormatStore } from '@/stores/format'
import UhrWidget from './Widget.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'de' }, t: (key: string) => key }) }))

let wrapper: VueWrapper | null = null

function mountClock(config: Record<string, unknown>) {
  wrapper = mount(UhrWidget, {
    props: { config: { mode: 'digital', showDate: true, ...config }, datapointId: null, value: null, statusValue: null, editorMode: false },
  })
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  wrapper?.unmount()
  wrapper = null
})

describe('Uhr Widget.vue — date line (#1073)', () => {
  it('applies the administrator-configured date pattern', () => {
    const store = useFormatStore()
    store.dateFormat = 'yyyy/MM/dd'
    store.timezone = 'UTC'

    expect(mountClock({}).text()).toContain('2026/08/20')
  })

  it('renders the default pattern when nothing is configured', () => {
    useFormatStore().timezone = 'UTC'

    expect(mountClock({}).text()).toContain('20.08.2026')
  })

  it('keeps weekday and month names in the UI language, not the region', () => {
    const store = useFormatStore()
    store.dateFormat = 'EEEE, d. MMMM yyyy'
    store.timezone = 'UTC'
    store.regionFormatSetting = 'en-US'

    expect(mountClock({}).text()).toContain('Donnerstag, 20. August 2026')
  })

  it("uses the widget's own timezone so the date matches the hands", () => {
    const store = useFormatStore()
    store.dateFormat = 'dd.MM.yyyy'
    store.timezone = 'UTC'

    // 02:00 UTC on the 20th is still 19:00 on the 19th in Los Angeles (UTC-7).
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'))

    const text = mountClock({ timezone: 'America/Los_Angeles' }).text()

    // Date *and* time must come from the same zone — showing the widget's date
    // next to browser-local time would be worse than either alone.
    expect(text).toContain('19.08.2026')
    expect(text).toContain('19:00')
  })

  it('keeps the digital time in the browser zone when the widget sets none', () => {
    const store = useFormatStore()
    store.timezone = 'UTC'
    vi.setSystemTime(new Date('2026-08-20T02:00:00Z'))

    const expected = new Date('2026-08-20T02:00:00Z').getHours()
    expect(mountClock({}).text()).toContain(`${String(expected).padStart(2, '0')}:00`)
  })

  it('omits the date entirely when showDate is off', () => {
    useFormatStore().timezone = 'UTC'

    expect(mountClock({ showDate: false }).text()).not.toContain('2026')
  })
})
