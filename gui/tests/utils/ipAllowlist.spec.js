import { describe, it, expect } from 'vitest'
import {
  classifyEntry,
  isAddressCovered,
  isLoopbackHost,
  parseIpv4,
  parseIpv4Entry,
} from '@/utils/ipAllowlist'

describe('parseIpv4', () => {
  it.each([
    ['0.0.0.0', 0],
    ['127.0.0.1', 2130706433],
    ['255.255.255.255', 4294967295],
    ['10.38.111.21', 170290965],
  ])('parses %s', (text, expected) => {
    expect(parseIpv4(text)).toBe(expected)
  })

  it.each(['', '  ', '1.2.3', '1.2.3.4.5', '256.0.0.1', 'abc', '1.2.3.-1', null, undefined, 'fd00::1'])(
    'rejects %s',
    (text) => {
      expect(parseIpv4(text)).toBeNull()
    },
  )
})

describe('parseIpv4Entry', () => {
  it('treats a bare address as a host route', () => {
    expect(parseIpv4Entry('192.168.1.5')).toEqual({ address: parseIpv4('192.168.1.5'), prefixLength: 32 })
  })

  it('parses a prefix length', () => {
    expect(parseIpv4Entry('10.0.0.0/8')).toEqual({ address: parseIpv4('10.0.0.0'), prefixLength: 8 })
    expect(parseIpv4Entry(' 10.0.0.0/0 ')).toEqual({ address: parseIpv4('10.0.0.0'), prefixLength: 0 })
  })

  it.each(['', '10.0.0.0/33', '10.0.0.0/x', '10.0.0.0/', '10.0.0.0/-1', 'fd00::/8', '10.0.0.0/999', null, undefined])(
    'rejects %s',
    (text) => {
      expect(parseIpv4Entry(text)).toBeNull()
    },
  )
})

describe('classifyEntry', () => {
  it.each([
    ['10.0.0.0/8', 'valid'],
    ['192.168.1.5', 'valid'],
    ['fd00::/8', 'unchecked'],
    ['::1', 'unchecked'],
    ['10.0.0.0/33', 'invalid'],
    ['999.1.1.1', 'invalid'],
    ['nope', 'invalid'],
    ['', 'invalid'],
    [null, 'invalid'],
    [undefined, 'invalid'],
  ])('classifies %s as %s', (text, expected) => {
    expect(classifyEntry(text)).toBe(expected)
  })
})

describe('isLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each(['10.38.111.21', 'obs.local', '', null])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('isAddressCovered', () => {
  it('covers everything when the allowlist is empty', () => {
    expect(isAddressCovered('127.0.0.1', [])).toBe(true)
    expect(isAddressCovered('obs.local', undefined)).toBe(true)
    expect(isAddressCovered('127.0.0.1', ['', '   '])).toBe(true)
  })

  it('decides IPv4 membership', () => {
    expect(isAddressCovered('10.38.111.21', ['10.38.0.0/16'])).toBe(true)
    expect(isAddressCovered('10.39.0.1', ['10.38.0.0/16'])).toBe(false)
    expect(isAddressCovered('192.168.1.5', ['10.0.0.0/8', '192.168.1.5/32'])).toBe(true)
    expect(isAddressCovered('1.2.3.4', ['0.0.0.0/0'])).toBe(true)
  })

  it('reproduces the reported case: loopback against a LAN allowlist', () => {
    expect(isAddressCovered('localhost', ['10.38.0.0/16'])).toBe(false)
    expect(isAddressCovered('127.0.0.1', ['10.38.0.0/16'])).toBe(false)
    expect(isAddressCovered('10.38.111.21', ['10.38.0.0/16'])).toBe(true)
  })

  it('treats localhost as covered when loopback is listed', () => {
    expect(isAddressCovered('localhost', ['127.0.0.0/8'])).toBe(true)
    expect(isAddressCovered('localhost', ['127.0.0.1'])).toBe(true)
  })

  it('gives no verdict for a hostname it cannot resolve', () => {
    expect(isAddressCovered('obs.local', ['10.38.0.0/16'])).toBeNull()
    expect(isAddressCovered('', ['10.38.0.0/16'])).toBeNull()
    expect(isAddressCovered(null, ['10.38.0.0/16'])).toBeNull()
  })

  it('gives no verdict when an entry cannot be judged', () => {
    expect(isAddressCovered('10.39.0.1', ['fd00::/8'])).toBeNull()
    // …but a positive IPv4 match still wins over an unjudgeable entry.
    expect(isAddressCovered('10.38.0.1', ['fd00::/8', '10.38.0.0/16'])).toBe(true)
  })

  it('recognises an explicitly listed IPv6 loopback for a localhost origin', () => {
    expect(isAddressCovered('::1', ['::1'])).toBe(true)
    expect(isAddressCovered('[::1]', ['::1/128'])).toBe(true)
    expect(isAddressCovered('::1', ['fd00::/8'])).toBeNull()
  })
})
