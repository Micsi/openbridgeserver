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

function setup({ previewOrigin = PREVIEW_ORIGIN, token = TOKEN, handshakeTimeoutMs } = {}) {
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
    onTimeout: () => events.push(['timeout']),
    ...(handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs }),
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
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })

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

    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL }, origin: PREVIEW_ORIGIN, source: frame })

    const draftMsg = frame.sent.find((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(draftMsg).toBeDefined()
    expect(draftMsg.targetOrigin).toBe(PREVIEW_ORIGIN)
    expect(draftMsg.message.draft).toEqual(DRAFT)
  })

  it('sendet niemals an den Platzhalter-Origin "*"', () => {
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL }, origin: PREVIEW_ORIGIN, source: frame })

    expect(frame.sent.length).toBeGreaterThan(0)
    for (const s of frame.sent) expect(s.targetOrigin).toBe(PREVIEW_ORIGIN)
  })

  it('meldet eine Ablehnung der Vorschau nach oben', () => {
    const { frame, bus, events, bridge } = setup()
    bridge.start()
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.rejected, protocol: VISU_PREVIEW_PROTOCOL, reason: 'payload' },
      origin: PREVIEW_ORIGIN,
      source: frame,
    })
    expect(events).toEqual([['rejected', 'payload']])
  })

  it('meldet den gerenderten Entwurf nach oben', () => {
    const { frame, bus, events, bridge } = setup()
    bridge.start()
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.draftApplied, protocol: VISU_PREVIEW_PROTOCOL, pageId: 'p1', widgetCount: 3 },
      origin: PREVIEW_ORIGIN,
      source: frame,
    })
    expect(events).toEqual([['applied', { pageId: 'p1', widgetCount: 3 }]])
  })

  it('loest den Listener bei stop() wieder', () => {
    const { bus, frame, bridge } = setup()
    bridge.start()
    expect(bus.handlerCount()).toBe(1)
    bridge.stop()
    expect(bus.handlerCount()).toBe(0)
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    expect(frame.sent).toHaveLength(0)
  })
})

describe('useVisuPreviewBridge — Origin-Pruefung', () => {
  it('ignoriert eine fremde Herkunft vollstaendig', () => {
    const { frame, bus, events, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: EVIL_ORIGIN, source: frame })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.draftApplied, protocol: VISU_PREVIEW_PROTOCOL, pageId: 'x', widgetCount: 1 },
      origin: EVIL_ORIGIN,
      source: frame,
    })

    expect(frame.sent).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('ignoriert Nachrichten ohne den Kanal-Marker', () => {
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: { type: VISU_PREVIEW_MESSAGE.ready }, origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: 'hallo', origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: null, origin: PREVIEW_ORIGIN, source: frame })
    expect(frame.sent).toHaveLength(0)
  })

  it('baut ohne bekannten Vorschau-Origin gar keine Bruecke auf', () => {
    const { frame, bus, bridge } = setup({ previewOrigin: null })
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    expect(frame.sent).toHaveLength(0)
  })
})

describe('useVisuPreviewBridge — Quellenpruefung', () => {
  it('nimmt nichts von einem anderen Fenster an, auch bei passender Herkunft', () => {
    // Der Normalfall ist same-origin (FastAPI liefert GUI und Visu aus). Ohne
    // Quellenpruefung koennte dort JEDES gleich-origin Fenster `accepted`,
    // `rejected` und `draft-applied` faelschen - Spiegelbild von receiver.ts.
    const { frame, bus, events, bridge } = setup()
    const fremdesFenster = makeFrameWindow()
    bridge.start()

    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: fremdesFenster })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL },
      origin: PREVIEW_ORIGIN,
      source: fremdesFenster,
    })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.rejected, protocol: VISU_PREVIEW_PROTOCOL, reason: 'protocol' },
      origin: PREVIEW_ORIGIN,
      source: fremdesFenster,
    })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.draftApplied, protocol: VISU_PREVIEW_PROTOCOL, pageId: 'p1', widgetCount: 9 },
      origin: PREVIEW_ORIGIN,
      source: fremdesFenster,
    })

    // Keine Session hinaus, kein Handshake, keine falsche Meldung an den Autor.
    expect(frame.sent).toHaveLength(0)
    expect(fremdesFenster.sent).toHaveLength(0)
    expect(events).toHaveLength(0)
    expect(bridge.isReady()).toBe(false)
  })
})

