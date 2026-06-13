import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BlindDevice, JalousieDevice, LightDevice } from '@obs/visu-contract';
import { ObsClient, type WsLike } from './client';
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
  /** Drive an open + flush microtasks so the async connect resolves first. */
  open(): void {
    this.onopen?.();
  }
  /** Deliver a server value-event. */
  emit(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** A flat visu tree with one light, one blind and one jalousie. */
const TREE: ObsVisuNode[] = [
  { id: 'loc', parent_id: null, name: 'EG', type: 'LOCATION', page_config: null },
  {
    id: 'p1',
    parent_id: 'loc',
    name: 'Küche',
    type: 'PAGE',
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
        // unmapped — must be skipped, never crash
        { id: 'cam-1', type: 'Kamera', datapoint_id: null, status_datapoint_id: null, config: {} },
      ],
    },
  },
  {
    id: 'p2',
    parent_id: 'loc',
    name: 'Wintergarten',
    type: 'PAGE',
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
];

/** Initial datapoint values returned by GET …/value. */
const VALUES: Record<string, unknown> = {
  'sw-st': true,
  'pos-st': 30,
  'jpos-st': 40,
  'jslat-st': 35,
};

/**
 * Build a fetch mock that serves /auth/login, /visu/tree and /datapoints/*\/value.
 * Records POST writes so dispatch assertions can inspect the payload.
 */
function makeFetch(opts: { failFirstAuth?: boolean } = {}) {
  const writes: { id: string; value: unknown }[] = [];
  let loginCalls = 0;
  let firstValueCall = !opts.failFirstAuth ? false : true;

  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/auth/login')) {
      loginCalls++;
      return new Response(JSON.stringify({ access_token: `tok-${loginCalls}`, token_type: 'bearer' }), { status: 200 });
    }
    if (u.endsWith('/visu/tree')) {
      return new Response(JSON.stringify(TREE), { status: 200 });
    }
    const valueMatch = u.match(/\/datapoints\/([^/]+)\/value$/);
    if (valueMatch) {
      const id = valueMatch[1];
      if (init?.method === 'POST') {
        writes.push({ id, value: JSON.parse(String(init.body)).value });
        return new Response(null, { status: 204 });
      }
      // GET value: optionally 401 once to exercise the refresh path.
      if (firstValueCall) {
        firstValueCall = false;
        return new Response(JSON.stringify({ detail: 'expired' }), { status: 401 });
      }
      return new Response(JSON.stringify({ value: VALUES[id] ?? null, unit: null }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });

  return { fetchImpl, writes, get loginCalls() { return loginCalls; } };
}

function makeSource(fetchImpl: typeof fetch) {
  const client = new ObsClient({
    apiBase: '/api/v1',
    wsUrl: 'ws://test/api/v1/ws',
    fetchImpl,
    wsFactory: (url, protocols) => new FakeWs(url, protocols),
  });
  return new ObsDataSource(client);
}

beforeEach(() => {
  FakeWs.last = null;
  FakeWs.instances = [];
});

/* ------------------------------------------------------------------ tests */

