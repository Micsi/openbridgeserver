import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { BlindDevice, Device, JalousieDevice, LightDevice, SwitchDevice } from '@obs/visu-contract';
import { ObsClient, WsHandle, type WsLike } from './client';
import { ObsDataSource, obsDataSourceFromEnv } from './obs-datasource';
import { MockDataSource, type DevicePatch } from '../datasource';
import { useDeviceStore } from '../store';
import type { ObsVisuNode } from './mapping';

/** Eine Runde Ereignisschleife: der Wirt laedt auf die Meldung hin async neu. */
const ruheR4 = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/* ------------------------------------------------------------ test doubles */

/**
 * A controllable fake WebSocket matching the WsLike surface - und zwar mit dem
 * ZUSTAND einer echten Verbindung: `CONNECTING` -> `OPEN` -> `CLOSED`.
 *
 * Das ist kein Beiwerk. Ein Doppel, das sofort offen ist und beim Senden nie
 * wirft, ist genau an der Naht reibungsfrei, an der die Wirklichkeit bricht:
 * der Browser wirft bei `send()` vor dem Oeffnen
 * `InvalidStateError: Failed to execute 'send' on 'WebSocket': Still in
 * CONNECTING state.` (WHATWG-WebSocket, `send`, Schritt 1) - und dieser Wurf
 * riss bis M5 C3 R4 den ganzen `init`-Weg des Wirts mit sich, sodass fuer jeden
 * ANGEMELDETEN Benutzer keine Sichtbarkeitsmeldung mehr ankam. Nach demselben
 * Absatz ist `send()` auf `CLOSING`/`CLOSED` dagegen still - kein Wurf, die
 * Daten fallen weg. Beides wird hier nachgebildet, sonst waere das Doppel
 * freundlicher als die Wirklichkeit.
 */
class FakeWs implements WsLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  onopen: (() => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readonly sent: string[] = [];
  /** Was in den Aufbau hinein gesendet WERDEN sollte (nur zur Diagnose). */
  readonly refused: string[] = [];
  readyState: number = FakeWs.CONNECTING;
  static last: FakeWs | null = null;
  static instances: FakeWs[] = [];

  constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    FakeWs.last = this;
    FakeWs.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState === FakeWs.CONNECTING) {
      this.refused.push(data);
      const err = new Error("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.");
      err.name = 'InvalidStateError';
      throw err;
    }
    // CLOSING/CLOSED: die Norm schweigt hier, sie wirft nicht.
    if (this.readyState !== FakeWs.OPEN) {
      this.refused.push(data);
      return;
    }
    this.sent.push(data);
  }
  close(): void {
    if (this.readyState === FakeWs.CLOSED) return;
    this.readyState = FakeWs.CLOSED;
    this.onclose?.({ code: 1000 });
  }
  /** Drive an open so the subscribe-on-open path runs. */
  open(): void {
    this.readyState = FakeWs.OPEN;
    this.onopen?.();
  }
  /** Deliver a server value-event. */
  emit(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** Close with a specific code (e.g. 4001 = auth rejected). */
  closeWith(code: number): void {
    if (this.readyState === FakeWs.CLOSED) return;
    this.readyState = FakeWs.CLOSED;
    this.onclose?.({ code });
  }
}

/**
 * A flat visu tree: a public location with a public page (light + blind), a
 * PIN-protected page (jalousie), and a readonly page (switch) that inherits its
 * access from a readonly parent location (parent-traversal).
 */
const TREE: ObsVisuNode[] = [
  { id: 'loc', parent_id: null, name: 'EG', type: 'LOCATION', page_config: null, access: null },
  {
    id: 'p1',
    parent_id: 'loc',
    name: 'Küche',
    type: 'PAGE',
    access: null, // inherits → public
    page_config: {
      widgets: [
        {
          id: 'light-1',
          name: 'Wand',
          type: 'Licht',
          datapoint_id: null,
          status_datapoint_id: null,
          config: { label: 'Wand', mode: 'switch', dp_switch: 'sw', dp_switch_status: 'sw-st' },
        },
        {
          id: 'blind-1',
          name: 'Rollladen',
          type: 'Rolladen',
          datapoint_id: null,
          status_datapoint_id: null,
          config: { label: 'Rollladen', mode: 'rolladen', dp_position: 'pos', dp_position_status: 'pos-st' },
        },
        { id: 'cam-1', type: 'Kamera', datapoint_id: null, status_datapoint_id: null, config: {} },
      ],
    },
  },
  {
    id: 'p2',
    parent_id: 'loc',
    name: 'Wintergarten',
    type: 'PAGE',
    access: 'protected',
    page_config: {
      widgets: [
        {
          id: 'jal-1',
          name: 'Jalousie',
          type: 'Rolladen',
          datapoint_id: null,
          status_datapoint_id: null,
          config: {
            label: 'Jalousie',
            mode: 'jalousie',
            dp_position: 'jpos',
            dp_position_status: 'jpos-st',
            dp_slat: 'jslat',
            dp_slat_status: 'jslat-st',
          },
        },
      ],
    },
  },
  { id: 'loc2', parent_id: null, name: 'Technik', type: 'LOCATION', page_config: null, access: 'readonly' },
  {
    id: 'p3',
    parent_id: 'loc2',
    name: 'Heizung',
    type: 'PAGE',
    access: null, // inherits readonly from loc2
    page_config: {
      widgets: [
        {
          id: 'switch-1',
          name: 'Pumpe',
          type: 'Toggle',
          datapoint_id: 'tg',
          status_datapoint_id: 'tg-read',
          config: { label: 'Pumpe' },
        },
      ],
    },
  },
];

const VALUES: Record<string, unknown> = {
  'sw-st': true,
  'pos-st': 30,
  'jpos-st': 40,
  'jslat-st': 35,
  'tg-read': true,
};

interface FetchOpts {
  /** datapoint ids that answer 404 (concealed) on GET …/value. */
  concealRead?: string[];
  /** datapoint ids that answer 403 (forbidden) on POST …/value. */
  forbidWrite?: string[];
}

/**
 * A page-scoped fetch mock serving /visu/tree, /visu/nodes/{id}/auth,
 * /visu/nodes/{id}/writable and /datapoints/*\/value. Records write payloads and
 * the page/session headers each request carried.
 */
