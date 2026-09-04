import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createVisuPreviewBridge,
  VISU_PREVIEW_CHANNEL,
  VISU_PREVIEW_MESSAGE,
  VISU_PREVIEW_PROTOCOL,
} from '@/composables/useVisuPreviewBridge'

/**
 * Die Editor-Seite der Vorschau-Bruecke (C4, Issue #171).
 *
 * Spiegelbild des Empfaengers in apps/visu: der Editor prueft die Herkunft in
 * beide Richtungen, schickt die Admin-Session ausschliesslich per postMessage an
 * den geprueften Origin und stellt sie nie in eine URL oder ein Log.
 */

const PREVIEW_ORIGIN = 'https://obs.example'
const EVIL_ORIGIN = 'https://evil.example'
const TOKEN = 'gui-admin-token-77ab'

function makeFrameWindow() {
  const sent = []
  return {
    sent,
    postMessage(message, targetOrigin) {
      sent.push({ message, targetOrigin })
    },
  }
}

function makeBus() {
  const handlers = new Set()
  return {
    handlerCount: () => handlers.size,
    addEventListener: (_t, h) => handlers.add(h),
    removeEventListener: (_t, h) => handlers.delete(h),
    emit: (ev) => { for (const h of [...handlers]) h(ev) },
  }
}

const DRAFT = { skin: 'edomi', pageId: 'p1', nodes: [{ id: 'p1', parent_id: null, name: 'W', type: 'PAGE', kind: 'normal', page_config: { widgets: [] } }] }

function setup({ previewOrigin = PREVIEW_ORIGIN, token = TOKEN } = {}) {
  const frame = makeFrameWindow()
  const bus = makeBus()
  const events = []
  const bridge = createVisuPreviewBridge({
    previewOrigin,
    listener: bus,
    getFrameWindow: () => frame,
    getSession: () => (token === null ? null : { accessToken: token }),
    getDraft: () => DRAFT,
    onApplied: (p) => events.push(['applied', p]),
    onRejected: (r) => events.push(['rejected', r]),
  })
  return { frame, bus, events, bridge }
}

const readyMessage = (protocol = VISU_PREVIEW_PROTOCOL) => ({
  channel: VISU_PREVIEW_CHANNEL,
  type: VISU_PREVIEW_MESSAGE.ready,
  protocol,
})

describe('useVisuPreviewBridge — Handshake', () => {
  it('antwortet auf preview/ready mit der Session, an den geprueften Origin', () => {
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })

    expect(frame.sent).toHaveLength(1)
    expect(frame.sent[0].targetOrigin).toBe(PREVIEW_ORIGIN)
    expect(frame.sent[0].message).toMatchObject({
      channel: VISU_PREVIEW_CHANNEL,
      type: VISU_PREVIEW_MESSAGE.init,
      protocol: VISU_PREVIEW_PROTOCOL,
      session: { accessToken: TOKEN },
    })
  })

  it('schickt den Entwurf erst, nachdem die Vorschau bestaetigt hat', () => {
    const { frame, bus, bridge } = setup()
    bridge.start()
    bridge.sendDraft()
    expect(frame.sent).toHaveLength(0)

    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    bus.emit({ data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL }, origin: PREVIEW_ORIGIN, source: null })

    const draftMsg = frame.sent.find((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(draftMsg).toBeDefined()
    expect(draftMsg.targetOrigin).toBe(PREVIEW_ORIGIN)
    expect(draftMsg.message.draft).toEqual(DRAFT)
  })

  it('sendet niemals an den Platzhalter-Origin "*"', () => {
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    bus.emit({ data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL }, origin: PREVIEW_ORIGIN, source: null })

    expect(frame.sent.length).toBeGreaterThan(0)
    for (const s of frame.sent) expect(s.targetOrigin).toBe(PREVIEW_ORIGIN)
  })

  it('meldet eine Ablehnung der Vorschau nach oben', () => {
    const { bus, events, bridge } = setup()
    bridge.start()
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.rejected, protocol: '0.9', reason: 'protocol' },
      origin: PREVIEW_ORIGIN,
      source: null,
    })
    expect(events).toEqual([['rejected', 'protocol']])
  })

  it('meldet den gerenderten Entwurf nach oben', () => {
    const { bus, events, bridge } = setup()
    bridge.start()
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.draftApplied, protocol: VISU_PREVIEW_PROTOCOL, pageId: 'p1', widgetCount: 3 },
      origin: PREVIEW_ORIGIN,
      source: null,
    })
    expect(events).toEqual([['applied', { pageId: 'p1', widgetCount: 3 }]])
  })

  it('loest den Listener bei stop() wieder', () => {
    const { bus, frame, bridge } = setup()
    bridge.start()
    expect(bus.handlerCount()).toBe(1)
    bridge.stop()
    expect(bus.handlerCount()).toBe(0)
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    expect(frame.sent).toHaveLength(0)
  })
})

describe('useVisuPreviewBridge — Origin-Pruefung', () => {
  it('ignoriert eine fremde Herkunft vollstaendig', () => {
    const { frame, bus, events, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: EVIL_ORIGIN, source: null })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.draftApplied, protocol: VISU_PREVIEW_PROTOCOL, pageId: 'x', widgetCount: 1 },
      origin: EVIL_ORIGIN,
      source: null,
    })

    expect(frame.sent).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('ignoriert Nachrichten ohne den Kanal-Marker', () => {
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: { type: VISU_PREVIEW_MESSAGE.ready }, origin: PREVIEW_ORIGIN, source: null })
    bus.emit({ data: 'hallo', origin: PREVIEW_ORIGIN, source: null })
    bus.emit({ data: null, origin: PREVIEW_ORIGIN, source: null })
    expect(frame.sent).toHaveLength(0)
  })

  it('baut ohne bekannten Vorschau-Origin gar keine Bruecke auf', () => {
    const { frame, bus, bridge } = setup({ previewOrigin: null })
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    expect(frame.sent).toHaveLength(0)
  })
})

describe('useVisuPreviewBridge — die Session bleibt geheim', () => {
  const spies = []
  beforeEach(() => {
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      spies.push(vi.spyOn(console, level).mockImplementation(() => {}))
    }
  })
  afterEach(() => { for (const s of spies.splice(0)) s.mockRestore() })

  it('schreibt die Session nie in ein Log', () => {
    const { bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    bus.emit({ data: readyMessage(), origin: EVIL_ORIGIN, source: null })
    bus.emit({ data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.rejected, protocol: '0.9', reason: 'protocol' }, origin: PREVIEW_ORIGIN, source: null })

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN)
      }
    }
  })

  it('haengt die Session an keine URL — die Bruecke liefert nur den iframe-Pfad', () => {
    const { bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    expect(bridge.frameSrc('/visu-v2/preview')).toBe('/visu-v2/preview')
    expect(bridge.frameSrc('/visu-v2/preview')).not.toContain(TOKEN)
  })

  it('schickt ohne Session gar nichts los, statt eine leere zu senden', () => {
    const { frame, bus, bridge } = setup({ token: null })
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: null })
    expect(frame.sent).toHaveLength(0)
  })
})