describe('ObsClient — auth', () => {
  it('logs in once and injects the Bearer token', async () => {
    const { fetchImpl } = makeFetch();
    const client = new ObsClient({ apiBase: '/api/v1', fetchImpl });
    await client.getVisuTree();
    const treeCall = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('/visu/tree'))!;
    expect((treeCall[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-1' });
  });

  it('on 401 drops the token, re-logs in and retries once', async () => {
    const m = makeFetch({ failFirstAuth: true });
    const client = new ObsClient({ apiBase: '/api/v1', fetchImpl: m.fetchImpl });
    // First /value 401 → re-login → retry succeeds.
    const r = await client.getValue('sw-st');
    expect(r.value).toBe(true);
    expect(m.loginCalls).toBe(2);
  });

  it('de-duplicates concurrent logins into one request', async () => {
    const { fetchImpl } = makeFetch();
    const client = new ObsClient({ apiBase: '/api/v1', fetchImpl });
    await Promise.all([client.ensureToken(), client.ensureToken(), client.ensureToken()]);
    const logins = fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith('/auth/login'));
    expect(logins.length).toBe(1);
  });
});

describe('ObsDataSource — list()', () => {
  it('maps the visu tree to devices with initial values, skipping unmapped widgets', async () => {
    const { fetchImpl } = makeFetch();
    const ds = makeSource(fetchImpl);
    const devices = await ds.list();
    expect(devices.map((d) => d.id)).toEqual(['light-1', 'blind-1', 'jal-1']);
    expect((devices[0] as LightDevice).on).toBe(true);
    expect((devices[1] as BlindDevice).position).toBe(30);
    const jal = devices[2] as JalousieDevice;
    expect(jal.position).toBe(40);
    expect(jal.slat).toBe(35);
  });
});

describe('ObsDataSource — subscribe()', () => {
  it('opens a WS with the jwt subprotocol, subscribes the read DPs and applies value-events', async () => {
    const { fetchImpl } = makeFetch();
    const ds = makeSource(fetchImpl);
    await ds.list();

    const patches: DevicePatch[] = [];
    ds.subscribe((p) => patches.push(p));

    // Let the async WS connect (ensureToken) resolve, then open the socket.
    await vi.waitFor(() => expect(FakeWs.last).not.toBeNull());
    const ws = FakeWs.last!;
    expect(ws.protocols).toEqual(['obs.jwt.tok-1']);
    ws.open();

    // A subscribe message with the mapped read datapoints is sent on open.
    const sub = ws.sent.map((s) => JSON.parse(s)).find((m) => m.action === 'subscribe');
    expect(sub.ids).toEqual(expect.arrayContaining(['sw-st', 'pos-st', 'jpos-st', 'jslat-st']));

    // A value-event for the blind position becomes a DevicePatch.
    ws.emit({ id: 'pos-st', v: 80, u: null, t: null, q: 'good' });
    expect(patches).toContainEqual({ id: 'blind-1', changes: { position: 80 } });
  });

  it('closes the socket when the last subscriber unsubscribes', async () => {
    const { fetchImpl } = makeFetch();
    const ds = makeSource(fetchImpl);
    await ds.list();
    const unsub = ds.subscribe(() => {});
    await vi.waitFor(() => expect(FakeWs.last).not.toBeNull());
    const ws = FakeWs.last!;
    const closeSpy = vi.spyOn(ws, 'close');
    unsub();
    expect(closeSpy).toHaveBeenCalled();
  });
});

describe('ObsDataSource — dispatch()', () => {
  it('toggle writes the inverted on state to the on/off DP', async () => {
    const m = makeFetch();
    const ds = makeSource(m.fetchImpl);
    await ds.list(); // light-1 is on (sw-st = true)
    await ds.dispatch('light-1', 'toggle');
    expect(m.writes).toContainEqual({ id: 'sw', value: false });
  });

  it('setPosition writes a 0-100 value to the position DP', async () => {
    const m = makeFetch();
    const ds = makeSource(m.fetchImpl);
    await ds.list();
    await ds.dispatch('blind-1', 'setPosition', { pct: 75 });
    expect(m.writes).toContainEqual({ id: 'pos', value: 75 });
  });

  it('setSlat writes to the slat DP for a jalousie', async () => {
    const m = makeFetch();
    const ds = makeSource(m.fetchImpl);
    await ds.list();
    await ds.dispatch('jal-1', 'setSlat', { pct: 60 });
    expect(m.writes).toContainEqual({ id: 'jslat', value: 60 });
  });

  it('rejects an unknown device', async () => {
    const m = makeFetch();
    const ds = makeSource(m.fetchImpl);
    await ds.list();
    await expect(ds.dispatch('nope', 'toggle')).rejects.toThrow(/unknown device/);
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
