/**
 * Tests for PathLabel.vue.
 *
 * PathLabel renders a hierarchical path (e.g. ['Gebäude', 'EG', 'Küche']) with
 * - segment-based collapsing via ResizeObserver,
 * - tooltip rendering via @floating-ui/vue on hover,
 * - optional hideRoot to drop the first segment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import PathLabel from '@/components/ui/PathLabel.vue'

/** Capture ResizeObserver callbacks so tests can simulate width changes. */
class FakeResizeObserver {
  constructor(cb) {
    this.cb = cb
    FakeResizeObserver.instances.push(this)
    this.observed = []
    this.disconnected = false
  }
  observe(el) { this.observed.push(el) }
  unobserve() {}
  disconnect() { this.disconnected = true }
}
FakeResizeObserver.instances = []

beforeEach(() => {
  FakeResizeObserver.instances = []
  globalThis.ResizeObserver = FakeResizeObserver
})

afterEach(() => {
  // restore
})

function setWidth(el, w) {
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
}

async function fireResize(width) {
  const ro = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
  if (!ro) return
  for (const el of ro.observed) {
    setWidth(el, width)
  }
  ro.cb([{ contentRect: { width } }])
  await nextTick()
  await flushPromises()
}

describe('PathLabel rendering', () => {
  it('renders all segments when the path is short', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['Gebäude', 'EG', 'Küche'] },
    })
    await fireResize(800)
    const html = wrapper.text()
    expect(html).toContain('Gebäude')
    expect(html).toContain('EG')
    expect(html).toContain('Küche')
  })

  it('uses the configured separator', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['A', 'B'], separator: '/' },
    })
    await fireResize(800)
    expect(wrapper.text()).toContain('/')
  })

  it('hides the root segment when hideRoot=true', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['Gebäude', 'EG', 'Küche'], hideRoot: true },
    })
    await fireResize(800)
    expect(wrapper.text()).not.toContain('Gebäude')
    expect(wrapper.text()).toContain('EG')
    expect(wrapper.text()).toContain('Küche')
  })

  it('collapses long paths in the middle when width is constrained', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['A', 'B', 'C', 'D', 'E'] },
    })
    // Force a narrow container
    await fireResize(80)
    const text = wrapper.text()
    expect(text).toContain('A') // first
    expect(text).toContain('E') // last
    expect(text).toContain('…')
  })

  it('shows leaf-only with ellipsis prefix when very narrow', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['A', 'B', 'C', 'D', 'E'] },
    })
    await fireResize(20)
    const text = wrapper.text()
    expect(text).toContain('E')
    expect(text).toContain('…')
  })

  it('renders nothing when segments is empty', () => {
    const wrapper = mount(PathLabel, { props: { segments: [] } })
    expect(wrapper.text()).toBe('')
  })
})

describe('PathLabel tooltip', () => {
  it('renders a full-path tooltip element with the joined segments', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['Gebäude', 'EG', 'Küche'] },
      attachTo: document.body,
    })
    await fireResize(50)
    // Trigger pointer enter to show the tooltip
    await wrapper.find('[data-testid="pathlabel-root"]').trigger('pointerenter')
    await flushPromises()
    const tooltip = wrapper.find('[data-testid="pathlabel-tooltip"]')
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.text()).toContain('Gebäude')
    expect(tooltip.text()).toContain('EG')
    expect(tooltip.text()).toContain('Küche')
    wrapper.unmount()
  })

  it('hides the tooltip on pointer leave', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['A', 'B'] },
      attachTo: document.body,
    })
    await fireResize(50)
    await wrapper.find('[data-testid="pathlabel-root"]').trigger('pointerenter')
    await flushPromises()
    expect(wrapper.find('[data-testid="pathlabel-tooltip"]').exists()).toBe(true)
    await wrapper.find('[data-testid="pathlabel-root"]').trigger('pointerleave')
    await flushPromises()
    expect(wrapper.find('[data-testid="pathlabel-tooltip"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('PathLabel cleanup', () => {
  it('disconnects the ResizeObserver on unmount', async () => {
    const wrapper = mount(PathLabel, {
      props: { segments: ['A', 'B'] },
    })
    await fireResize(200)
    const ro = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]
    expect(ro.disconnected).toBe(false)
    wrapper.unmount()
    expect(ro.disconnected).toBe(true)
  })
})
