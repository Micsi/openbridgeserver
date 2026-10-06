import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import BindingFormWebhook from '@/components/datapoints/binding-form/BindingFormWebhook.vue'

const BASE_CFG = {
  slug: 'haustuer-klingel',
  methods: ['GET'],
  allowed_networks: [],
  value_source: 'fixed',
  fixed_value: 'true',
  value_param: 'value',
  debounce_ms: 0,
}

const ENTRY = {
  binding_id: 'b-1',
  slug: 'haustuer-klingel',
  token: 'tok-123',
  call_path: '/hook/haustuer-klingel?token=tok-123',
  call_path_token_in_path: '/hook/haustuer-klingel/tok-123',
  call_count: 4,
  publish_count: 3,
  last_called: '2026-10-06T07:30:00+00:00',
  last_status: 204,
}

function mk(props = {}, cfg = null) {
  return mount(BindingFormWebhook, {
    props: { cfg: cfg ?? { ...BASE_CFG }, ...props },
  })
}

describe('BindingFormWebhook — binding configuration', () => {
  it('writes the slug into cfg', async () => {
    const cfg = { ...BASE_CFG }
    const w = mk({}, cfg)
    await w.find('[data-testid="webhook-slug"]').setValue('seiteneingang')
    expect(cfg.slug).toBe('seiteneingang')
    w.unmount()
  })

  it('shows the fixed-value field for the fixed value source', () => {
    const w = mk()
    expect(w.find('[data-testid="webhook-fixed-value"]').exists()).toBe(true)
    expect(w.find('[data-testid="webhook-value-param"]').exists()).toBe(false)
    w.unmount()
  })

  it('swaps in the parameter-name field for the request value source', async () => {
    const cfg = { ...BASE_CFG }
    const w = mk({}, cfg)
    await w.find('[data-testid="webhook-value-source"]').setValue('request')
    expect(cfg.value_source).toBe('request')
    expect(w.find('[data-testid="webhook-value-param"]').exists()).toBe(true)
    expect(w.find('[data-testid="webhook-fixed-value"]').exists()).toBe(false)
    w.unmount()
  })

  it('writes the fixed value, parameter name and debounce into cfg', async () => {
    const cfg = { ...BASE_CFG, value_source: 'request' }
    const w = mk({}, cfg)
    await w.find('[data-testid="webhook-value-param"]').setValue('kovalue')
    await w.find('[data-testid="webhook-debounce"]').setValue('1500')
    expect(cfg.value_param).toBe('kovalue')
    expect(cfg.debounce_ms).toBe(1500)

    const fixed = { ...BASE_CFG }
    const w2 = mk({}, fixed)
    await w2.find('[data-testid="webhook-fixed-value"]').setValue('1')
    expect(fixed.fixed_value).toBe('1')
    w.unmount()
    w2.unmount()
  })

  it('adds and removes HTTP methods, keeping the order stable', async () => {
    const cfg = { ...BASE_CFG }
    const w = mk({}, cfg)
    await w.find('[data-testid="webhook-method-POST"]').setValue(true)
    expect(cfg.methods).toEqual(['GET', 'POST'])

    await w.find('[data-testid="webhook-method-GET"]').setValue(false)
    expect(cfg.methods).toEqual(['POST'])
    w.unmount()
  })

  it('never leaves a binding without a method', async () => {
    const cfg = { ...BASE_CFG }
    const w = mk({}, cfg)
    await w.find('[data-testid="webhook-method-GET"]').setValue(false)
    expect(cfg.methods).toEqual(['GET'])
    w.unmount()
  })

  it('tolerates a config whose methods list is missing', async () => {
    const cfg = { ...BASE_CFG, methods: undefined }
    const w = mk({}, cfg)
    await w.find('[data-testid="webhook-method-POST"]').setValue(true)
    expect(cfg.methods).toEqual(['POST'])
    w.unmount()
  })
})

