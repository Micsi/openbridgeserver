import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// NetworkAllowlistEditor is deliberately *not* stubbed — the point of these
// tests is that the webhook instance config renders the real multi-entry
// editor instead of SchemaForm's single-line string field (issue #1256).
const STUBS = {
  SchemaForm: { name: 'SchemaForm', template: '<div class="schema-form" />', props: ['schema', 'modelValue', 'adapterType', 'exclude'] },
  KnxConfigForm: { template: '<div class="knx-form" />' },
  AnwesenheitConfigForm: { template: '<div class="anwesenheit-form" />' },
  MessageConfigForm: { template: '<div class="message-form" />' },
  ZeitschaltuhrCustomHolidaysEditor: { template: '<div />' },
  AnwesenheitDatapointSelector: { template: '<div />' },
  Spinner: { template: '<span class="spinner" />' },
  Badge: { template: '<span class="badge"><slot /></span>' },
  Modal: {
    template: '<div v-if="modelValue" class="modal"><slot /></div>',
    props: ['modelValue', 'title', 'maxWidth', 'resizable'],
    emits: ['update:modelValue'],
  },
  ConfirmDialog: { template: '<div />', props: { modelValue: Boolean } },
}

const WEBHOOK_SCHEMA = {
  type: 'object',
  properties: {
    path_prefix: { type: 'string', default: '/hook' },
    allowed_networks: { type: 'array', items: { type: 'string' } },
    trust_forwarded_for: { type: 'boolean', default: false },
    rate_limit_per_minute: { type: 'integer', default: 60 },
  },
}

function makeInstance(overrides = {}) {
  return {
    id: 1,
    adapter_type: 'WEBHOOK',
    name: 'Webhook',
    running: true,
    connected: true,
    severity: 'ok',
    registered: true,
    bindings: 0,
    config: { path_prefix: '/hook', allowed_networks: ['10.38.0.0/16'] },
    enabled: true,
    status_detail: '',
    status_detail_code: null,
    status_detail_params: {},
    ...overrides,
  }
}

let adapterApiMock

beforeEach(() => {
  vi.resetModules()
  adapterApiMock = {
    listInstances: vi.fn().mockResolvedValue({ data: [] }),
    list: vi.fn().mockResolvedValue({ data: [] }),
    schema: vi.fn().mockResolvedValue({ data: WEBHOOK_SCHEMA }),
    createInstance: vi.fn().mockResolvedValue({ data: makeInstance({ id: 99 }) }),
    updateInstance: vi.fn().mockResolvedValue({ data: makeInstance() }),
    deleteInstance: vi.fn().mockResolvedValue({}),
    testInstance: vi.fn().mockResolvedValue({ data: { success: true } }),
    restartInstance: vi.fn().mockResolvedValue({ data: makeInstance() }),
    migrateBindings: vi.fn().mockResolvedValue({ data: {} }),
    anwesenheitHealth: vi.fn().mockRejectedValue(new Error('n/a')),
  }
  vi.doMock('@/api/client', () => ({
    adapterApi: adapterApiMock,
    authApi: { login: vi.fn(), me: vi.fn() },
    knxKeyfileApi: {},
    searchApi: { search: vi.fn().mockResolvedValue({ data: { items: [], total: 0, pages: 0 } }) },
    settingsApi: { get: vi.fn().mockResolvedValue({ data: {} }) },
    navLinksApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
    dpApi: {},
    systemApi: {},
  }))
})

afterEach(() => { vi.doUnmock('@/api/client') })

