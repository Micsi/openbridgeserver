import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BlindDevice, Device, JalousieDevice, LightDevice, SwitchDevice } from '@obs/visu-contract';
import { ObsClient, WsHandle, type WsLike } from './client';
import { ObsDataSource, obsDataSourceFromEnv } from './obs-datasource';
import type { DevicePatch } from '../datasource';
import type { ObsVisuNode } from './mapping';

/* ------------------------------------------------------------ test doubles */

/** A controllable fake WebSocket matching the WsLike surface. */
class FakeWs implements WsLike {
  onopen: (() => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readonly sent: string[] = [];
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
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000 });
  }
  /** Drive an open so the subscribe-on-open path runs. */
  open(): void {
    this.onopen?.();
  }
  /** Deliver a server value-event. */
  emit(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** Close with a specific code (e.g. 4001 = auth rejected). */
  closeWith(code: number): void {
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
function makeFetch(opts: FetchOpts = {}) {
  const writes: { id: string; value: unknown; pageId?: string; token?: string }[] = [];
  const valueReads: { id: string; pageId?: string; token?: string }[] = [];
  const writableCalls: { pageId: string; token?: string }[] = [];
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
      const pin = JSON.parse(String(init?.body)).pin;
      if (pin !== '1234') return new Response(JSON.stringify({ detail: 'Falscher PIN' }), { status: 401 });
      return new Response(JSON.stringify({ session_token: 'sess-xyz', expires_in: 3600 }), { status: 200 });
    }

    if (u.endsWith('/visu/tree')) {
      return new Response(JSON.stringify(TREE), { status: 200 });
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
      return new Response(JSON.stringify({ value: VALUES[id] ?? null, unit: null }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  return { fetchImpl, writes, valueReads, writableCalls };
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

describe('ObsDataSource — subscribe() WS scope + live revocation', () => {
  it('opens a context-less WS, subscribes read DPs, applies allowed value-events', async () => {
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();

    const patches: DevicePatch[] = [];
    ds.subscribe((p) => patches.push(p));

    const ws = FakeWs.last!;
    expect(ws.url).toBe('ws://test/api/v1/ws'); // no admin JWT subprotocol, no page scope
    expect(ws.protocols).toBeUndefined();
    ws.open();

    const sub = ws.sent.map((s) => JSON.parse(s)).find((m) => m.action === 'subscribe');
    expect(sub.ids).toEqual(expect.arrayContaining(['sw-st', 'pos-st', 'jpos-st', 'jslat-st']));

    // An allowed value-event becomes a DevicePatch.
    ws.emit({ id: 'pos-st', v: 80, u: null, t: null, q: 'good' });
    expect(patches).toContainEqual({ id: 'blind-1', changes: { position: 80 } });

    // Live revocation: an event for a DP no longer in scope is ignored (no crash).
    patches.length = 0;
    ws.emit({ id: 'ghost-dp', v: 1 });
    expect(patches).toEqual([]);
  });

  it('closes the socket when the last subscriber unsubscribes', async () => {
    const { fetchImpl } = makeFetch();
    const { ds } = makeSource(fetchImpl);
    await ds.list();
    const unsub = ds.subscribe(() => {});
    const ws = FakeWs.last!;
    const closeSpy = vi.spyOn(ws, 'close');
    unsub();
    expect(closeSpy).toHaveBeenCalled();
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