function makeFetch(opts: FetchOpts = {}, tree: ObsVisuNode[] = TREE, values: Record<string, unknown> = VALUES) {
  const writes: { id: string; value: unknown; pageId?: string; token?: string }[] = [];
  const valueReads: { id: string; pageId?: string; token?: string }[] = [];
  const writableCalls: { pageId: string; token?: string }[] = [];
  const authCalls: { nodeId: string }[] = [];
  const conceal = new Set(opts.concealRead ?? []);
  const forbid = new Set(opts.forbidWrite ?? []);

  const hdr = (init?: RequestInit, key = 'X-Page-Id') =>
    (init?.headers as Record<string, string> | undefined)?.[key];

  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const pageId = hdr(init, 'X-Page-Id');
    const token = hdr(init, 'X-Session-Token');

    const authMatch = u.match(/\/visu\/nodes\/([^/]+)\/auth$/);
    if (authMatch) {
      authCalls.push({ nodeId: authMatch[1] });
      const pin = JSON.parse(String(init?.body)).pin;
      if (pin !== '1234') return new Response(JSON.stringify({ detail: 'Falscher PIN' }), { status: 401 });
      return new Response(JSON.stringify({ session_token: 'sess-xyz', expires_in: 3600 }), { status: 200 });
    }

    if (u.endsWith('/visu/tree')) {
      return new Response(JSON.stringify(tree), { status: 200 });
    }

    const writableMatch = u.match(/\/visu\/nodes\/([^/]+)\/writable$/);
    if (writableMatch) {
      const node = writableMatch[1];
      writableCalls.push({ pageId: node, token });
      let writable: Record<string, boolean> = {};
      if (node === 'p1') writable = { sw: true, pos: false };
      else if (node === 'p2') writable = token === 'sess-xyz' ? { jpos: true, jslat: true } : { jpos: false, jslat: false };
      return new Response(JSON.stringify({ writable }), { status: 200 });
    }

    const valueMatch = u.match(/\/datapoints\/([^/]+)\/value$/);
    if (valueMatch) {
      const id = valueMatch[1];
      if (init?.method === 'POST') {
        if (forbid.has(id)) return new Response(JSON.stringify({ detail: 'locked' }), { status: 403 });
        writes.push({ id, value: JSON.parse(String(init.body)).value, pageId, token });
        return new Response(null, { status: 204 });
      }
      valueReads.push({ id, pageId, token });
      if (conceal.has(id)) return new Response(JSON.stringify({ detail: 'concealed' }), { status: 404 });
      return new Response(JSON.stringify({ value: values[id] ?? null, unit: null }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  return { fetchImpl, writes, valueReads, writableCalls, authCalls };
}

function makeClient(fetchImpl: typeof fetch) {
  return new ObsClient({
    apiBase: '/api/v1',
    wsUrl: 'ws://test/api/v1/ws',
    fetchImpl,
    wsFactory: (url, protocols) => new FakeWs(url, protocols),
  });
}

function makeSource(fetchImpl: typeof fetch, client = makeClient(fetchImpl)) {
  return { ds: new ObsDataSource(client), client };
}

const byId = (devices: Device[], id: string): Device => devices.find((d) => d.id === id)!;

beforeEach(() => {
  FakeWs.last = null;
  FakeWs.instances = [];
});

/* ------------------------------------------------------------------ tests */

describe('ObsDataSource — list() maps the tree with initial values', () => {
  it('maps devices in tree order, skips unmapped widgets, seeds page-scoped values', async () => {
    const { fetchImpl, valueReads } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    const devices = await ds.list();

    expect(devices.map((d) => d.id)).toEqual(['light-1', 'blind-1', 'jal-1', 'switch-1']);
    expect((byId(devices, 'light-1') as LightDevice).on).toBe(true);
    expect((byId(devices, 'blind-1') as BlindDevice).position).toBe(30);
    expect((byId(devices, 'jal-1') as JalousieDevice).slat).toBe(35);

    // Reads carry the owning page's X-Page-Id.
    expect(valueReads.find((r) => r.id === 'sw-st')?.pageId).toBe('p1');
    expect(valueReads.find((r) => r.id === 'jpos-st')?.pageId).toBe('p2');
  });
});

describe('ObsDataSource — writable wiring (Device.writable, v1.5)', () => {
  it('sets writable per device from the page verdict; readonly page → locked', async () => {
    const { fetchImpl, writableCalls } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    const devices = await ds.list();

    expect(byId(devices, 'light-1').writable).toBe(true); // p1 { sw:true }
    expect(byId(devices, 'blind-1').writable).toBe(false); // p1 { pos:false }
    expect(byId(devices, 'jal-1').writable).toBe(false); // p2 without PIN → all false
    expect(byId(devices, 'switch-1').writable).toBe(false); // p3 readonly → locked

    // readonly page is never queried for writability.
    expect(writableCalls.map((c) => c.pageId).sort()).toEqual(['p1', 'p2']);
  });

  it('PIN flow: auth → session token → writable turns true on re-list', async () => {
    const { fetchImpl, writableCalls } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const res = await ds.authenticatePage('p2', '1234');
    expect(res.sessionToken).toBe('sess-xyz');

    const devices = await ds.list();
    expect(byId(devices, 'jal-1').writable).toBe(true); // p2 { jpos:true, jslat:true }
    // The writable call for p2 now carries the session token.
    expect(writableCalls.filter((c) => c.pageId === 'p2').at(-1)?.token).toBe('sess-xyz');
  });

  it('a wrong PIN throws an auth error and leaves the device locked', async () => {
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    await expect(ds.authenticatePage('p2', '0000')).rejects.toThrow(/PIN/);
  });
});

describe('ObsDataSource — concealment tolerance', () => {
  it('a 404 read yields no value (mapping default), never crashes', async () => {
    const { fetchImpl } = makeFetch({ concealRead: ['pos-st'] });
    const { ds } = makeSource(fetchImpl);
    const devices = await ds.list();
    // pos-st concealed → blind stays at its mapping default position 0.
    expect((byId(devices, 'blind-1') as BlindDevice).position).toBe(0);
  });

  it('a failing writable endpoint leaves the page devices non-writable', async () => {
    const base = makeFetch();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.match(/\/visu\/nodes\/p1\/writable$/)) return new Response('boom', { status: 500 });
      return base.fetchImpl(url, init);
    });
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    const devices = await ds.list();
    // p1's writable call threw → no map → its devices fall back to non-writable.
    expect(byId(devices, 'light-1').writable).toBe(false);
    expect(byId(devices, 'blind-1').writable).toBe(false);
  });

  it('tolerates a filtered tree (a page whose parent is absent → public)', async () => {
    const orphan: ObsVisuNode[] = [
      {
        id: 'orphan',
        parent_id: 'missing-parent',
        name: 'Solo',
        type: 'PAGE',
        access: null,
        page_config: {
          widgets: [
            { id: 't', name: 'T', type: 'Toggle', datapoint_id: 'tg', status_datapoint_id: 'tg-read', config: {} },
          ],
        },
      },
    ];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(orphan), { status: 200 });
      if (u.match(/\/writable$/)) return new Response(JSON.stringify({ writable: { tg: true } }), { status: 200 });
      if (u.match(/\/value$/)) return new Response(JSON.stringify({ value: true, unit: null }), { status: 200 });
      return new Response('nf', { status: 404 });
    });
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    const devices = await ds.list();
    expect(devices.map((d) => d.id)).toEqual(['t']);
    expect((byId(devices, 't') as SwitchDevice).writable).toBe(true); // effective public
  });
});

