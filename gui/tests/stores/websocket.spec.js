import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

let constructorCalls = 0

// Geschaerfte Attrappe (Vorlage: apps/visu/src/core/obs/client.ts / WsHandle):
// bildet CONNECTING/OPEN/CLOSED nach und wirft beim Senden im Aufbau, exakt
// wie ein echtes Browser-WebSocket (InvalidStateError). Damit kann eine Probe
// stilles Verwerfen nicht mehr mit stillem Senden verwechseln.
class FakeWS {
  constructor(url, protocols) {
    constructorCalls++
    this.url = url
    this.protocols = protocols
    this.readyState = 0 // CONNECTING
    this.sent = []
    FakeWS.instance = this
  }
  send(data) {
    if (this.readyState === 0) {
      throw new DOMException(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
        'InvalidStateError'
      )
    }
    if (this.readyState !== 1) return // CLOSING/CLOSED: verwirft still, wie das Original
    this.sent.push(data)
  }
  close(code) {
    this.readyState = 3 // CLOSED
    this.onclose?.({ code })
  }
  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(obj) { this.onmessage?.({ data: JSON.stringify(obj) }) }
  simulateError() { this.onerror?.() }
}
FakeWS.OPEN = 1
FakeWS.CONNECTING = 0
FakeWS.CLOSED = 3

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  constructorCalls = 0
  FakeWS.instance = null
  globalThis.WebSocket = FakeWS
  localStorage.setItem('access_token', 'test-token')
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('access_token')
})

