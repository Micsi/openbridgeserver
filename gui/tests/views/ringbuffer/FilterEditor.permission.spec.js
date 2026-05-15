/**
 * Tests for FilterEditor.vue ownership UI (#478).
 *
 * Admin can edit every set; non-admin users only edit sets they created
 * themselves. Legacy sets (created_by == null) are admin-only. The editor
 * disables the Save and Delete buttons accordingly and always shows the
 * owner banner so every user knows who owns a set.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

let getFilterset

beforeEach(() => {
  setActivePinia(createPinia())
  getFilterset = vi.fn()

  vi.doMock('@/api/client', () => ({
    ringbufferApi: { getFilterset },
    searchApi: { search: vi.fn().mockResolvedValue({ data: { items: [] } }) },
    hierarchyApi: { listTrees: vi.fn().mockResolvedValue({ data: [] }) },
  }))

  vi.doMock('@/components/ui/Modal.vue', () => ({
    default: {
      name: 'Modal',
      props: ['modelValue', 'title', 'softModal', 'maxWidth'],
      emits: ['update:modelValue'],
      template: `
        <div v-if="modelValue" data-testid="modal-stub">
          <slot />
          <div data-testid="modal-footer-slot"><slot name="footer" /></div>
        </div>
      `,
    },
  }))
  vi.doMock('@/components/ui/ConfirmDialog.vue', () => ({ default: { name: 'ConfirmDialog', template: '<div />' } }))
  vi.doMock('@/components/ui/HierarchyCombobox.vue', () => ({ default: { name: 'HierarchyCombobox', template: '<div />' } }))
  vi.doMock('@/components/ui/DpCombobox.vue', () => ({ default: { name: 'DpCombobox', template: '<div />' } }))
  vi.doMock('@/components/ui/TagCombobox.vue', () => ({ default: { name: 'TagCombobox', template: '<div />' } }))
  vi.doMock('@/components/ui/AdapterCombobox.vue', () => ({ default: { name: 'AdapterCombobox', template: '<div />' } }))
})

afterEach(() => {
  vi.doUnmock('@/api/client')
  vi.doUnmock('@/components/ui/Modal.vue')
  vi.doUnmock('@/components/ui/ConfirmDialog.vue')
  vi.doUnmock('@/components/ui/HierarchyCombobox.vue')
  vi.doUnmock('@/components/ui/DpCombobox.vue')
  vi.doUnmock('@/components/ui/TagCombobox.vue')
  vi.doUnmock('@/components/ui/AdapterCombobox.vue')
  vi.resetModules()
})

function setAuth({ username, isAdmin }) {
  const auth = useAuthStore()
  auth.user = { id: 'u1', username, is_admin: isAdmin, created_at: '2025-01-01' }
}

function makeSet(overrides = {}) {
  return {
    id: 'set-1',
    name: 'Sample set',
    description: '',
    color: '#3b82f6',
    is_active: true,
    topbar_active: false,
    topbar_order: 0,
    filter: { adapters: ['api'], datapoints: [], tags: [], hierarchy_nodes: [], q: null, value_filter: null },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    created_by: 'alice',
    ...overrides,
  }
}

async function mountEditor(setId) {
  const mod = await import('@/views/ringbuffer/FilterEditor.vue')
  return mount(mod.default, { props: { modelValue: true, setId, softModal: false }, attachTo: document.body })
}

describe('FilterEditor permissions (#478)', () => {
  it('non-admin user cannot edit another user\'s set: Save/Delete disabled and owner banner shows the owner', async () => {
    getFilterset.mockResolvedValueOnce({ data: makeSet({ created_by: 'alice' }) })
    setAuth({ username: 'bob', isAdmin: false })

    const wrapper = await mountEditor('set-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="filter-editor-save-topbar"]').element.disabled).toBe(true)
    expect(wrapper.find('[data-testid="filter-editor-delete"]').element.disabled).toBe(true)
    const owner = wrapper.find('[data-testid="filter-editor-owner-line"]')
    expect(owner.exists()).toBe(true)
    expect(owner.text()).toContain('alice')
    expect(owner.text()).toContain('Nur lesend')
    wrapper.unmount()
  })

  it('owner can edit their own set: Save/Delete enabled, banner says "Eigenes Set"', async () => {
    getFilterset.mockResolvedValueOnce({ data: makeSet({ created_by: 'alice' }) })
    setAuth({ username: 'alice', isAdmin: false })

    const wrapper = await mountEditor('set-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="filter-editor-save-topbar"]').element.disabled).toBe(false)
    expect(wrapper.find('[data-testid="filter-editor-delete"]').element.disabled).toBe(false)
    const owner = wrapper.find('[data-testid="filter-editor-owner-line"]')
    expect(owner.text()).toContain('Eigenes Set')
    expect(owner.text()).not.toContain('Nur lesend')
    wrapper.unmount()
  })

  it('admin can edit any set including legacy sets with created_by=null', async () => {
    getFilterset.mockResolvedValueOnce({ data: makeSet({ created_by: null }) })
    setAuth({ username: 'admin', isAdmin: true })

    const wrapper = await mountEditor('set-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="filter-editor-save-topbar"]').element.disabled).toBe(false)
    expect(wrapper.find('[data-testid="filter-editor-delete"]').element.disabled).toBe(false)
    expect(wrapper.find('[data-testid="filter-editor-owner-line"]').text()).toContain('Geteiltes Set')
    wrapper.unmount()
  })

  it('non-admin cannot edit a legacy set (created_by=null): Save/Delete disabled, banner explains', async () => {
    getFilterset.mockResolvedValueOnce({ data: makeSet({ created_by: null }) })
    setAuth({ username: 'bob', isAdmin: false })

    const wrapper = await mountEditor('set-1')
    await flushPromises()

    expect(wrapper.find('[data-testid="filter-editor-save-topbar"]').element.disabled).toBe(true)
    expect(wrapper.find('[data-testid="filter-editor-delete"]').element.disabled).toBe(true)
    const owner = wrapper.find('[data-testid="filter-editor-owner-line"]')
    expect(owner.text()).toContain('Geteiltes Set')
    expect(owner.text()).toContain('Nur lesend')
    wrapper.unmount()
  })

  it('new set (no setId) hides the owner banner and the delete button', async () => {
    setAuth({ username: 'bob', isAdmin: false })

    const wrapper = await mountEditor(null)
    await flushPromises()

    expect(wrapper.find('[data-testid="filter-editor-owner-line"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="filter-editor-delete"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
