import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

let helpStoreMock

vi.mock('@/stores/help', () => ({ useHelpStore: () => helpStoreMock }))

beforeEach(() => {
  helpStoreMock = reactive({ isOpen: false, currentUrl: null, close: vi.fn() })
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('HelpDrawer — closed', () => {
  it('renders nothing when the store is closed', async () => {
    const { default: HelpDrawer } = await import('@/components/ui/HelpDrawer.vue')
    mount(HelpDrawer, { attachTo: document.body })
    expect(document.querySelector('[data-testid="help-drawer-overlay"]')).toBeFalsy()
  })
})

describe('HelpDrawer — open with a resolved URL', () => {
  async function mountOpen(currentUrl = '/help/datapoints/overview.html#datapoints-overview') {
    helpStoreMock.isOpen = true
    helpStoreMock.currentUrl = currentUrl
    const { default: HelpDrawer } = await import('@/components/ui/HelpDrawer.vue')
    const w = mount(HelpDrawer, { attachTo: document.body })
    await flushPromises()
    return w
  }

  it('renders the overlay and an iframe pointing at currentUrl', async () => {
    await mountOpen('/help/datapoints/overview.html#datapoints-overview')
    const overlay = document.querySelector('[data-testid="help-drawer-overlay"]')
    expect(overlay).toBeTruthy()
    const iframe = document.querySelector('[data-testid="help-drawer-iframe"]')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('src')).toBe('/help/datapoints/overview.html#datapoints-overview')
  })

  it('renders the resize handle', async () => {
    await mountOpen()
    expect(document.querySelector('[data-testid="help-drawer-resize-handle"]')).toBeTruthy()
  })

  it('resizes the panel by dragging the handle (delegates to useResizablePanel)', async () => {
    await mountOpen()
    const panel = document.querySelector('.card.shadow-2xl')
    const startWidth = parseInt(panel.style.width, 10)
    const handle = document.querySelector('[data-testid="help-drawer-resize-handle"]')

    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500 }))
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 300 }))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await flushPromises()

    // Dragging the left-edge handle leftwards widens a right-anchored panel.
    expect(parseInt(panel.style.width, 10)).toBeGreaterThan(startWidth)
  })

  it('calls store.close() when the close button is clicked', async () => {
    await mountOpen()
    document.querySelector('.card-header .btn-icon').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(helpStoreMock.close).toHaveBeenCalledTimes(1)
  })

  it('calls store.close() when clicking the overlay outside the panel', async () => {
    await mountOpen()
    const overlay = document.querySelector('[data-testid="help-drawer-overlay"]')
    overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(helpStoreMock.close).toHaveBeenCalledTimes(1)
  })

  it('calls store.close() on Escape', async () => {
    await mountOpen()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(helpStoreMock.close).toHaveBeenCalledTimes(1)
  })

  it('does not close on Escape when already closed', async () => {
    helpStoreMock.isOpen = false
    const { default: HelpDrawer } = await import('@/components/ui/HelpDrawer.vue')
    mount(HelpDrawer, { attachTo: document.body })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(helpStoreMock.close).not.toHaveBeenCalled()
  })
})

describe('HelpDrawer — open with no resolvable URL', () => {
  it('shows the unavailable message instead of an iframe', async () => {
    helpStoreMock.isOpen = true
    helpStoreMock.currentUrl = null
    const { default: HelpDrawer } = await import('@/components/ui/HelpDrawer.vue')
    mount(HelpDrawer, { attachTo: document.body })
    await flushPromises()

    expect(document.querySelector('[data-testid="help-drawer-iframe"]')).toBeFalsy()
    const body = document.querySelector('.card-body')
    expect(body).toBeTruthy()
    expect(body.textContent.length).toBeGreaterThan(0)
  })
})
