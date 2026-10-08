import { describe, it, expect } from 'vitest'
import { knxDeviceChipLabel, knxDeviceChipTitle } from '@/utils/knxDeviceLabel'

describe('knxDeviceLabel (#1266)', () => {
  it('shows address and name, or the address alone', () => {
    expect(knxDeviceChipLabel({ id: '1.1.21', label: 'Testgeraet 21' })).toBe('1.1.21 Testgeraet 21')
    expect(knxDeviceChipLabel({ pa: '1.1.22', name: 'Aktor' })).toBe('1.1.22 Aktor')
    expect(knxDeviceChipLabel({ id: '1.1.23', label: '1.1.23' })).toBe('1.1.23')
    expect(knxDeviceChipLabel({ id: '1.1.24' })).toBe('1.1.24')
    expect(knxDeviceChipLabel({})).toBe('')
    expect(knxDeviceChipLabel(null)).toBe('')
  })

  it('puts the device details into the title', () => {
    expect(knxDeviceChipTitle({ id: '1.1.21', label: 'Testgeraet 21', manufacturer: 'MDT technologies', order_number: '' })).toBe(
      '1.1.21 · Testgeraet 21 · MDT technologies',
    )
    expect(knxDeviceChipTitle({ pa: '1.1.22', name: 'Aktor', order_number: 'AKS-0816' })).toBe('1.1.22 · Aktor · AKS-0816')
    expect(knxDeviceChipTitle(null)).toBe('')
  })
})