/** Stub a working localStorage carrying an optional pre-seeded visu_jwt. */
function stubStorage(jwt?: string): Map<string, string> {
  const store = new Map<string, string>();
  if (jwt) store.set('visu_jwt', jwt);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

describe('ObsDataSource – subscribe() guest mode: page-scoped polling (no context-less WS)', () => {
  /** A fetch whose datapoint values are mutable, so a poll round can observe change. */
  function makePollFetch() {
    const state: Record<string, unknown> = { ...VALUES };
    const valueReads: { id: string; pageId?: string; token?: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const headers = init?.headers as Record<string, string> | undefined;
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(TREE), { status: 200 });
      if (u.match(/\/writable$/)) return new Response(JSON.stringify({ writable: {} }), { status: 200 });
      const vm = u.match(/\/datapoints\/([^/]+)\/value$/);
      if (vm) {
        valueReads.push({ id: vm[1], pageId: headers?.['X-Page-Id'], token: headers?.['X-Session-Token'] });
        return new Response(JSON.stringify({ value: state[vm[1]] ?? null, unit: null }), { status: 200 });
      }
      return new Response('nf', { status: 404 });
    });
    return { fetchImpl, state, valueReads };
  }

  it('opens NO WebSocket and polls getValue per DP (X-Page-Id), applying changed values', async () => {
    vi.useFakeTimers();
    const { fetchImpl, state, valueReads } = makePollFetch();
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    await ds.list(); // seeds blind-1 position 30 (pos-st)
    valueReads.length = 0;

    const patches: DevicePatch[] = [];
    const unsub = ds.subscribe((p) => patches.push(p));

    // Guest → no socket is ever created.
    expect(FakeWs.last).toBeNull();

    // Immediate poll round runs; reads carry the owning page's X-Page-Id.
    await vi.advanceTimersByTimeAsync(0);
    expect(valueReads.find((r) => r.id === 'sw-st')?.pageId).toBe('p1');
    expect(valueReads.find((r) => r.id === 'jpos-st')?.pageId).toBe('p2');
    // Unchanged values produce no patch (still equal to the list() seed).
    expect(patches).toEqual([]);

    // A value that changes between rounds surfaces as a patch on the next tick.
    state['pos-st'] = 80;
    await vi.advanceTimersByTimeAsync(4000);
    expect(patches).toContainEqual({ id: 'blind-1', changes: { position: 80 } });

    unsub();
    vi.useRealTimers();
  });

  it('emits when a datapoint concealed at list becomes readable during a later poll', async () => {
    vi.useFakeTimers();
    let concealPos = true;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(TREE), { status: 200 });
      if (u.match(/\/writable$/)) return new Response(JSON.stringify({ writable: {} }), { status: 200 });
      const vm = u.match(/\/datapoints\/([^/]+)\/value$/);
      if (vm) {
        const id = vm[1];
        if (id === 'pos-st' && concealPos) return new Response('{}', { status: 404 });
        return new Response(JSON.stringify({ value: VALUES[id] ?? null, unit: null }), { status: 200 });
      }
      return new Response('nf', { status: 404 });
    });
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    await ds.list(); // pos-st concealed → never seeded into the poll baseline

    const patches: DevicePatch[] = [];
    const unsub = ds.subscribe((p) => patches.push(p)); // immediate poll: pos-st still 404
    concealPos = false; // right restored: pos-st now readable (=30) on the next tick
    await vi.advanceTimersByTimeAsync(4000);
    // First time pos-st has a value → emitted even though the baseline lacked it.
    expect(patches).toContainEqual({ id: 'blind-1', changes: { position: 30 } });
    unsub();
    vi.useRealTimers();
  });

  it('tolerates a 404/403 poll read (no value, no crash) and stops the timer on unsubscribe', async () => {
    vi.useFakeTimers();
    const { fetchImpl, valueReads } = makeFetch({ concealRead: ['pos-st'] });
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    valueReads.length = 0;

    const patches: DevicePatch[] = [];
    const unsub = ds.subscribe((p) => patches.push(p));
    // Immediate poll: pos-st answers 404 → skipped, blind stays put, no throw.
    await vi.advanceTimersByTimeAsync(0);
    // At least one non-concealed read still happened (e.g. sw-st) → loop is alive.
    expect(valueReads.some((r) => r.id === 'sw-st')).toBe(true);
    expect(patches).toEqual([]);

    // Unsubscribe stops the poll loop: no further value reads occur.
    unsub();
    valueReads.length = 0;
    await vi.advanceTimersByTimeAsync(12000);
    expect(valueReads).toEqual([]);
    vi.useRealTimers();
  });
});

describe('ObsDataSource – subscribe() logged-in mode: principal-scoped WS via obs.jwt subprotocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens ONE WS with the obs.jwt.<token> subprotocol, no JWT in the URL; 4001 → no reconnect; live revocation reduces scope', async () => {
    vi.useFakeTimers();
    stubStorage('jwt-abc');
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const patches: DevicePatch[] = [];
    ds.subscribe((p) => patches.push(p));

    const ws = FakeWs.last!;
    expect(FakeWs.instances.length).toBe(1);
    // JWT rides in the subprotocol; the URL carries neither the JWT nor a query.
    expect(ws.protocols).toEqual(['obs.jwt.jwt-abc']);
    expect(ws.url).toBe('ws://test/api/v1/ws');
    ws.open();

    const sub = ws.sent.map((s) => JSON.parse(s)).find((m) => m.action === 'subscribe');
    expect(sub.ids).toEqual(expect.arrayContaining(['sw-st', 'pos-st', 'jpos-st', 'jslat-st']));

    // The server-filtered principal feed becomes DevicePatches.
    ws.emit({ id: 'pos-st', v: 80, u: null, t: null, q: 'good' });
    expect(patches).toContainEqual({ id: 'blind-1', changes: { position: 80 } });

    // Live right-revocation: an event for a DP no longer in scope is ignored.
    patches.length = 0;
    ws.emit({ id: 'ghost-dp', v: 1 });
    expect(patches).toEqual([]);

    // 4001 (auth rejected) → no reconnect loop.
    ws.closeWith(4001);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.instances.length).toBe(1);
    vi.useRealTimers();
  });

  it('closes the principal socket when the last subscriber unsubscribes', async () => {
    stubStorage('jwt-abc');
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    const unsub = ds.subscribe(() => {});
    const ws = FakeWs.last!;
    const closeSpy = vi.spyOn(ws, 'close');
    unsub();
    expect(closeSpy).toHaveBeenCalled();
  });

  it('a second subscriber reuses the open principal socket (no new WS)', async () => {
    stubStorage('jwt-abc');
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    const u1 = ds.subscribe(() => {});
    const u2 = ds.subscribe(() => {}); // first === false → re-subscribes ids on the same WS
    expect(FakeWs.instances.length).toBe(1);
    u1();
    u2();
  });

  it('switches poll↔WS when auth flips across re-subscribe (login / logout)', async () => {
    vi.useFakeTimers();
    const store = stubStorage(); // guest first (no JWT)
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const unsubGuest = ds.subscribe(() => {});
    expect(FakeWs.last).toBeNull(); // guest → poll, no socket
    unsubGuest(); // stops the poll loop

    store.set('visu_jwt', 'jwt-xyz'); // now logged in
    const unsubUser = ds.subscribe(() => {});
    expect(FakeWs.last?.protocols).toEqual(['obs.jwt.jwt-xyz']); // logged in → WS
    unsubUser();

    store.delete('visu_jwt'); // logout → back to guest
    FakeWs.last = null;
    const unsubGuest2 = ds.subscribe(() => {});
    expect(FakeWs.last).toBeNull(); // guest again → poll, no new socket
    unsubGuest2();
    vi.useRealTimers();
  });
});