describe('useWebSocketStore', () => {
  it('connect builds a WebSocket URL and sets connected=true on open', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()

    store.connect()
    expect(constructorCalls).toBe(1)
    expect(FakeWS.instance.url).toContain('/api/v1/ws')

    FakeWS.instance.simulateOpen()
    expect(store.connected).toBe(true)
  })

  it('connect does nothing when no access_token in localStorage', async () => {
    localStorage.removeItem('access_token')
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()

    store.connect()
    expect(constructorCalls).toBe(0)
    expect(store.connected).toBe(false)
  })

  it('connect is a no-op when the socket is already OPEN', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()

    store.connect()
    FakeWS.instance.simulateOpen()
    store.connect() // already OPEN → guard fires

    expect(constructorCalls).toBe(1)
  })

  it('handles compact value event and updates liveValues', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    FakeWS.instance.simulateMessage({ id: 'dp-1', v: 42, q: 'good', t: '2024-01-01T00:00:00Z' })

    expect(store.liveValues['dp-1']).toEqual({ value: 42, quality: 'good', ts: '2024-01-01T00:00:00Z' })
  })

  it('handles legacy type:"value" event and updates liveValues', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    FakeWS.instance.simulateMessage({ type: 'value', datapoint_id: 'dp-2', value: 99, quality: 'uncertain', ts: 'now' })

    expect(store.liveValues['dp-2']).toEqual({ value: 99, quality: 'uncertain', ts: 'now' })
  })

  it('calls onValue handlers for compact events', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    const handler = vi.fn()
    store.onValue(handler)
    FakeWS.instance.simulateMessage({ id: 'dp-3', v: 1, q: 'good', t: 'ts' })

    expect(handler).toHaveBeenCalledWith('dp-3', 1, 'good', 'ts')
  })

  it('onValue unregister fn removes the handler', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    const handler = vi.fn()
    const unregister = store.onValue(handler)
    unregister()
    FakeWS.instance.simulateMessage({ id: 'dp-x', v: 1, q: 'good', t: 'ts' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('calls onRingbufferEntry handlers on matching action', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    const handler = vi.fn()
    store.onRingbufferEntry(handler)
    FakeWS.instance.simulateMessage({ action: 'ringbuffer_entry', entry: { id: 99 } })

    expect(handler).toHaveBeenCalledWith({ id: 99 })
  })

  it('onRingbufferEntry unregister fn removes the handler', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    const handler = vi.fn()
    const off = store.onRingbufferEntry(handler)
    off()
    FakeWS.instance.simulateMessage({ action: 'ringbuffer_entry', entry: {} })

    expect(handler).not.toHaveBeenCalled()
  })

  it('calls onLogEntry handlers on matching action', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    const handler = vi.fn()
    store.onLogEntry(handler)
    FakeWS.instance.simulateMessage({ action: 'log_entry', entry: { level: 'ERROR', msg: 'oops' } })

    expect(handler).toHaveBeenCalledWith({ level: 'ERROR', msg: 'oops' })
  })

  it('onLogEntry unregister fn removes the handler', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    const handler = vi.fn()
    const off = store.onLogEntry(handler)
    off()
    FakeWS.instance.simulateMessage({ action: 'log_entry', entry: {} })

    expect(handler).not.toHaveBeenCalled()
  })

  it('replies with pong on server ping action', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    FakeWS.instance.simulateMessage({ action: 'ping' })

    expect(FakeWS.instance.sent).toContainEqual(JSON.stringify({ action: 'pong' }))
  })

  it('subscribe sends subscribe message when OPEN', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    store.subscribe(['dp-1', 'dp-2'])

    expect(FakeWS.instance.sent).toContainEqual(JSON.stringify({ action: 'subscribe', ids: ['dp-1', 'dp-2'] }))
  })

  it('unsubscribe sends unsubscribe message when OPEN', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    store.unsubscribe(['dp-1'])

    expect(FakeWS.instance.sent).toContainEqual(JSON.stringify({ action: 'unsubscribe', ids: ['dp-1'] }))
  })

  // War bis hierher (#185) eine zementierende Probe: sie pinnte, dass ein
  // Abo waehrend des Verbindungsaufbaus stillschweigend verworfen wird, ohne
  // Gegenprobe, dass es je ankommt. Jetzt haelt sie das richtige Verhalten
  // fest - buffern statt verwerfen, nachsenden sobald die Verbindung offen ist.
  it('subscribe buffers ids while the socket is not yet OPEN, and sends them once it opens', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect() // CONNECTING, not yet OPEN

    store.subscribe(['dp-1'])
    expect(FakeWS.instance.sent).toHaveLength(0) // noch nicht gesendet - aber gepuffert, nicht verworfen

    FakeWS.instance.simulateOpen()

    expect(FakeWS.instance.sent).toContainEqual(JSON.stringify({ action: 'subscribe', ids: ['dp-1'] }))
  })

  it('resends the full buffered id set after a reconnect (#185)', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    store.subscribe(['dp-1', 'dp-2'])
    FakeWS.instance.sent = [] // nur den Wiederaufbau beobachten

    FakeWS.instance.close(1000) // Verbindungsabbruch
    vi.advanceTimersByTime(5001) // Wiederaufbau nach 5s -> neue Instanz
    expect(constructorCalls).toBe(2)

    FakeWS.instance.simulateOpen() // neue Verbindung oeffnet

    expect(FakeWS.instance.sent).toContainEqual(
      JSON.stringify({ action: 'subscribe', ids: ['dp-1', 'dp-2'] })
    )
  })

  it('unsubscribe removes ids from the buffer so they are not resent on reconnect', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    store.subscribe(['dp-1', 'dp-2'])
    store.unsubscribe(['dp-1'])
    FakeWS.instance.sent = []

    FakeWS.instance.close(1000)
    vi.advanceTimersByTime(5001)
    FakeWS.instance.simulateOpen()

    expect(FakeWS.instance.sent).toContainEqual(JSON.stringify({ action: 'subscribe', ids: ['dp-2'] }))
    expect(FakeWS.instance.sent).not.toContainEqual(JSON.stringify({ action: 'subscribe', ids: ['dp-1'] }))
  })

  it('disconnect clears the buffered subscription set', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    store.subscribe(['dp-1'])
    store.disconnect()

    store.connect()
    FakeWS.instance.simulateOpen()

    expect(FakeWS.instance.sent).toHaveLength(0)
  })

  it('onclose sets connected=false and schedules reconnect after 5s', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()
    expect(store.connected).toBe(true)

    FakeWS.instance.close(1000)
    expect(store.connected).toBe(false)

    // After the 5-second timer fires, connect() is called again
    vi.advanceTimersByTime(5001)
    expect(constructorCalls).toBe(2)
  })

  it('onclose with code 4001 suppresses reconnect', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    FakeWS.instance.close(4001)
    vi.advanceTimersByTime(6000)

    expect(constructorCalls).toBe(1) // no reconnect
    expect(store.connected).toBe(false)
  })

  it('onerror calls close which triggers reconnect flow', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    FakeWS.instance.simulateError() // onerror → ws.close()
    expect(store.connected).toBe(false)
  })

  it('disconnect prevents reconnect and sets connected=false', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    store.disconnect()
    expect(store.connected).toBe(false)

    vi.advanceTimersByTime(6000)
    expect(constructorCalls).toBe(1) // no reconnect after explicit disconnect
  })

  it('ignores malformed JSON messages without throwing', async () => {
    const { useWebSocketStore } = await import('@/stores/websocket')
    const store = useWebSocketStore()
    store.connect()
    FakeWS.instance.simulateOpen()

    FakeWS.instance.onmessage?.({ data: 'not-valid-json{{' })

    expect(store.connected).toBe(true) // connection unaffected
  })
})