describe('useVisuPreviewBridge — erst die Version, dann die Session', () => {
  it('schickt die Admin-Session nicht an eine Vorschau mit anderer Version', () => {
    const { frame, bus, events, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage('0.9'), origin: PREVIEW_ORIGIN, source: frame })

    // Nichts gesendet - die Pruefung liegt VOR dem Senden, nicht danach.
    expect(frame.sent).toHaveLength(0)
    expect(events).toEqual([['rejected', 'protocol']])
    expect(bridge.isReady()).toBe(false)
  })

  it('bleibt nach einer Versionsabweichung zu, auch wenn die Vorschau weiterredet', () => {
    const { frame, bus, events, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage('0.9'), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL },
      origin: PREVIEW_ORIGIN,
      source: frame,
    })

    expect(frame.sent).toHaveLength(0)
    expect(events).toEqual([['rejected', 'protocol']])
  })
})

describe('useVisuPreviewBridge — wenn gar keine Vorschau antwortet', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('meldet nach der Frist, dass der Handshake nicht zustande kam', () => {
    const { events, bridge } = setup({ handshakeTimeoutMs: 5000 })
    bridge.start()
    expect(events).toHaveLength(0)

    vi.advanceTimersByTime(5000)
    expect(events).toEqual([['timeout']])
  })

  it('meldet nichts, sobald der Handshake steht', () => {
    const { frame, bus, events, bridge } = setup({ handshakeTimeoutMs: 5000 })
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({
      data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.accepted, protocol: VISU_PREVIEW_PROTOCOL },
      origin: PREVIEW_ORIGIN,
      source: frame,
    })

    vi.advanceTimersByTime(60000)
    expect(events.some(([name]) => name === 'timeout')).toBe(false)
  })

  it('laesst die Frist nach stop() nicht weiterlaufen', () => {
    const { events, bridge } = setup({ handshakeTimeoutMs: 5000 })
    bridge.start()
    bridge.stop()
    vi.advanceTimersByTime(60000)
    expect(events).toHaveLength(0)
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
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: readyMessage(), origin: EVIL_ORIGIN, source: frame })
    bus.emit({ data: { channel: VISU_PREVIEW_CHANNEL, type: VISU_PREVIEW_MESSAGE.rejected, protocol: '0.9', reason: 'protocol' }, origin: PREVIEW_ORIGIN, source: frame })

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN)
      }
    }
  })

  it('haengt die Session an nichts an, was das Fenster verlaesst', () => {
    // Frueher stand hier `frameSrc`, eine Identitaetsfunktion, die nur fuer
    // diesen Test existierte. Geprueft wird jetzt der einzige Weg, den die
    // Session tatsaechlich nimmt: die Nachricht an den geprueften Origin.
    const { frame, bus, bridge } = setup()
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })

    expect(frame.sent).toHaveLength(1)
    const { message: msg, targetOrigin } = frame.sent[0]
    expect(targetOrigin).toBe(PREVIEW_ORIGIN)
    expect(msg.session).toEqual({ accessToken: TOKEN })
    // Ausser im Session-Feld taucht das Token nirgends auf - kein Anhang an
    // einen Pfad, keine Kopie in einem anderen Feld.
    expect(JSON.stringify({ ...msg, session: undefined })).not.toContain(TOKEN)
    // Und es gibt keine tote Identitaetsfunktion mehr, die das nur behauptet.
    expect(bridge.frameSrc).toBeUndefined()
  })

  it('schickt ohne Session gar nichts los, statt eine leere zu senden', () => {
    const { frame, bus, bridge } = setup({ token: null })
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    expect(frame.sent).toHaveLength(0)
  })
})