describe('ObsDataSource — dispatch()', () => {
  it('toggle writes the inverted state with the page-scoped X-Page-Id header', async () => {
    const m = makeFetch();
    const { ds } = makeSource(m.fetchImpl);
    await ds.list(); // light-1 on (sw-st=true), writable (p1 sw:true)
    await ds.dispatch('light-1', 'toggle');
    expect(m.writes).toContainEqual({ id: 'sw', value: false, pageId: 'p1', token: undefined });
  });

  it('a non-writable device swallows the action (no write attempted)', async () => {
    const m = makeFetch();
    const { ds } = makeSource(m.fetchImpl);
    await ds.list(); // blind-1 non-writable (p1 pos:false)
    await ds.dispatch('blind-1', 'setPosition', { pct: 75 });
    expect(m.writes.find((w) => w.id === 'pos')).toBeUndefined();
  });

  it('a 403 write is silent, marks the device non-writable and emits a patch', async () => {
    const m = makeFetch({ forbidWrite: ['sw'] });
    const { ds } = makeSource(m.fetchImpl);
    await ds.list(); // light-1 writable per verdict, but the write path is locked
    const patches: DevicePatch[] = [];
    ds.subscribe((p) => patches.push(p));

    await expect(ds.dispatch('light-1', 'toggle')).resolves.toBeUndefined(); // no throw
    expect(patches).toContainEqual({ id: 'light-1', changes: { writable: false } });
    // A second dispatch is now swallowed (device locked).
    await ds.dispatch('light-1', 'toggle');
    expect(m.writes.filter((w) => w.id === 'sw')).toEqual([]);
  });

  it('rejects an unknown device', async () => {
    const m = makeFetch();
    const { ds } = makeSource(m.fetchImpl);
    await ds.list();
    await expect(ds.dispatch('nope', 'toggle')).rejects.toThrow(/unknown device/);
  });

  it('propagates a non-403 write failure (e.g. a 500)', async () => {
    const base = makeFetch();
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.match(/\/datapoints\/[^/]+\/value$/) && init?.method === 'POST') {
        return new Response(JSON.stringify({ detail: 'boom' }), { status: 500 });
      }
      return base.fetchImpl(url, init);
    });
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    await ds.list(); // light-1 writable (p1 sw:true)
    await expect(ds.dispatch('light-1', 'toggle')).rejects.toThrow(/HTTP 500/);
  });
});

describe('ObsClient — page-scoped WebSocket auth', () => {
  it('builds the page_id + session_token query when a context is supplied', () => {
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(
      () => {},
      () => ({ pageId: 'p2', sessionToken: 'sess-xyz' }),
    );
    const ws = FakeWs.last!;
    expect(ws.url).toBe('ws://test/api/v1/ws?page_id=p2&session_token=sess-xyz');
    handle.close();
  });

  it('opens a principal-scoped socket via the obs.jwt subprotocol, keeping the JWT out of the URL', () => {
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(
      () => {},
      () => ({ jwt: 'tok-123' }),
    );
    const ws = FakeWs.last!;
    expect(ws.url).toBe('ws://test/api/v1/ws'); // no query at all
    expect(ws.protocols).toEqual(['obs.jwt.tok-123']);
    handle.close();
  });

  it('does not reconnect after a 4001 (auth rejected) close', () => {
    vi.useFakeTimers();
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(() => {});
    const ws = FakeWs.last!;
    expect(FakeWs.instances.length).toBe(1);

    ws.closeWith(4001);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.instances.length).toBe(1); // no reconnect
    handle.close();
    vi.useRealTimers();
  });

  it('does reconnect after a non-4001 close', () => {
    vi.useFakeTimers();
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(() => {});
    const ws = FakeWs.last!;
    ws.closeWith(1006); // abnormal → schedule reconnect
    vi.advanceTimersByTime(2000);
    expect(FakeWs.instances.length).toBe(2);
    handle.close();
    vi.useRealTimers();
  });

  it('re-sends the FULL, deduplicated subscription set on the reconnected socket (#186)', () => {
    // Micsi/openbridgeserver#186: `it('does reconnect after a non-4001 close')`
    // (oben) zählt nur, DASS eine zweite Verbindung entsteht - nie, was sie
    // sendet. Diese Probe sieht in die gesendete Nachricht hinein: der volle
    // Satz muss ankommen, keine Id doppelt und keine verloren. Ohne das
    // Nachsenden in `WsHandle.connect` → `onopen` (`if (this.ids.size > 0)
    // this.sendSubscribe([...this.ids])`) bliebe der Satz an dieser Stelle rot.
    vi.useFakeTimers();
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(() => {});

    const ws1 = FakeWs.last!;
    handle.subscribe(['a', 'b']);
    ws1.open(); // treibt den Aufbau: `onopen` sendet den gepufferten Satz
    handle.subscribe(['b', 'c']); // 'b' ist schon abonniert - nur 'c' ist neu

    const sentOnFirst = ws1.sent.flatMap((s) => (JSON.parse(s) as { ids: string[] }).ids);
    // Über die erste Verbindung ging jede Id genau EINMAL hinaus, nicht doppelt.
    expect(sentOnFirst.sort()).toEqual(['a', 'b', 'c']);

    ws1.closeWith(1006); // abnormal → schedule reconnect
    vi.advanceTimersByTime(2000);
    expect(FakeWs.instances.length).toBe(2);

    const ws2 = FakeWs.last!;
    ws2.open(); // treibt den WIEDERAUFBAU: derselbe `onopen`-Pfad

    const subscribeMsgs = ws2.sent.map((s) => JSON.parse(s) as { action: string; ids: string[] });
    expect(subscribeMsgs).toHaveLength(1); // ein einziges Nachsenden, kein Mehrfachversand
    // Der vollständige Satz aller drei Ids - keine Dublette, keine verlorene Id.
    expect(subscribeMsgs[0].action).toBe('subscribe');
    expect(subscribeMsgs[0].ids.sort()).toEqual(['a', 'b', 'c']);
    expect(new Set(subscribeMsgs[0].ids).size).toBe(subscribeMsgs[0].ids.length);

    handle.close();
    vi.useRealTimers();
  });

  it('close() clears a pending reconnect timer', () => {
    vi.useFakeTimers();
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(() => {});
    FakeWs.last!.closeWith(1006); // schedule a reconnect
    handle.close(); // close before it fires → timer cleared
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.instances.length).toBe(1); // no reconnect happened
    vi.useRealTimers();
  });

  it('omits session_token from the query when no page scope is set', () => {
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket(
      () => {},
      () => ({ sessionToken: 'orphan-token' }), // no pageId → no query at all
    );
    expect(FakeWs.last!.url).toBe('ws://test/api/v1/ws');
    handle.close();
  });

  it('ignores malformed and non-value WS messages, closes on error', () => {
    const seen: unknown[] = [];
    const client = makeClient(vi.fn() as unknown as typeof fetch);
    const handle = client.openWebSocket((ev) => seen.push(ev));
    const ws = FakeWs.last!;
    ws.onmessage?.({ data: '{not json' }); // parse error → ignored
    ws.onmessage?.({ data: JSON.stringify({ foo: 1 }) }); // no id/v → ignored
    expect(seen).toEqual([]);
    const closeSpy = vi.spyOn(ws, 'close');
    ws.onerror?.(); // error handler closes the socket
    expect(closeSpy).toHaveBeenCalled();
    handle.close();
  });
});

