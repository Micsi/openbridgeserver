import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * preview/receiver - die Vorschau-Bruecke (C4, Issue #171).
 *
 * Der Empfaenger ist die einzige Stelle, an der ein fremdes Fenster in die Visu
 * hineinreden darf. Diese Spec pinnt die Regeln, die ihn sicher machen:
 *
 *  - Handshake mit klar benannten Nachrichtentypen und einer Versionsangabe.
 *  - Strenge Origin-Pruefung in BEIDE Richtungen: nichts wird von einer fremden
 *    Herkunft angenommen und nichts an eine fremde Herkunft (oder an `'*'`)
 *    gesendet.
 *  - Der Entwurf wird durchgereicht, nie gespeichert: der Empfaenger macht kein
 *    einziges I/O.
 *  - Die Admin-Session taucht nie in URL, Query oder Log auf.
 */
import {
  PREVIEW_CHANNEL,
  PREVIEW_MESSAGE,
  PREVIEW_PROTOCOL_VERSION,
  type PreviewDraft,
} from './protocol';
import { createPreviewReceiver, type PreviewMessageEventLike } from './receiver';
import { allowedPreviewOrigins } from './origins';

const ADMIN_ORIGIN = 'https://admin.example';
const EVIL_ORIGIN = 'https://evil.example';
const TOKEN = 'admin-session-token-3f9c';

/** Ein Postfach, das jede ausgehende Nachricht mit ihrem Ziel-Origin festhaelt. */
function makeParent() {
  const sent: { message: unknown; targetOrigin: string }[] = [];
  return {
    sent,
    postMessage(message: unknown, targetOrigin: string): void {
      sent.push({ message, targetOrigin });
    },
  };
}

/** Ein Bus, ueber den die Spec synthetische `message`-Ereignisse einspeist. */
function makeBus() {
  const handlers = new Set<(ev: PreviewMessageEventLike) => void>();
  return {
    handlerCount: () => handlers.size,
    addEventListener(_type: 'message', handler: (ev: PreviewMessageEventLike) => void): void {
      handlers.add(handler);
    },
    removeEventListener(_type: 'message', handler: (ev: PreviewMessageEventLike) => void): void {
      handlers.delete(handler);
    },
    emit(ev: PreviewMessageEventLike): void {
      for (const h of [...handlers]) h(ev);
    },
  };
}

const DRAFT: PreviewDraft = {
  skin: 'edomi',
  pageId: 'p1',
  nodes: [
    {
      id: 'p1',
      parent_id: null,
      name: 'Wohnen',
      type: 'PAGE',
      kind: 'normal',
      page_config: {
        widgets: [
          {
            id: 'w1',
            type: 'Licht',
            datapoint_id: null,
            status_datapoint_id: null,
            config: { dp_switch: 'dp-1' },
            x: 2,
            y: 3,
            w: 4,
            h: 5,
          },
        ],
      },
    },
  ],
};

function setup(allowedOrigins: readonly string[] = [ADMIN_ORIGIN]) {
  const parent = makeParent();
  const bus = makeBus();
  const sessions: unknown[] = [];
  const drafts: PreviewDraft[] = [];
  const receiver = createPreviewReceiver({
    allowedOrigins,
    parent,
    listener: bus,
    onSession: (s) => sessions.push(s),
    onDraft: (d) => drafts.push(d),
  });
  return { parent, bus, sessions, drafts, receiver };
}

/** Ein `preview/init` aus dem Elternfenster, so wie der Editor es schickt. */
function initMessage(protocol = PREVIEW_PROTOCOL_VERSION) {
  return {
    channel: PREVIEW_CHANNEL,
    type: PREVIEW_MESSAGE.init,
    protocol,
    session: { accessToken: TOKEN },
  };
}

function draftMessage(draft: PreviewDraft = DRAFT) {
  return {
    channel: PREVIEW_CHANNEL,
    type: PREVIEW_MESSAGE.draft,
    protocol: PREVIEW_PROTOCOL_VERSION,
    draft,
  };
}

describe('preview/receiver - Handshake', () => {
  it('meldet sich beim Elternfenster an, mit Version und konkretem Ziel-Origin', () => {
    const { parent, receiver } = setup();
    receiver.start();

    expect(parent.sent).toHaveLength(1);
    expect(parent.sent[0].message).toMatchObject({
      channel: PREVIEW_CHANNEL,
      type: PREVIEW_MESSAGE.ready,
      protocol: PREVIEW_PROTOCOL_VERSION,
    });
    expect(parent.sent[0].targetOrigin).toBe(ADMIN_ORIGIN);
    expect(receiver.status()).toBe('awaiting-init');
  });

  it('sendet niemals an den Platzhalter-Origin "*"', () => {
    const { parent, bus, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });

    expect(parent.sent.length).toBeGreaterThan(0);
    for (const s of parent.sent) {
      expect(s.targetOrigin).not.toBe('*');
      expect(s.targetOrigin).toBe(ADMIN_ORIGIN);
    }
  });

  it('bestaetigt eine gueltige Anmeldung und nimmt danach den Entwurf an', () => {
    const { parent, bus, sessions, drafts, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });

    expect(sessions).toEqual([{ accessToken: TOKEN }]);
    expect(receiver.status()).toBe('ready');
    expect(parent.sent.at(-1)!.message).toMatchObject({ type: PREVIEW_MESSAGE.accepted });

    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].pageId).toBe('p1');
    expect(drafts[0].skin).toBe('edomi');
  });

  it('weist eine abweichende Protokollversion ab und bleibt danach zu', () => {
    const { parent, bus, sessions, drafts, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage('0.9'), origin: ADMIN_ORIGIN, source: parent });

    expect(sessions).toHaveLength(0);
    expect(receiver.status()).toBe('rejected');
    expect(parent.sent.at(-1)!.message).toMatchObject({
      type: PREVIEW_MESSAGE.rejected,
      reason: 'protocol',
      protocol: PREVIEW_PROTOCOL_VERSION,
    });

    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });
    expect(drafts).toHaveLength(0);
  });

  it('merkt sich den Gegenueber erst, wenn die Version geprueft ist', () => {
    // Reihenfolge, nicht Geschmack: `peerOrigin` ist das Ziel jeder spaeteren
    // Rueckmeldung. Wird es schon gesetzt, BEVOR die Version passt, haelt der
    // Empfaenger einen Peer fest, den er gerade abgelehnt hat. Heute bleibt das
    // folgenlos (nach `rejected` sendet er nichts mehr), aber die Reihenfolge
    // ist die Zusage - nicht der Zufall, dass ein zweiter Riegel greift.
    const { parent, bus, receiver } = setup();
    receiver.start();
    expect(receiver.peer()).toBeNull();

    bus.emit({ data: initMessage('0.9'), origin: ADMIN_ORIGIN, source: parent });
    expect(receiver.status()).toBe('rejected');
    expect(receiver.peer()).toBeNull();
  });

  it('merkt sich den Gegenueber, sobald die Version passt', () => {
    // Die Gegenprobe: ohne sie waere „peer bleibt null" auch mit einem
    // Empfaenger gruen, der ihn NIE setzt.
    const { parent, bus, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });

    expect(receiver.status()).toBe('ready');
    expect(receiver.peer()).toBe(ADMIN_ORIGIN);

    receiver.stop();
    expect(receiver.peer()).toBeNull();
  });

  it('prueft die Version an JEDER Nachricht, nicht nur am Handshake', () => {
    const { parent, bus, drafts, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    expect(receiver.status()).toBe('ready');

    // Derselbe geprueffte Peer, aber ploetzlich eine andere Version: das ist ein
    // anders ausgeliefertes gui_dist, kein halb passender Entwurf.
    bus.emit({
      data: { ...draftMessage(), protocol: '2.0' },
      origin: ADMIN_ORIGIN,
      source: parent,
    });

    expect(drafts).toHaveLength(0);
    expect(receiver.status()).toBe('rejected');
    expect(parent.sent.at(-1)!.message).toMatchObject({
      type: PREVIEW_MESSAGE.rejected,
      reason: 'protocol',
    });
  });

  it('nimmt einen Entwurf vor dem Handshake nicht an', () => {
    const { parent, bus, drafts, receiver } = setup();
    receiver.start();
    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });

    expect(drafts).toHaveLength(0);
    expect(parent.sent.at(-1)!.message).toMatchObject({
      type: PREVIEW_MESSAGE.rejected,
      reason: 'handshake',
    });
  });

  it('nimmt einen Entwurf ohne verwertbare Knoten nicht an', () => {
    const { parent, bus, drafts, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    bus.emit({
      data: { channel: PREVIEW_CHANNEL, type: PREVIEW_MESSAGE.draft, protocol: PREVIEW_PROTOCOL_VERSION, draft: { skin: 'edomi' } },
      origin: ADMIN_ORIGIN,
      source: parent,
    });

    expect(drafts).toHaveLength(0);
    expect(parent.sent.at(-1)!.message).toMatchObject({
      type: PREVIEW_MESSAGE.rejected,
      reason: 'payload',
    });
  });

  it('loest den Listener bei stop() wieder', () => {
    const { bus, drafts, receiver, parent } = setup();
    receiver.start();
    expect(bus.handlerCount()).toBe(1);
    receiver.stop();
    expect(bus.handlerCount()).toBe(0);

    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    expect(drafts).toHaveLength(0);
  });
});

