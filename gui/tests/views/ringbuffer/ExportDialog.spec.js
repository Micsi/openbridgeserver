/**
 * Tests for ExportDialog.vue (#427) — CSV/TSV export modal triggered from
 * the monitor topbar. Verifies the form state, settings hydration, and
 * the API call sequence on "Exportieren".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let exportMultiCsv
let getExportSettings
let putExportSettings

beforeEach(() => {
  exportMultiCsv = vi.fn().mockResolvedValue({
    data: new Blob(['ts,value\n2026-05-12T10:00:00Z,1\n']),
    headers: { 'content-disposition': 'attachment; filename="ringbuffer_export_20260512.csv"' },
  })
  getExportSettings = vi.fn().mockResolvedValue({
    data: { format: 'csv', encoding: 'utf8', include_unit: true, include_matched_set_ids: false },
  })
  putExportSettings = vi.fn().mockResolvedValue({ data: {} })

  vi.doMock('@/api/client', () => ({
    ringbufferApi: { exportMultiCsv, getExportSettings, putExportSettings },
  }))

  // Stub Modal so v-model works and the slot renders even when soft-backdrop logic isn't loaded
  vi.doMock('@/components/ui/Modal.vue', () => ({
    default: {
      name: 'Modal',
      props: ['modelValue', 'title', 'softBackdrop', 'maxWidth'],
      emits: ['update:modelValue'],
      template: `
        <div v-if="modelValue" data-testid="modal-stub">
          <slot />
          <div data-testid="modal-footer-slot"><slot name="footer" /></div>
        </div>
      `,
    },
  }))
  vi.doMock('@/components/ui/Spinner.vue', () => ({
    default: { name: 'Spinner', template: '<span />' },
  }))

  // URL/Blob/Document polyfills are present in jsdom; spy createObjectURL to avoid noise
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock')
  else vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.doUnmock('@/api/client')
  vi.doUnmock('@/components/ui/Modal.vue')
  vi.doUnmock('@/components/ui/Spinner.vue')
  vi.resetModules()
})

async function mountDialog(props = {}) {
  const mod = await import('@/views/ringbuffer/ExportDialog.vue')
  return mount(mod.default, {
    props: { modelValue: true, setIds: [], time: null, ...props },
    attachTo: document.body,
  })
}

describe('ExportDialog', () => {
  it('hydrates form from getExportSettings on open', async () => {
    getExportSettings.mockResolvedValueOnce({
      data: { format: 'tsv', encoding: 'utf8-bom', include_unit: false, include_matched_set_ids: true },
    })
    const wrapper = await mountDialog()
    await flushPromises()
    expect(getExportSettings).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="export-format-tsv"]').element.checked).toBe(true)
    expect(wrapper.find('[data-testid="export-encoding"]').element.value).toBe('utf8-bom')
    expect(wrapper.find('[data-testid="export-include-unit"]').element.checked).toBe(false)
    expect(wrapper.find('[data-testid="export-include-matched"]').element.checked).toBe(true)
    wrapper.unmount()
  })

  it('falls back to defaults when getExportSettings fails', async () => {
    getExportSettings.mockRejectedValueOnce(new Error('boom'))
    const wrapper = await mountDialog()
    await flushPromises()
    expect(wrapper.find('[data-testid="export-format-csv"]').element.checked).toBe(true)
    expect(wrapper.find('[data-testid="export-encoding"]').element.value).toBe('utf8')
    wrapper.unmount()
  })

  it('persists settings AND posts the export with the current form state', async () => {
    const wrapper = await mountDialog({ setIds: ['set-a', 'set-b'], time: { from: '2026-05-01T00:00:00Z' } })
    await flushPromises()

    await wrapper.find('[data-testid="export-format-tsv"]').setValue(true)
    await wrapper.find('[data-testid="export-include-matched"]').setValue(true)
    await wrapper.find('[data-testid="btn-export-go"]').trigger('click')
    await flushPromises()

    expect(putExportSettings).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'tsv', include_matched_set_ids: true }),
    )
    expect(exportMultiCsv).toHaveBeenCalledWith(
      expect.objectContaining({
        set_ids: ['set-a', 'set-b'],
        time: { from: '2026-05-01T00:00:00Z' },
        format: 'tsv',
        include_matched_set_ids: true,
      }),
    )
    wrapper.unmount()
  })

  it('emits update:modelValue(false) after a successful export', async () => {
    const wrapper = await mountDialog()
    await flushPromises()
    await wrapper.find('[data-testid="btn-export-go"]').trigger('click')
    await flushPromises()
    const events = wrapper.emitted('update:modelValue') || []
    expect(events.flat()).toContain(false)
    wrapper.unmount()
  })

  it('shows an error message and stays open when the export fails', async () => {
    exportMultiCsv.mockRejectedValueOnce({ response: { data: { detail: 'too many rows' } } })
    const wrapper = await mountDialog()
    await flushPromises()
    await wrapper.find('[data-testid="btn-export-go"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="export-error"]').text()).toContain('too many rows')
    wrapper.unmount()
  })

  it('cancel button closes the modal without calling the export', async () => {
    const wrapper = await mountDialog()
    await flushPromises()
    await wrapper.find('[data-testid="btn-export-cancel"]').trigger('click')
    expect(exportMultiCsv).not.toHaveBeenCalled()
    const events = wrapper.emitted('update:modelValue') || []
    expect(events.flat()).toContain(false)
    wrapper.unmount()
  })
})