describe('ObsClient — REST error taxonomy & session expiry', () => {
  it('surfaces a generic error for a non-4xx failure (HTTP 500)', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getWritable('p1')).rejects.toThrow(/HTTP 500/);
  });

  it('drops an expired PIN session token', async () => {
    vi.useFakeTimers();
    const { fetchImpl } = makeFetch();
    const client = makeClient(fetchImpl);
    await client.authenticatePin('p2', '1234');
    expect(client.sessionToken('p2')).toBe('sess-xyz');
    vi.advanceTimersByTime(3600 * 1000 + 1); // past expires_in
    expect(client.sessionToken('p2')).toBe(null);
    vi.useRealTimers();
  });

  it('a failed PIN auth with a non-401 status throws a generic error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.authenticatePin('p2', '1234')).rejects.toThrow(/PIN auth failed/);
  });
});

describe('obsDataSourceFromEnv — opt-in', () => {
  it('returns null when neither flag is set (mock stays default)', () => {
    expect(obsDataSourceFromEnv({})).toBe(null);
  });
  it('returns a source when VITE_USE_OBS=1', () => {
    expect(obsDataSourceFromEnv({ VITE_USE_OBS: '1' })).toBeInstanceOf(ObsDataSource);
  });
  it('returns a source when VITE_OBS_API is set', () => {
    expect(obsDataSourceFromEnv({ VITE_OBS_API: 'http://host/api/v1' })).toBeInstanceOf(ObsDataSource);
  });
});

/* Keep a reference to WsHandle so an unused-import lint never trips. */
describe('WsHandle export', () => {
  it('is exported for typing', () => {
    expect(WsHandle).toBeTypeOf('function');
  });
});

/* ------------------------------------------------- JWT login (Welle L, opt-in) */

describe('ObsDataSource — JWT login surface', () => {
  /** A working in-memory localStorage (jsdom's default here lacks the methods). */
  function installStorage(): void {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  }

  /** A client whose fetch answers `/auth/login` with a token pair. */
  function authClient(opts: { badCreds?: boolean } = {}) {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) {
        if (opts.badCreds) return new Response('unauthorized', { status: 401 });
        return new Response(JSON.stringify({ access_token: 'acc-123', refresh_token: 'ref-456' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return new ObsClient({ apiBase: '/api/v1', fetchImpl });
  }

  beforeEach(() => {
    installStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is a guest until login, then reports authenticated', async () => {
    const ds = new ObsDataSource(authClient());
    expect(ds.isAuthenticated()).toBe(false);
    await ds.login('alice', 's3cret');
    expect(ds.isAuthenticated()).toBe(true);
  });

  it('logout drops the session → back to guest', async () => {
    const ds = new ObsDataSource(authClient());
    await ds.login('alice', 's3cret');
    ds.logout();
    expect(ds.isAuthenticated()).toBe(false);
  });

  it('a bad credential rejects and leaves the source a guest', async () => {
    const ds = new ObsDataSource(authClient({ badCreds: true }));
    await expect(ds.login('mallory', 'nope')).rejects.toThrow();
    expect(ds.isAuthenticated()).toBe(false);
  });
});

/* ---------------------------------------------- page gates (Welle 3b, opt-in) */

describe('ObsDataSource – pageGates() for PIN/login gating', () => {
  /** A working in-memory localStorage (guest by default; a jwt marks logged in). */
  function installStorage(jwt?: string): void {
    const store = new Map<string, string>();
    if (jwt) store.set('visu_jwt', jwt);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists a protected page as gated; public/readonly pages are never gated', async () => {
    installStorage();
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const gates = ds.pageGates();
    // Only the protected page p2 (Wintergarten) needs a gate; p1 public + p3
    // readonly do not – reading is never forced.
    expect(gates).toEqual([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]);
  });

  it('drops the protected page from the gate list once its PIN is entered', async () => {
    installStorage();
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    expect(ds.pageGates().map((g) => g.pageId)).toContain('p2');

    await ds.authenticatePage('p2', '1234'); // session token now held for p2
    await ds.list(); // recompute gates

    expect(ds.pageGates()).toEqual([]);
  });

  it('a wrong PIN leaves the protected page gated (rejects, no unlock)', async () => {
    installStorage();
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    await expect(ds.authenticatePage('p2', '0000')).rejects.toThrow(/PIN/);
    await ds.list();
    expect(ds.pageGates().map((g) => g.pageId)).toContain('p2');
  });

  /** A tree with a single `user`-level page (a Toggle), inheriting nothing. */
  const USER_TREE: ObsVisuNode[] = [
    {
      id: 'pu',
      parent_id: null,
      name: 'Zentrale',
      type: 'PAGE',
      access: 'user',
      page_config: {
        widgets: [
          { id: 'u-tg', name: 'Zentral', type: 'Toggle', datapoint_id: 'utg', status_datapoint_id: 'utg-st', config: {} },
        ],
      },
    },
  ];

  function userFetch() {
    return vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(USER_TREE), { status: 200 });
      if (u.match(/\/writable$/)) return new Response(JSON.stringify({ writable: {} }), { status: 200 });
      if (u.match(/\/value$/)) return new Response(JSON.stringify({ value: null, unit: null }), { status: 200 });
      return new Response('nf', { status: 404 });
    }) as unknown as typeof fetch;
  }

  it('gates a user-level page while the caller is a guest', async () => {
    installStorage(); // no jwt → guest
    const { ds } = makeSource(userFetch());
    await ds.list();
    expect(ds.pageGates()).toEqual([{ pageId: 'pu', name: 'Zentrale', access: 'user' }]);
  });

  it('does not gate a user-level page once logged in (JWT present)', async () => {
    installStorage('acc-jwt'); // pre-seeded visu_jwt → logged in
    const { ds } = makeSource(userFetch());
    await ds.list();
    expect(ds.pageGates()).toEqual([]);
  });

  /**
   * Two sibling PAGES (A, B) inherit `protected` from a common ancestor P — P is
   * the defining node that holds the PIN. The backend scopes ONE session to P and
   * validates every sibling's reads against P, so a PIN on A must unlock B too.
   */
  const SIBLING_TREE: ObsVisuNode[] = [
    { id: 'P', parent_id: null, name: 'Keller', type: 'LOCATION', page_config: null, access: 'protected' },
    {
      id: 'A',
      parent_id: 'P',
      name: 'Werkstatt',
      type: 'PAGE',
      access: null, // inherits protected from P
      page_config: {
        widgets: [
          {
            id: 'sw-A',
            name: 'Licht A',
            type: 'Toggle',
            datapoint_id: 'dpA',
            status_datapoint_id: 'dpA-st',
            config: { label: 'A' },
          },
        ],
      },
    },
    {
      id: 'B',
      parent_id: 'P',
      name: 'Lager',
      type: 'PAGE',
      access: null, // inherits protected from P
      page_config: {
        widgets: [
          {
            id: 'sw-B',
            name: 'Licht B',
            type: 'Toggle',
            datapoint_id: 'dpB',
            status_datapoint_id: 'dpB-st',
            config: { label: 'B' },
          },
        ],
      },
    },
  ];
  const SIBLING_VALUES: Record<string, unknown> = { 'dpA-st': false, 'dpB-st': true };

  it('a PIN on one sibling unlocks every page under the same defining node', async () => {
    installStorage(); // guest
    const { fetchImpl, valueReads, authCalls } = makeFetch({}, SIBLING_TREE, SIBLING_VALUES);
    const { ds, client } = makeSource(fetchImpl);
    await ds.list();

    // Before the PIN both siblings are gated (no session for defining node P).
    expect(
      ds
        .pageGates()
        .map((g) => g.pageId)
        .sort(),
    ).toEqual(['A', 'B']);

    // A PIN entered on page A authenticates against the DEFINING node P and the
    // session is cached under P — not under the page id.
    await ds.authenticatePage('A', '1234');
    expect(authCalls.at(-1)?.nodeId).toBe('P');
    expect(client.sessionToken('P')).toBe('sess-xyz');

    await ds.list(); // recompute gates + re-read values with the held session

    // Both A AND B fall out of the gate list off a single PIN …
    expect(ds.pageGates()).toEqual([]);
    // … and both pages' reads now carry the session token (backend accepts them).
    const tokenedPages = valueReads.filter((r) => r.token === 'sess-xyz').map((r) => r.pageId);
    expect(new Set(tokenedPages)).toEqual(new Set(['A', 'B']));
  });

  it('a page that is its own defining node is unchanged (auth targets the page itself)', async () => {
    installStorage(); // guest; TREE: p2 sets access on itself → accessNodeId === pageId
    const { fetchImpl, authCalls } = makeFetch();
    const { ds, client } = makeSource(fetchImpl);
    await ds.list();

    await ds.authenticatePage('p2', '1234');
    expect(authCalls.at(-1)?.nodeId).toBe('p2'); // no ancestor sets access → page itself
    expect(client.sessionToken('p2')).toBe('sess-xyz');

    await ds.list();
    expect(ds.pageGates()).toEqual([]);
  });

  it('authenticatePage before any list falls back to the given node id', async () => {
    installStorage();
    const { fetchImpl, authCalls } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    // No list() yet → the page → defining-node map is empty, so auth targets the
    // node id as given (the backend still resolves the defining node itself).
    await ds.authenticatePage('some-node', '1234');
    expect(authCalls.at(-1)?.nodeId).toBe('some-node');
  });
});