async function mountAdapters({ instances = [], types = ['WEBHOOK'] } = {}) {
  adapterApiMock.listInstances.mockResolvedValue({ data: instances })
  adapterApiMock.list.mockResolvedValue({ data: types.map(t => ({ adapter_type: t, hidden: false })) })

  const pinia = createPinia()
  setActivePinia(pinia)
  const { useAuthStore } = await import('@/stores/auth')
  useAuthStore().user = { username: 'admin', is_admin: true }

  const { default: AdaptersView } = await import('@/views/AdaptersView.vue')
  const wrapper = mount(AdaptersView, { global: { plugins: [pinia], stubs: STUBS }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('AdaptersView — WEBHOOK instance allowlist', () => {
  it('renders the multi-entry editor in the edit panel and hides the field from SchemaForm', async () => {
    const wrapper = await mountAdapters({ instances: [makeInstance()] })
    await wrapper.find('[data-testid="btn-expand-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="allowlist-entry-0"]').element.value).toBe('10.38.0.0/16')
    expect(wrapper.findComponent({ name: 'SchemaForm' }).props('exclude')).toEqual(['allowed_networks'])
    wrapper.unmount()
  })

  it('writes added and edited entries back into the instance draft', async () => {
    const wrapper = await mountAdapters({ instances: [makeInstance()] })
    await wrapper.find('[data-testid="btn-expand-1"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="allowlist-add"]').trigger('click')
    await wrapper.find('[data-testid="allowlist-entry-1"]').setValue('127.0.0.1')
    await wrapper.findAll('button').find(b => b.text() === 'Speichern').trigger('click')
    await flushPromises()

    expect(adapterApiMock.updateInstance).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ config: expect.objectContaining({ allowed_networks: ['10.38.0.0/16', '127.0.0.1'] }) }),
    )
    wrapper.unmount()
  })

  it('removes an entry again', async () => {
    const wrapper = await mountAdapters({ instances: [makeInstance()] })
    await wrapper.find('[data-testid="btn-expand-1"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-testid="allowlist-remove-0"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="allowlist-entry-0"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('alle Absender sind erlaubt')
    wrapper.unmount()
  })

  it('starts empty for an instance stored before the field existed', async () => {
    const wrapper = await mountAdapters({ instances: [makeInstance({ config: { path_prefix: '/hook' } })] })
    await wrapper.find('[data-testid="btn-expand-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="allowlist-entry-0"]').exists()).toBe(false)
    await wrapper.find('[data-testid="allowlist-add"]').trigger('click')
    await wrapper.find('[data-testid="allowlist-entry-0"]').setValue('10.0.0.0/8')
    await wrapper.findAll('button').find(b => b.text() === 'Speichern').trigger('click')
    await flushPromises()

    expect(adapterApiMock.updateInstance).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ config: expect.objectContaining({ allowed_networks: ['10.0.0.0/8'] }) }),
    )
    wrapper.unmount()
  })

  it('offers the editor in the create form too', async () => {
    const wrapper = await mountAdapters()
    await wrapper.findAll('button').find(b => b.text().includes('Neue Instanz')).trigger('click')
    await flushPromises()

    const select = wrapper.find('select')
    await select.setValue('WEBHOOK')
    await flushPromises()

    expect(wrapper.find('[data-testid="allowlist-add"]').exists()).toBe(true)
    await wrapper.find('[data-testid="allowlist-add"]').trigger('click')
    await wrapper.find('[data-testid="allowlist-entry-0"]').setValue('10.0.0.0/8')
    expect(wrapper.find('[data-testid="allowlist-entry-0"]').element.value).toBe('10.0.0.0/8')
    wrapper.unmount()
  })

  it('does not offer a connection test for an inbound-only adapter', async () => {
    const wrapper = await mountAdapters({ instances: [makeInstance()] })
    await wrapper.find('[data-testid="btn-expand-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button').find(b => b.text() === 'Verbindung testen')).toBeUndefined()
    wrapper.unmount()
  })

  it('leaves other adapter types on the plain SchemaForm', async () => {
    const wrapper = await mountAdapters({
      instances: [makeInstance({ adapter_type: 'MODBUS_TCP', config: { host: '1.2.3.4' } })],
      types: ['MODBUS_TCP'],
    })
    await wrapper.find('[data-testid="btn-expand-1"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="allowlist-add"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'SchemaForm' }).props('exclude')).toEqual([])
    wrapper.unmount()
  })
})
