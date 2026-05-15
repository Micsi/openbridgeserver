/**
 * Tests for TopbarFilterChips.vue ownership UI (#478).
 *
 * Per-user state (is_active toggle, pinning, drag-reorder, +Add, ×Remove) is
 * open to every authenticated user — the active/inactive dot button writes to
 * the caller's own user_state row. Every user (including admin) sees the
 * owner of a foreign set inline at the chip body via a "@<owner>" hint; the
 * lock icon is only rendered when the caller has no write access so admin
 * sees the owner without misleading read-only affordance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

let listFiltersets

beforeEach(() => {
  setActivePinia(createPinia())
  listFiltersets = vi.fn()
  vi.doMock('@/api/client', () => ({
    ringbufferApi: { listFiltersets, patchFiltersetTopbar: vi.fn(), patchFiltersetOrder: vi.fn() },
  }))
})

afterEach(() => {
  vi.doUnmock('@/api/client')
  vi.resetModules()
})

function setAuth({ username, isAdmin }) {
  const auth = useAuthStore()
  auth.user = { id: 'u1', username, is_admin: isAdmin, created_at: '2025-01-01' }
}

function makeSet(overrides = {}) {
  return {
    id: 'set-a',
    name: 'Set A',
    color: '#3b82f6',
    is_active: true,
    topbar_active: true,
    topbar_order: 0,
    filter: {},
    created_by: 'alice',
    ...overrides,
  }
}

async function mountChips() {
  const mod = await import('@/views/ringbuffer/TopbarFilterChips.vue')
  return mount(mod.default, { attachTo: document.body })
}

describe('TopbarFilterChips ownership UI (#478)', () => {
  it('is_active toggle is enabled for everyone — it writes to per-user state', async () => {
    listFiltersets.mockResolvedValueOnce({ data: [makeSet({ created_by: 'alice' })] })
    setAuth({ username: 'bob', isAdmin: false })

    const wrapper = await mountChips()
    await flushPromises()

    const toggle = wrapper.find('[data-testid="topbar-chip-toggle-set-a"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.element.disabled).toBe(false)
    wrapper.unmount()
  })

  it('admin sees the owner inline on a foreign set, without lock icon', async () => {
    listFiltersets.mockResolvedValueOnce({ data: [makeSet({ created_by: 'alice' })] })
    setAuth({ username: 'admin', isAdmin: true })

    const wrapper = await mountChips()
    await flushPromises()

    const owner = wrapper.find('[data-testid="topbar-chip-owner-set-a"]')
    expect(owner.exists()).toBe(true)
    expect(owner.text()).toContain('@alice')
    expect(wrapper.find('[data-testid="topbar-chip-owner-lock-set-a"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('non-owner non-admin sees the owner inline AND a lock marker', async () => {
    listFiltersets.mockResolvedValueOnce({ data: [makeSet({ created_by: 'alice' })] })
    setAuth({ username: 'bob', isAdmin: false })

    const wrapper = await mountChips()
    await flushPromises()

    const owner = wrapper.find('[data-testid="topbar-chip-owner-set-a"]')
    expect(owner.exists()).toBe(true)
    expect(owner.text()).toContain('@alice')
    expect(wrapper.find('[data-testid="topbar-chip-owner-lock-set-a"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('owner sees no inline owner hint and no lock marker', async () => {
    listFiltersets.mockResolvedValueOnce({ data: [makeSet({ created_by: 'alice' })] })
    setAuth({ username: 'alice', isAdmin: false })

    const wrapper = await mountChips()
    await flushPromises()

    expect(wrapper.find('[data-testid="topbar-chip-owner-set-a"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="topbar-chip-owner-lock-set-a"]').exists()).toBe(false)
    const body = wrapper.find('[data-testid="topbar-chip-body-set-a"]')
    expect(body.attributes('title')).toContain('Eigenes Set')
    wrapper.unmount()
  })

  it('admin on a legacy set sees "geteilt" inline without lock', async () => {
    listFiltersets.mockResolvedValueOnce({ data: [makeSet({ created_by: null })] })
    setAuth({ username: 'admin', isAdmin: true })

    const wrapper = await mountChips()
    await flushPromises()

    const owner = wrapper.find('[data-testid="topbar-chip-owner-set-a"]')
    expect(owner.exists()).toBe(true)
    expect(owner.text()).toContain('geteilt')
    expect(wrapper.find('[data-testid="topbar-chip-owner-lock-set-a"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('non-admin on a legacy set sees "geteilt" inline AND the lock marker', async () => {
    listFiltersets.mockResolvedValueOnce({ data: [makeSet({ created_by: null })] })
    setAuth({ username: 'bob', isAdmin: false })

    const wrapper = await mountChips()
    await flushPromises()

    const owner = wrapper.find('[data-testid="topbar-chip-owner-set-a"]')
    expect(owner.exists()).toBe(true)
    expect(owner.text()).toContain('geteilt')
    expect(wrapper.find('[data-testid="topbar-chip-owner-lock-set-a"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