describe('ObsDataSource — summary tree: per-page page_config fetch (GET /visu/pages/{id})', () => {
  // The authz /visu/tree returns a NAVIGATION SUMMARY without page_config, so the
  // widgets must be loaded per page. A summary tree + a fetch that serves the
  // per-page config for the accessible page and 404s the concealed one.
  const SUMMARY_TREE: ObsVisuNode[] = [
    { id: 'p-pub', parent_id: null, name: 'Public', type: 'PAGE', page_config: null, access: 'public' },
    { id: 'p-prot', parent_id: null, name: 'Protected', type: 'PAGE', page_config: null, access: 'protected' },
  ];

  function summaryFetch() {
    const pageCalls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(SUMMARY_TREE), { status: 200 });
      const pageMatch = u.match(/\/visu\/pages\/([^/?]+)$/);
      if (pageMatch) {
        const id = pageMatch[1];
        pageCalls.push(id);
        if (id === 'p-pub') {
          return new Response(
            JSON.stringify({
              widgets: [
                { id: 'w-pub', name: 'Public Lamp', type: 'Toggle', datapoint_id: 'dp-pub', status_datapoint_id: null, config: {}, x: 2, y: 4, w: 3, h: 2 },
              ],
            }),
            { status: 200 },
          );
        }
        // protected page without a PIN session → concealed
        return new Response(JSON.stringify({ detail: 'concealed' }), { status: 404 });
      }
      if (u.match(/\/visu\/nodes\/[^/]+\/writable$/)) return new Response(JSON.stringify({ writable: { 'dp-pub': true } }), { status: 200 });
      if (u.match(/\/datapoints\/[^/]+\/value$/)) return new Response(JSON.stringify({ value: true, unit: null }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    return { fetchImpl, pageCalls };
  }

  it('maps devices from the per-page config and skips a concealed page', async () => {
    const { fetchImpl, pageCalls } = summaryFetch();
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    const devices = await ds.list();

    // The accessible page's widget mapped to a device; the concealed page (404)
    // contributed nothing — no throw, just no widgets from it.
    expect(devices.map((d) => d.label)).toEqual(['Public Lamp']);
    expect(devices[0].type).toBe('switch');
    // Both PAGE nodes were probed; the protected one simply 404'd.
    expect(pageCalls.sort()).toEqual(['p-prot', 'p-pub']);
  });

  it('exposes the author position of a mapped widget via positions() (layering W3)', async () => {
    const { fetchImpl } = summaryFetch();
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    const devices = await ds.list();
    const pos = ds.positions();
    const id = devices[0].id as string;
    expect(pos.get(id)).toEqual({ x: 2, y: 4, w: 3, h: 2 });
    // A widget without a box contributes no entry (map stays lean).
    expect(pos.size).toBe(1);
  });

  it('exposes the nav tree + per-page layer stack via navTree()/layersFor() (layering W3c)', async () => {
    const { fetchImpl } = summaryFetch();
    const { ds } = makeSource(fetchImpl as unknown as typeof fetch);
    await ds.list();

    // Both summary pages are visible roots (no children).
    expect(ds.navTree().map((n) => n.id).sort()).toEqual(['p-prot', 'p-pub']);

    // The accessible page composes to an own layer with its mapped widget + box.
    const layers = ds.layersFor('p-pub');
    expect(layers.map((l) => l.origin)).toEqual(['own']);
    expect(layers[0].items[0].id).toBe('w-pub');
    expect(layers[0].items[0].position).toEqual({ x: 2, y: 4, w: 3, h: 2 });

    // The concealed page (404, no page_config) contributes no layer.
    expect(ds.layersFor('p-prot')).toEqual([]);
  });
});

/* ------------------------------------------------- bedingte Sichtbarkeit E16 */

/**
 * Ein Baum mit einer Sichtbarkeitsregel: die Kachel `hidden-1` haengt an
 * `dp-regel`, den sie SELBST NICHT bindet. Genau dieser Fall ist die Probe aufs
 * Exempel - die Datenquelle muss den Regel-Datenpunkt trotzdem lesen, sonst
 * bliebe die Kachel fuer immer verborgen.
 */
const REGEL_TREE: ObsVisuNode[] = [
  {
    id: 'pv',
    parent_id: null,
    name: 'Regelseite',
    type: 'PAGE',
    access: null,
    page_config: {
      widgets: [
        {
          id: 'always-1',
          name: 'Immer da',
          type: 'Toggle',
          datapoint_id: 'tg',
          status_datapoint_id: null,
          config: {},
        },
        {
          id: 'hidden-1',
          name: 'Nur ueber 30',
          type: 'Toggle',
          datapoint_id: 'tg2',
          status_datapoint_id: null,
          config: { visible_when: { datapoint_id: 'dp-regel', op: 'gt', value: 30 } },
        },
      ],
    },
  },
];

describe('ObsDataSource - die Sichtbarkeitsregel wirkt in der ausgelieferten Visu (E16)', () => {
  it('laesst ein Element mit unerfuellter Regel aus Geraeten UND Ebenen heraus', async () => {
    const { fetchImpl, valueReads } = makeFetch({}, REGEL_TREE, { tg: true, tg2: true, 'dp-regel': 21.5 });
    const { ds } = makeSource(fetchImpl);
    const devices = await ds.list();

    expect(devices.map((d) => d.id)).toEqual(['always-1']);
    expect(ds.layersFor('pv').flatMap((l) => l.items.map((i) => i.id))).toEqual(['always-1']);

    // Der Regel-Datenpunkt wurde gelesen, seitenbezogen wie jeder andere - auch
    // wenn ihn kein Geraet bindet. Ohne das koennte die Regel nie umschlagen.
    expect(valueReads.find((r) => r.id === 'dp-regel')).toEqual({
      id: 'dp-regel',
      pageId: 'pv',
      token: undefined,
    });
  });

  it('zeigt dasselbe Element, sobald der Wert die Bedingung erfuellt', async () => {
    const { fetchImpl, valueReads } = makeFetch({}, REGEL_TREE, { tg: true, tg2: true, 'dp-regel': 42 });
    const { ds } = makeSource(fetchImpl);
    const devices = await ds.list();

    expect(devices.map((d) => d.id)).toEqual(['always-1', 'hidden-1']);
    expect(ds.layersFor('pv').flatMap((l) => l.items.map((i) => i.id))).toEqual([
      'always-1',
      'hidden-1',
    ]);
    // Und es kommt MIT seinem Wert zurueck, nicht als leere Huelse: der
    // Lesesatz wurde sichtbarkeitsblind gesammelt, also stand `tg2` darin,
    // bevor irgendeine Regel etwas ausgeblendet hat.
    expect(valueReads.map((r) => r.id).sort()).toEqual(['dp-regel', 'tg', 'tg2']);
    expect((byId(devices, 'hidden-1') as SwitchDevice).on).toBe(true);
  });

  it('liest die Datenpunkte des verborgenen Elements trotzdem mit', async () => {
    // Sonst kaeme es beim Umschlagen der Regel zwar wieder, aber ohne Wert -
    // eine Kachel, die faelschlich AUS zeigt, bis der naechste Aufbau laeuft.
    const { fetchImpl, valueReads } = makeFetch({}, REGEL_TREE, { tg: true, tg2: true, 'dp-regel': 21.5 });
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    expect(valueReads.map((r) => r.id).sort()).toEqual(['dp-regel', 'tg', 'tg2']);
  });

  it('haelt es verborgen, solange der Wert unbekannt ist (kein Aufblitzen)', async () => {
    const { fetchImpl } = makeFetch({ concealRead: ['dp-regel'] }, REGEL_TREE, { tg: true, tg2: true });
    const { ds } = makeSource(fetchImpl);
    expect((await ds.list()).map((d) => d.id)).toEqual(['always-1']);
  });
});

/* ------------------------------------------- E16 LIVE: ohne Neuladen (R3) */

/**
 * Die Zeile **E16** verlangt „Element bedingt sichtbar oder unsichtbar JE NACH
 * DATENPUNKTWERT" - ein laufender Zustand, kein Ladezustand. Bis Runde 2 wertete
 * die ausgelieferte Visu die Regel nur beim Aufbau aus: ein verborgenes Element
 * kam nie zurueck, ein sichtbares verschwand nie. Diese Proben halten beide
 * Richtungen fest, und zwar OHNE ein zweites `list()` von aussen.
 *
 * Der Kern: ein Geraete-Patch kann eine Sichtbarkeit nicht ausdruecken. Er traegt
 * FELDER eines Geraets; hier aendert sich die ZUGEHOERIGKEIT - ein verborgenes
 * Element ist gar kein Geraet. Die Quelle meldet deshalb den Umschwung
 * ({@link ObsDataSource.onVisibilityChange}), der Wirt laedt neu.
 */
describe('ObsDataSource - E16 wirkt live: erscheinen UND verschwinden ohne Neuladen', () => {
  it('meldet den Umschwung, sobald der Regel-Datenpunkt die Bedingung kreuzt', async () => {
    vi.useFakeTimers();
    const werte: Record<string, unknown> = { tg: true, tg2: true, 'dp-regel': 21.5 };
    const { fetchImpl, valueReads } = makeFetch({}, REGEL_TREE, werte);
    const { ds } = makeSource(fetchImpl);

    expect((await ds.list()).map((d) => d.id)).toEqual(['always-1']);

    const umschwung: string[] = [];
    const unsubV = ds.onVisibilityChange(() => umschwung.push('!'));
    const unsub = ds.subscribe(() => {});

    // Erste Runde: nichts hat sich bewegt, also auch kein Umschwung.
    await vi.advanceTimersByTimeAsync(0);
    expect(umschwung).toEqual([]);
    valueReads.length = 0;

    // ERSCHEINEN: 21.5 -> 42 erfuellt `gt 30`. Ohne Neuladen. Und der
    // Regel-Datenpunkt steht im LAUFENDEN Lesesatz - kein Geraet bindet ihn,
    // stuende er nur im Aufbau-Lesesatz, faellt sein Umschwung nie auf.
    werte['dp-regel'] = 42;
    await vi.advanceTimersByTimeAsync(4000);
    expect(valueReads.some((r) => r.id === 'dp-regel')).toBe(true);
    expect(umschwung.length).toBe(1);
    expect((await ds.list()).map((d) => d.id)).toEqual(['always-1', 'hidden-1']);

    // VERSCHWINDEN: 42 -> 21.5. Ebenfalls ohne Neuladen, und die Gegenrichtung
    // ist die Haelfte, die Runde 2 gefehlt hat.
    werte['dp-regel'] = 21.5;
    await vi.advanceTimersByTimeAsync(4000);
    expect(umschwung.length).toBe(2);
    expect((await ds.list()).map((d) => d.id)).toEqual(['always-1']);

    unsub();
    unsubV();
    vi.useRealTimers();
  });

  it('schweigt, wenn der Wert sich bewegt, die Regel aber gleich urteilt', async () => {
    vi.useFakeTimers();
    const werte: Record<string, unknown> = { tg: true, tg2: true, 'dp-regel': 42 };
    const { fetchImpl } = makeFetch({}, REGEL_TREE, werte);
    const { ds } = makeSource(fetchImpl);
    expect((await ds.list()).map((d) => d.id)).toEqual(['always-1', 'hidden-1']);

    const umschwung: string[] = [];
    const unsubV = ds.onVisibilityChange(() => umschwung.push('!'));
    const unsub = ds.subscribe(() => {});

    // 42 -> 50: beide erfuellen `gt 30`. Ein Neuaufbau waere hier reine Unruhe.
    werte['dp-regel'] = 50;
    await vi.advanceTimersByTimeAsync(4000);
    expect(umschwung).toEqual([]);

    unsub();
    unsubV();
    vi.useRealTimers();
  });

  it('haelt den Regel-Datenpunkt auch im angemeldeten Live-Feed (WS) abonniert', async () => {
    vi.useFakeTimers();
    stubStorage('jwt-abc');
    const werte: Record<string, unknown> = { tg: true, tg2: true, 'dp-regel': 21.5 };
    const { fetchImpl } = makeFetch({}, REGEL_TREE, werte);
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const umschwung: string[] = [];
    ds.onVisibilityChange(() => umschwung.push('!'));
    ds.subscribe(() => {});
    const ws = FakeWs.last!;
    ws.open();
    const sub = ws.sent.map((s) => JSON.parse(s)).find((m) => m.action === 'subscribe');
    // Beide Live-Wege muessen den Regel-Datenpunkt sehen, nicht nur der Gast-Takt.
    expect(sub.ids).toEqual(expect.arrayContaining(['dp-regel']));

    ws.emit({ id: 'dp-regel', v: 42, u: null, t: null, q: 'good' });
    expect(umschwung.length).toBe(1);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('meldet den Umschwung genau einmal, bis der Wirt neu geladen hat', async () => {
    vi.useFakeTimers();
    const werte: Record<string, unknown> = { tg: true, tg2: true, 'dp-regel': 21.5 };
    const { fetchImpl } = makeFetch({}, REGEL_TREE, werte);
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const umschwung: string[] = [];
    const unsubV = ds.onVisibilityChange(() => umschwung.push('!'));
    const unsub = ds.subscribe(() => {});

    werte['dp-regel'] = 42;
    await vi.advanceTimersByTimeAsync(4000);
    werte['dp-regel'] = 43;
    await vi.advanceTimersByTimeAsync(4000);
    // Zwei Runden, ein Umschwung: sonst startete jede Runde einen neuen
    // Neuaufbau, waehrend der vorige noch laeuft.
    expect(umschwung.length).toBe(1);

    await ds.list();
    werte['dp-regel'] = 10;
    await vi.advanceTimersByTimeAsync(4000);
    expect(umschwung.length).toBe(2);

    unsub();
    unsubV();
    vi.useRealTimers();
  });
});

/* ------------------------- R4: der angemeldete Weg ueberlebt den Aufbau ---- */

/**
 * Die Naht, an der E16 fuer jeden ANGEMELDETEN Benutzer starb: der Wirt meldet
 * in `store.init` erst den alten Hoerer ab, ruft dann `source.subscribe(...)`
 * und registriert DANACH die Sichtbarkeitsmeldung. Beim Angemeldeten oeffnete
 * `subscribe` den WebSocket und sendete das Abo SOFORT hinterher - in eine
 * Verbindung, die noch im Aufbau steht. Der Browser wirft dort
 * `InvalidStateError`, `init` brach ab, und die Registrierung wurde nie
 * erreicht: „UMSCHWUNG gemeldet an 0 Hoerer".
 *
 * Gemessen wird das hier mit einem Doppel, das den Zustand einer echten
 * Verbindung fuehrt (siehe {@link FakeWs}) - vorher konnte keine Probe das
 * sehen, weil das alte Doppel beim Senden nie warf.
 */
describe('ObsDataSource - abonnieren, ohne in den Verbindungsaufbau zu senden (R4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sendet das Abo erst, wenn die Verbindung offen ist - und dann vollstaendig', async () => {
    stubStorage('jwt-abc');
    const werte: Record<string, unknown> = { tg: true, tg2: true, 'dp-regel': 21.5 };
    const { fetchImpl } = makeFetch({}, REGEL_TREE, werte);
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const umschwung: string[] = [];
    const unsubV = ds.onVisibilityChange(() => umschwung.push('!'));

    // Der Socket steht hier auf CONNECTING. Bis R4 warf dieser Aufruf.
    let unsub: () => void = () => {};
    expect(() => {
      unsub = ds.subscribe(() => {});
    }).not.toThrow();

    const ws = FakeWs.last!;
    expect(ws.readyState).toBe(FakeWs.CONNECTING);
    expect(ws.sent).toEqual([]); // nichts in den Aufbau hinein

    // Offen: jetzt geht das GESAMTE gepufferte Abo raus, samt Regel-Datenpunkt.
    ws.open();
    const sub = ws.sent.map((s) => JSON.parse(s)).find((m) => m.action === 'subscribe');
    // `tg2` fehlt hier zu Recht: `hidden-1` ist bei 21.5 verborgen, sein
    // Datenpunkt bindet also gerade kein Geraet. Der REGEL-Datenpunkt muss
    // trotzdem drin sein - sonst faellt sein Umschwung nie auf.
    expect(sub.ids).toEqual(expect.arrayContaining(['dp-regel', 'tg']));

    // Und der Umschwung kommt an, statt an 0 Hoerer zu gehen.
    ws.emit({ id: 'dp-regel', v: 42, u: null, t: null, q: 'good' });
    expect(umschwung.length).toBe(1);

    unsub();
    unsubV();
  });

  it('der angemeldete WIRT blendet auf den Wertwechsel hin ein - ohne Neuladen', async () => {
    setActivePinia(createPinia());
    stubStorage('jwt-abc');
    const werte: Record<string, unknown> = { tg: true, tg2: true, 'dp-regel': 21.5 };
    const { fetchImpl } = makeFetch({}, REGEL_TREE, werte);
    const { ds } = makeSource(fetchImpl);

    const store = useDeviceStore();
    // Genau der Weg, den die Anmeldung nimmt: `init` mit der obs-Quelle.
    await store.init(ds);
    expect(store.devices.map((d: Device) => d.id)).toEqual(['always-1']);
    expect(store.authenticated).toBe(true);

    const ws = FakeWs.last!;
    ws.open();
    werte['dp-regel'] = 42;
    ws.emit({ id: 'dp-regel', v: 42, u: null, t: null, q: 'good' });
    await ruheR4();

    // ERSCHEINEN, allein auf den Live-Wert hin - kein zweites `list()` von
    // aussen, keine Navigation, kein Neuladen.
    expect(store.devices.map((d: Device) => d.id)).toEqual(['always-1', 'hidden-1']);

    // VERSCHWINDEN: derselbe Weg zurueck, ueber den neu geoeffneten Socket.
    const ws2 = FakeWs.last!;
    expect(ws2).not.toBe(ws);
    ws2.open();
    werte['dp-regel'] = 21.5;
    ws2.emit({ id: 'dp-regel', v: 21.5, u: null, t: null, q: 'good' });
    await ruheR4();
    expect(store.devices.map((d: Device) => d.id)).toEqual(['always-1']);

    await store.init(new MockDataSource()); // Quelle abhaengen, Socket schliessen
  });
});
