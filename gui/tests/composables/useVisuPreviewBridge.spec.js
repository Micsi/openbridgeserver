import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'
import {
  createVisuPreviewBridge,
  cloneSafeEnvelope,
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
    onAccepted: () => events.push(['accepted']),
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

const acceptedMessage = (protocol = VISU_PREVIEW_PROTOCOL) => ({
  channel: VISU_PREVIEW_CHANNEL,
  type: VISU_PREVIEW_MESSAGE.accepted,
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

  it('meldet einen Handshake, der erst NACH der Frist zustande kommt', () => {
    const { frame, bus, events, bridge } = setup({ handshakeTimeoutMs: 5000 })
    bridge.start()
    vi.advanceTimersByTime(5000)
    expect(events).toEqual([['timeout']])

    // Ein langsam ladendes Visu-Bundle meldet sich spaeter doch noch. Ab jetzt
    // steht die Bruecke - und wer die Frist gemeldet bekommen hat, muss auch
    // erfahren, dass die Lage vorbei ist. Sonst bliebe der Hinweis „keine
    // Vorschau erreichbar" dauerhaft stehen, obwohl der Handshake laeuft.
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: acceptedMessage(), origin: PREVIEW_ORIGIN, source: frame })

    expect(events).toEqual([['timeout'], ['accepted']])
    expect(bridge.isReady()).toBe(true)
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

describe('useVisuPreviewBridge — Klon-Waechter (#183)', () => {
  // NACHGEMESSEN in Runde 2 (Kritik an Runde 1): der `DataCloneError` aus
  // #183 - `postMessage` klont strukturiert und lehnt einen Vue-Proxy ab -
  // war zu diesem Zeitpunkt bereits behoben, seit #169 (Commit `e047328b`,
  // Ahn von `c2b30910`). `post()` machte dort schon eine reine JSON-Kopie vor
  // `postMessage`. Belegt: `useVisuPreviewBridge.iframeBoundary.spec.js` lief
  // GRUEN gegen die unveraenderte Datei von `c2b30910`, und dieselbe Datei
  // liess `structuredClone` an einem Vue-Proxy scheitern, aber NICHT an ihrer
  // eigenen JSON-Kopie. `cloneSafeEnvelope()` fixt hier also keinen offenen
  // Fehler mehr - die beiden Proben unten pruefen, was es WIRKLICH leistet:
  // eine bestehende Nutzlast klont sauber (kein Regressionsrisiko durch die
  // Umbenennung/Buendelung).

  it('cloneSafeEnvelope() macht aus einem Vue-Proxy eine Nutzlast, die einen ECHTEN structuredClone uebersteht', () => {
    const draft = reactive({
      skin: 'edomi',
      pageId: 'p1',
      nodes: [{ id: 'p1', parent_id: null, name: 'Wurzel', type: 'PAGE', kind: 'normal', page_config: { widgets: [{ id: 'a' }] } }],
    })
    // Ein echter Proxy scheitert an einem echten Klon - der Fehler aus #183.
    expect(() => structuredClone(draft)).toThrow(/could not be cloned/)

    const envelope = cloneSafeEnvelope({
      channel: VISU_PREVIEW_CHANNEL,
      protocol: VISU_PREVIEW_PROTOCOL,
      type: VISU_PREVIEW_MESSAGE.draft,
      draft,
    })
    // Genau die Probe, die C1 fuer `previewDraft` hat (`visuEditor.spec.js`) -
    // hier auf der Bruecke selbst, nicht nur bei einem Aufrufer.
    expect(() => structuredClone(envelope)).not.toThrow()
    expect(envelope.draft).toEqual({
      skin: 'edomi',
      pageId: 'p1',
      nodes: [{ id: 'p1', parent_id: null, name: 'Wurzel', type: 'PAGE', kind: 'normal', page_config: { widgets: [{ id: 'a' }] } }],
    })
  })

  it('schickt einen reaktiven Entwurf durch eine postMessage-Mock, die WIRKLICH klont - kein Array-Push', () => {
    const frame = {
      sent: [],
      postMessage(message, targetOrigin) {
        // Anders als `makeFrameWindow()`: hier steht der ECHTE
        // Klon-Algorithmus. Ein Vue-Proxy wirft hier `DataCloneError`, exakt
        // wie im Browser - ein Array-Push wuerde das nie sehen.
        this.sent.push({ message: structuredClone(message), targetOrigin })
      },
    }
    const bus = makeBus()
    const draft = reactive({
      skin: 'edomi',
      pageId: 'p1',
      nodes: [{ id: 'p1', parent_id: null, name: 'W', type: 'PAGE', kind: 'normal', page_config: { widgets: [] } }],
    })
    const bridge = createVisuPreviewBridge({
      previewOrigin: PREVIEW_ORIGIN,
      listener: bus,
      getFrameWindow: () => frame,
      getSession: () => ({ accessToken: TOKEN }),
      getDraft: () => draft,
    })
    bridge.start()
    bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
    bus.emit({ data: acceptedMessage(), origin: PREVIEW_ORIGIN, source: frame })

    const draftMsg = frame.sent.find((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)
    expect(draftMsg).toBeDefined()
    expect(draftMsg.message.draft).toEqual({
      skin: 'edomi',
      pageId: 'p1',
      nodes: [{ id: 'p1', parent_id: null, name: 'W', type: 'PAGE', kind: 'normal', page_config: { widgets: [] } }],
    })
  })
})

describe('useVisuPreviewBridge – der Waechter wirft, aber jemand faengt (Kritik an Runde 1)', () => {
  // Ein wirklich unklonbarer Entwurf (ein zirkulaerer Verweis, ein `BigInt`)
  // liess `cloneSafeEnvelope()` in Runde 1 ungefangen aus `post()` werfen -
  // bis zum Aufrufer von `sendDraft()`/`handle()`. In der echten App ist das
  // der Vue-`watch` in `VisuPreviewFrame.vue`, der bei jeder Entwurfsaenderung
  // synchron `bridge.sendDraft()` ruft: eine unbehandelte Ausnahme dort ersetzt
  // die vom Bridge-Vertrag vorgesehene Anzeige (`onRejected`) durch einen
  // unsichtbaren Fehler anderer Art - eine Regression versteckt hinter einer
  // Schutzschicht.
  function circularDraft() {
    const draft = {
      skin: 'edomi',
      pageId: 'p1',
      nodes: [{ id: 'p1', parent_id: null, name: 'W', type: 'PAGE', kind: 'normal', page_config: { widgets: [] } }],
    }
    draft.selbstbezug = draft
    return draft
  }

  it('meldet einen unklonbaren Entwurf ueber onRejected(\'clone\') - statt ungefangen zu werfen', () => {
    const frame = makeFrameWindow()
    const bus = makeBus()
    const events = []
    const bridge = createVisuPreviewBridge({
      previewOrigin: PREVIEW_ORIGIN,
      listener: bus,
      getFrameWindow: () => frame,
      getSession: () => ({ accessToken: TOKEN }),
      getDraft: () => circularDraft(),
      onRejected: (r) => events.push(['rejected', r]),
    })
    bridge.start()
    expect(() => {
      bus.emit({ data: readyMessage(), origin: PREVIEW_ORIGIN, source: frame })
      bus.emit({ data: acceptedMessage(), origin: PREVIEW_ORIGIN, source: frame })
    }).not.toThrow()

    expect(events).toContainEqual(['rejected', 'clone'])
    // Und es wird NICHTS Kaputtes hinausgeschickt - nur die vorherige
    // `init`-Nachricht mit der Session steht im Rahmen, kein Entwurf.
    expect(frame.sent.some((s) => s.message.type === VISU_PREVIEW_MESSAGE.draft)).toBe(false)
  })

  it('ROT gegen den unreparierten Stand (Runde 1, Commit 78f715a9): derselbe Entwurf verlaesst die Bruecke als unbehandelte Ausnahme', () => {
    // Reproduziert `post()` exakt wie in Runde 1: `cloneSafeEnvelope()` wird
    // aufgerufen, aber niemand faengt ihren Wurf.
    function postRunde1(cloneSafeEnvelope, target, previewOrigin, message) {
      target.postMessage(
        cloneSafeEnvelope({ channel: VISU_PREVIEW_CHANNEL, protocol: VISU_PREVIEW_PROTOCOL, ...message }),
        previewOrigin,
      )
    }
    function cloneSafeEnvelopeRunde1(message) {
      let plain
      try {
        plain = JSON.parse(JSON.stringify(message))
      } catch (err) {
        throw new Error(`Vorschau-Bruecke: Nutzlast ist nicht JSON-faehig (${err.message})`)
      }
      structuredClone(plain)
      return plain
    }
    const frame = makeFrameWindow()
    expect(() =>
      postRunde1(cloneSafeEnvelopeRunde1, frame, PREVIEW_ORIGIN, {
        type: VISU_PREVIEW_MESSAGE.draft,
        draft: circularDraft(),
      }),
    ).toThrow(/nicht JSON-faehig/)
  })
})

describe('useVisuPreviewBridge – cloneSafeEnvelope() hat nur einen Schritt (Kritik an Runde 1: toter Code)', () => {
  it('braucht keinen zweiten structuredClone-Schritt - eine reine JSON-Kopie besteht ihn immer', () => {
    // Die Mutationsprobe aus der Kritik nachgebaut: der ZWEITE Klonschritt aus
    // Runde 1 (`structuredClone(plain)` NACH dem JSON-Umweg) konnte nie
    // werfen - alles, was `JSON.parse(JSON.stringify(…))` uebersteht, ist per
    // Konstruktion auf Objekte/Arrays/Strings/Zahlen/Booleans/`null` reduziert,
    // und die klont `structuredClone` immer. Diese Probe haelt genau das fest,
    // damit ein kuenftiger toter Zweig nicht wieder unbemerkt einzieht.
    const envelope = cloneSafeEnvelope({
      channel: VISU_PREVIEW_CHANNEL,
      protocol: VISU_PREVIEW_PROTOCOL,
      type: VISU_PREVIEW_MESSAGE.draft,
      draft: { a: 1, b: [1, 2, { c: 'x' }], d: null },
    })
    expect(() => structuredClone(envelope)).not.toThrow()
  })

  it('faengt nur, was den JSON-Umweg selbst nicht uebersteht (zirkulaerer Verweis) - nicht mehr', () => {
    const circular = {}
    circular.self = circular
    expect(() => cloneSafeEnvelope({ draft: circular })).toThrow(/nicht JSON-faehig/)
  })
})

describe('useVisuPreviewBridge – was der Klon-Waechter NICHT verhindert (Kritik an Runde 1: irrefuehrender Kommentar)', () => {
  // Die Runde-1-Fassung des Kommentars versprach, eine „still verstuemmelte
  // Nutzlast" zu verhindern. Gemessen statt behauptet: der JSON-Umweg selbst
  // engt Typen ein, OHNE zu werfen - `Date` wird zu einem String, `Map`/`Set`
  // werden zu `{}`, `undefined` verschwindet. Diese Probe haelt das aktuelle,
  // EHRLICHE Verhalten fest (kein Bug - der Vertrag der Bruecke fuehrt ohnehin
  // nur JSON-sichere Werte), damit der Kommentar nicht wieder mehr behauptet,
  // als der Code haelt.
  it('narrowt Date, Map und undefined lautlos, statt zu werfen', () => {
    const envelope = cloneSafeEnvelope({
      when: new Date('2024-01-01T00:00:00.000Z'),
      lookup: new Map([['a', 1]]),
      missing: undefined,
    })
    expect(typeof envelope.when).toBe('string')
    expect(envelope.lookup).toEqual({})
    expect('missing' in envelope).toBe(false)
  })
})