describe('preview/receiver - Origin-Pruefung', () => {
  it('weist eine fremde Herkunft ab, ohne ihr zu antworten', () => {
    const { parent, bus, sessions, drafts, receiver } = setup();
    receiver.start();
    const before = parent.sent.length;

    bus.emit({ data: initMessage(), origin: EVIL_ORIGIN, source: parent });
    bus.emit({ data: draftMessage(), origin: EVIL_ORIGIN, source: parent });

    expect(sessions).toHaveLength(0);
    expect(drafts).toHaveLength(0);
    expect(receiver.status()).toBe('awaiting-init');
    // Kein Wort zurueck an die fremde Herkunft - auch keine Ablehnung.
    expect(parent.sent).toHaveLength(before);
  });

  it('weist eine fremde Quelle ab, selbst bei passender Herkunft', () => {
    const { bus, sessions, receiver } = setup();
    receiver.start();
    const other = makeParent();

    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: other });

    expect(sessions).toHaveLength(0);
    expect(receiver.status()).toBe('awaiting-init');
  });

  it('ignoriert Nachrichten ohne den Kanal-Marker', () => {
    const { parent, bus, sessions, receiver } = setup();
    receiver.start();

    bus.emit({ data: { type: PREVIEW_MESSAGE.init, session: { accessToken: TOKEN } }, origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: 'hallo', origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: null, origin: ADMIN_ORIGIN, source: parent });

    expect(sessions).toHaveLength(0);
    expect(receiver.status()).toBe('awaiting-init');
  });

  it('meldet sich bei mehreren erlaubten Herkuenften an jede einzeln an, nie an "*"', () => {
    const second = 'https://admin2.example';
    const { parent, receiver } = setup([ADMIN_ORIGIN, second]);
    receiver.start();

    expect(parent.sent.map((s) => s.targetOrigin)).toEqual([ADMIN_ORIGIN, second]);
  });
});

