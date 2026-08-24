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
    expect(document.querySelector('[data-testid="help-drawer-panel"]')).toBeFalsy()
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

  it('renders the panel and an iframe pointing at currentUrl', async () => {
    await mountOpen('/help/datapoints/overview.html#datapoints-overview')
    const panel = document.querySelector('[data-testid="help-drawer-panel"]')
    expect(panel).toBeTruthy()
    const iframe = document.querySelector('[data-testid="help-drawer-iframe"]')
    expect(iframe).toBeTruthy()
    expect(iframe.getAttribute('src')).toBe('/help/datapoints/overview.html#datapoints-overview')
  })

  it('does not block the rest of the page — no full-viewport overlay element (regression, feedback after first release)', async () => {
    // A prior version wrapped the panel in a `fixed inset-0` backdrop div that
    // swallowed clicks everywhere, defeating the point of a slide-in drawer
    // ("keep working while help is open"). The panel itself must only cover
    // its own width, anchored to the right edge, not the whole viewport.
    await mountOpen()
    expect(document.querySelector('.fixed.inset-0')).toBeFalsy()
    const panel = document.querySelector('[data-testid="help-drawer-panel"]')
    expect(panel.className).toContain('fixed')
    expect(panel.className).toContain('right-0')
    expect(panel.className).not.toContain('inset-0')
  })

  it('leaves elements outside the drawer clickable while open', async () => {
    const outside = document.createElement('button')
    outside.setAttribute('data-testid', 'page-behind-drawer')
    const onClick = vi.fn()
    outside.addEventListener('click', onClick)
    document.body.appendChild(outside)

    await mountOpen()
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders the resize handle', async () => {
    await mountOpen()
    expect(document.querySelector('[data-testid="help-drawer-resize-handle"]')).toBeTruthy()
  })

  it('resizes the panel by dragging the handle (delegates to useResizablePanel)', async () => {
    await mountOpen()
    const panel = document.querySelector('[data-testid="help-drawer-panel"]')
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