describe('BindingFormWebhook — call URL section', () => {
  it('stays hidden for a binding that does not exist yet', () => {
    const w = mk({ isExisting: false, entry: ENTRY })
    expect(w.find('[data-testid="webhook-call-url"]').exists()).toBe(false)
    w.unmount()
  })

  it('renders both absolute call URLs and the counters', () => {
    const w = mk({ isExisting: true, entry: ENTRY })
    const origin = window.location.origin
    expect(w.find('[data-testid="webhook-call-url"]').element.value).toBe(`${origin}${ENTRY.call_path}`)
    expect(w.find('[data-testid="webhook-call-url-path"]').element.value).toBe(`${origin}${ENTRY.call_path_token_in_path}`)
    expect(w.find('[data-testid="webhook-call-count"]').text()).toBe('4')
    expect(w.find('[data-testid="webhook-publish-count"]').text()).toBe('3')
    expect(w.find('[data-testid="webhook-last-called"]').text()).toBe(ENTRY.last_called)
    w.unmount()
  })

  it('shows a placeholder when the binding was never called', () => {
    const w = mk({ isExisting: true, entry: { ...ENTRY, last_called: null } })
    expect(w.find('[data-testid="webhook-last-called"]').text()).toBe('nie')
    w.unmount()
  })

  it('shows the loading state and the error instead of the URLs', () => {
    const loading = mk({ isExisting: true, loading: true })
    expect(loading.find('[data-testid="webhook-call-url"]').exists()).toBe(false)
    loading.unmount()

    const failed = mk({ isExisting: true, error: 'kaputt' })
    expect(failed.text()).toContain('kaputt')
    expect(failed.find('[data-testid="webhook-call-url"]').exists()).toBe(false)
    failed.unmount()
  })

  it('emits rotate-token and disables the button while rotating', async () => {
    const w = mk({ isExisting: true, entry: ENTRY })
    await w.find('[data-testid="webhook-rotate-token"]').trigger('click')
    expect(w.emitted('rotate-token')).toHaveLength(1)
    w.unmount()

    const rotating = mk({ isExisting: true, entry: ENTRY, rotating: true })
    expect(rotating.find('[data-testid="webhook-rotate-token"]').attributes('disabled')).toBeDefined()
    rotating.unmount()
  })
})

describe('BindingFormWebhook — ingress allowlist', () => {
  it('edits the binding allowlist through the shared editor', async () => {
    const cfg = { ...BASE_CFG }
    const w = mk({}, cfg)
    await w.find('[data-testid="allowlist-add"]').trigger('click')
    expect(cfg.allowed_networks).toEqual([''])

    await w.find('[data-testid="allowlist-entry-0"]').setValue('192.168.1.5')
    expect(cfg.allowed_networks).toEqual(['192.168.1.5'])
    w.unmount()
  })

  it('tolerates a config stored before the binding allowlist existed', async () => {
    const cfg = { ...BASE_CFG, allowed_networks: undefined }
    const w = mk({ isExisting: true, entry: ENTRY, overview: { allowed_networks: [] } }, cfg)
    expect(w.find('[data-testid="webhook-origin-warning"]').exists()).toBe(false)
    await w.find('[data-testid="allowlist-add"]').trigger('click')
    expect(cfg.allowed_networks).toEqual([''])
    w.unmount()
  })

  it("shows the instance's allowlist alongside, because both must pass", () => {
    const w = mk({ overview: { allowed_networks: ['10.38.0.0/16'] } })
    expect(w.find('[data-testid="webhook-instance-allowlist"]').text()).toContain('10.38.0.0/16')
    w.unmount()
  })

  it("hides that hint when the instance does not restrict anything", () => {
    const w = mk({ overview: { allowed_networks: [] } })
    expect(w.find('[data-testid="webhook-instance-allowlist"]').exists()).toBe(false)
    w.unmount()
  })

  it('warns when the instance allowlist excludes the host this GUI runs on', () => {
    // happy-dom serves the page from localhost, which 10.38.0.0/16 excludes —
    // exactly the reported case where the copied URL answers 404.
    const w = mk({ isExisting: true, entry: ENTRY, overview: { allowed_networks: ['10.38.0.0/16'] } })
    const warning = w.find('[data-testid="webhook-origin-warning"]')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('Allowlist der Instanz')
    w.unmount()
  })

  it('warns when the binding allowlist excludes it', () => {
    const w = mk(
      { isExisting: true, entry: ENTRY, overview: { allowed_networks: [] } },
      { ...BASE_CFG, allowed_networks: ['10.38.0.0/16'] },
    )
    const warning = w.find('[data-testid="webhook-origin-warning"]')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('Allowlist dieser Verknüpfung')
    w.unmount()
  })

  it('stays quiet when both allowlists cover the host', () => {
    const w = mk(
      { isExisting: true, entry: ENTRY, overview: { allowed_networks: ['127.0.0.0/8'] } },
      { ...BASE_CFG, allowed_networks: ['127.0.0.1'] },
    )
    expect(w.find('[data-testid="webhook-origin-warning"]').exists()).toBe(false)
    w.unmount()
  })

  it('stays quiet when nothing restricts and when no verdict is possible', () => {
    const open = mk({ isExisting: true, entry: ENTRY, overview: { allowed_networks: [] } })
    expect(open.find('[data-testid="webhook-origin-warning"]').exists()).toBe(false)
    open.unmount()

    const undecidable = mk({ isExisting: true, entry: ENTRY, overview: { allowed_networks: ['fd00::/8'] } })
    expect(undecidable.find('[data-testid="webhook-origin-warning"]').exists()).toBe(false)
    undecidable.unmount()
  })
})