describe('preview/origins - woher die erlaubte Herkunft kommt', () => {
  it('faellt auf den eigenen Origin zurueck, wenn nichts konfiguriert ist', () => {
    expect(allowedPreviewOrigins({}, { origin: 'https://obs.example' })).toEqual([
      'https://obs.example',
    ]);
  });

  it('liest die erlaubten Herkuenfte aus der Bauzeit-Konfiguration, nicht aus der URL', () => {
    expect(
      allowedPreviewOrigins(
        { VITE_PREVIEW_ALLOWED_ORIGINS: 'https://a.example, https://b.example' },
        { origin: 'https://obs.example' },
      ),
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('ignoriert leere Eintraege in der Konfiguration', () => {
    expect(
      allowedPreviewOrigins({ VITE_PREVIEW_ALLOWED_ORIGINS: ' , ,' }, { origin: 'https://obs.example' }),
    ).toEqual(['https://obs.example']);
  });
});

describe('preview/receiver - Entwurf wird gerendert, nicht gespeichert', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('macht beim Empfangen des Entwurfs kein einziges Netz-I/O', () => {
    const { parent, bus, drafts, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });

    expect(drafts).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('meldet den gerenderten Entwurf zurueck, ohne ihn zu speichern', () => {
    const { parent, bus, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });

    receiver.applied({ pageId: 'p1', widgetCount: 1 });

    expect(parent.sent.at(-1)!.message).toMatchObject({
      type: PREVIEW_MESSAGE.draftApplied,
      protocol: PREVIEW_PROTOCOL_VERSION,
      pageId: 'p1',
      widgetCount: 1,
    });
    expect(parent.sent.at(-1)!.targetOrigin).toBe(ADMIN_ORIGIN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Eine FALLE statt eines Spions auf `Storage.prototype`.
 *
 * Ein `vi.spyOn(Storage.prototype, 'setItem')` faengt nur, was tatsaechlich ueber
 * diesen Prototyp laeuft: ein `sessionStorage.setItem` ging in dieser Umgebung
 * daran vorbei (die Zusicherung blieb gruen), und ein `localStorage.setItem`
 * wurde nur rot, weil die Spionage den Schim der Umgebung zerlegt hat - also
 * durch einen `TypeError`, nicht durch die Zusicherung. Beides ist keine Probe.
 *
 * Hier werden deshalb BEIDE Ablagen durch vollwertige Doppel ersetzt, die jeden
 * Schreibversuch protokollieren und sonst normal funktionieren. Jeder Weg, eine
 * Session zu persistieren - `setItem`, `removeItem`, `clear`, auf welcher der
 * beiden Ablagen auch immer - macht die Zusicherung rot, und zwar durch sich
 * selbst.
 */
function trapStorage(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const originals: [string, PropertyDescriptor | undefined][] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    originals.push([name, Object.getOwnPropertyDescriptor(window, name)]);
    const data = new Map<string, string>();
    const fake = {
      get length(): number {
        return data.size;
      },
      key: (i: number): string | null => Array.from(data.keys())[i] ?? null,
      getItem: (k: string): string | null => data.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        writes.push(`${name}.setItem(${k})`);
        data.set(k, String(v));
      },
      removeItem: (k: string): void => {
        writes.push(`${name}.removeItem(${k})`);
        data.delete(k);
      },
      clear: (): void => {
        writes.push(`${name}.clear()`);
        data.clear();
      },
    } as unknown as Storage;
    Object.defineProperty(window, name, { value: fake, configurable: true, writable: true });
  }
  return {
    writes,
    restore(): void {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(window, name, descriptor);
      }
    },
  };
}

describe('preview/receiver - die Session bleibt geheim', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it('legt die Session nirgends ab - sie geht nur an den Rueckruf', () => {
    // Frueher stand hier eine Zusicherung ueber `window.location`. Die kann nie
    // rot werden: der Empfaenger fasst `location` gar nicht an. Geprueft wird
    // jetzt, was er tatsaechlich koennte - persistieren.
    const trap = trapStorage();
    try {
      const { parent, bus, sessions, receiver } = setup();
      receiver.start();
      bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
      bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });

      // Der einzige Weg nach draussen ist der Rueckruf des Hosts ...
      expect(sessions).toEqual([{ accessToken: TOKEN }]);
      // ... nicht `localStorage` und nicht `sessionStorage`: die Falle haelt
      // JEDEN Schreibversuch auf BEIDEN Ablagen fest, nicht nur den einen Weg
      // ueber `Storage.prototype`.
      expect(trap.writes).toEqual([]);
      // ... und auch nicht eine ausgehende Nachricht.
      for (const s of parent.sent) expect(JSON.stringify(s.message)).not.toContain(TOKEN);
    } finally {
      trap.restore();
    }
  });

  it('und die Falle selbst greift auf beiden Ablagen', () => {
    // Die Gegenprobe zur Zusicherung darueber: eine Falle, die nichts faengt,
    // waere genau das Vakuum, das sie ersetzen soll. Beide Ablagen, beide Wege.
    const trap = trapStorage();
    try {
      window.sessionStorage.setItem('preview_session', TOKEN);
      window.localStorage.setItem('preview_session', TOKEN);
      window.sessionStorage.removeItem('preview_session');
      window.localStorage.clear();
    } finally {
      trap.restore();
    }
    expect(trap.writes).toEqual([
      'sessionStorage.setItem(preview_session)',
      'localStorage.setItem(preview_session)',
      'sessionStorage.removeItem(preview_session)',
      'localStorage.clear()',
    ]);
  });

  it('schreibt die Session nie in ein Log', () => {
    const { parent, bus, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: initMessage('0.9'), origin: EVIL_ORIGIN, source: parent });
    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    }
  });

  it('schickt die Session nie wieder hinaus - auch nicht an den erlaubten Origin', () => {
    const { parent, bus, receiver } = setup();
    receiver.start();
    bus.emit({ data: initMessage(), origin: ADMIN_ORIGIN, source: parent });
    bus.emit({ data: draftMessage(), origin: ADMIN_ORIGIN, source: parent });
    receiver.applied({ pageId: 'p1', widgetCount: 1 });

    for (const s of parent.sent) {
      expect(JSON.stringify(s.message)).not.toContain(TOKEN);
    }
  });
});
