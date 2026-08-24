import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import HelpButton from '@/components/ui/HelpButton.vue'
import { useHelpStore } from '@/stores/help'

vi.mock('@/api/client', () => ({
  helpApi: { index: vi.fn().mockResolvedValue({ data: { helpIds: {} } }) },
}))

function mountButton(props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(HelpButton, { props: { helpId: 'datapoints-overview', ...props }, global: { plugins: [pinia] } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HelpButton', () => {
  it('renders a button with an accessible label', () => {
    const w = mountButton()
    const button = w.find('button')
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-label')).toBeTruthy()
  })

  it('opens the help drawer for its help_id on click', async () => {
    const w = mountButton({ helpId: 'datapoints-overview' })
    const store = useHelpStore()

    await w.find('button').trigger('click')

    expect(store.isOpen).toBe(true)
    expect(store.currentHelpId).toBe('datapoints-overview')
  })

  it('opens with the help_id from its own props, not a stale one', async () => {
    const w = mountButton({ helpId: 'logic-nodes' })
    const store = useHelpStore()

    await w.find('button').trigger('click')

    expect(store.currentHelpId).toBe('logic-nodes')
  })
})