describe('BindingFormWebhook — rejection diagnostics', () => {
  it('reports how often calls were turned away and why', () => {
    const w = mk({
      isExisting: true,
      entry: {
        ...ENTRY,
        rejections: {
          total: 3,
          counts: { binding_address_blocked: 3 },
          last_reason: 'binding_address_blocked',
          last_client_ip: '127.0.0.1',
          last_at: '2026-10-06T19:48:49+00:00',
        },
      },
    })
    const box = w.find('[data-testid="webhook-rejections"]')
    expect(box.text()).toContain('3')
    expect(box.text()).toContain('Allowlist der Verknüpfung')
    expect(box.text()).toContain('127.0.0.1')
    w.unmount()
  })

  it('falls back to a dash when the caller address is unknown', () => {
    const w = mk({
      isExisting: true,
      entry: { ...ENTRY, rejections: { total: 1, counts: {}, last_reason: 'rate_limited', last_client_ip: null } },
    })
    expect(w.find('[data-testid="webhook-rejections"]').text()).toContain('—')
    w.unmount()
  })

  it('omits the box entirely when nothing was rejected', () => {
    const none = mk({ isExisting: true, entry: { ...ENTRY, rejections: { total: 0, counts: {} } } })
    expect(none.find('[data-testid="webhook-rejections"]').exists()).toBe(false)
    none.unmount()

    const missing = mk({ isExisting: true, entry: ENTRY })
    expect(missing.find('[data-testid="webhook-rejections"]').exists()).toBe(false)
    missing.unmount()
  })

  it('shows the count without a reason line when the last reason is absent', () => {
    const w = mk({ isExisting: true, entry: { ...ENTRY, rejections: { total: 2, counts: {}, last_reason: null } } })
    const box = w.find('[data-testid="webhook-rejections"]')
    expect(box.exists()).toBe(true)
    expect(box.text()).not.toContain('Zuletzt')
    w.unmount()
  })
})

describe('BindingFormWebhook — copy to clipboard', () => {
  beforeEach(() => {
    delete globalThis.navigator.clipboard
  })

  it('copies the URL and confirms it in the button label', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })

    const w = mk({ isExisting: true, entry: ENTRY })
    const [copyButton] = w.findAll('button').filter(b => b.text() === 'Kopieren')
    await copyButton.trigger('click')
    await w.vm.$nextTick()

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${ENTRY.call_path}`)
    expect(w.text()).toContain('Kopiert')
    w.unmount()
  })

  it('copies the token-in-path URL from its own button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true })

    const w = mk({ isExisting: true, entry: ENTRY })
    const buttons = w.findAll('button').filter(b => b.text() === 'Kopieren')
    await buttons[1].trigger('click')
    await w.vm.$nextTick()

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${ENTRY.call_path_token_in_path}`)
    expect(buttons[1].text()).toBe('Kopiert')
    expect(buttons[0].text()).toBe('Kopieren')
    w.unmount()
  })

  it('keeps the plain label when the clipboard is unavailable', async () => {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })

    const w = mk({ isExisting: true, entry: ENTRY })
    const [copyButton] = w.findAll('button').filter(b => b.text() === 'Kopieren')
    await copyButton.trigger('click')
    await w.vm.$nextTick()

    expect(w.text()).not.toContain('Kopiert')
    w.unmount()
  })
})
