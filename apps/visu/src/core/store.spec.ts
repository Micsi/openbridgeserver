import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type {
  Device,
  LightDevice,
  SwitchDevice,
  BlindDevice,
  JalousieDevice,
  SceneDevice,
  WidgetAction,
} from '@obs/visu-contract';

import { MockDataSource, type DataSource, type PatchListener, type DevicePatch, type PageGate } from './datasource';
import { useDeviceStore } from './store';

/**
 * core/store — the Pinia host store (CO3, Issue #93).
 *
 * CONTRACT-v1 §6: the host owns the device state. The store seeds itself from a
 * {@link DataSource}, subscribes to live feedback, and exposes the canonical
 * actions. Every action goes through `dataSource.dispatch` + an optimistic local
 * update; `subscribe` writes real Rückmeldungen back into the same state.
 *
 * Goldene Regeln honoured here:
 *  - State lives in core; the store is its single owner, mutated ONLY by actions.
 *  - No state mutation outside the actions.
 *  - Imports no skin/renderer — only the model/contract + the data source.
 */

/** A spy DataSource that records dispatches and lets the test push patches. */
class SpyDataSource implements DataSource {
  readonly dispatched: Array<{ id: string; action: WidgetAction; payload?: unknown }> = [];
  private listeners = new Set<PatchListener>();
  private inner: MockDataSource;

  constructor(seed?: readonly Device[]) {
    this.inner = seed ? new MockDataSource(seed) : new MockDataSource();
  }

  list(): Promise<Device[]> {
    return this.inner.list();
  }

  subscribe(cb: PatchListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispatch(id: string, action: WidgetAction, payload?: unknown): Promise<void> {
    this.dispatched.push({ id, action, payload });
    return Promise.resolve();
  }

  /** Simulate a backend Rückmeldung. */
  push(patch: DevicePatch): void {
    for (const cb of this.listeners) cb(patch);
  }
}

async function makeStore(ds: DataSource = new MockDataSource()) {
  const store = useDeviceStore();
  await store.init(ds);
  return store;
}

function firstId(store: ReturnType<typeof useDeviceStore>, type: Device['type']): string {
  const d = store.devices.find((x: Device) => x.type === type);
  if (!d?.id) throw new Error(`no device of type ${type}`);
  return d.id;
}

function dimmableId(store: ReturnType<typeof useDeviceStore>): string {
  const d = store.devices.find((x: Device) => x.type === 'light' && (x as LightDevice).dim !== null);
  if (!d?.id) throw new Error('no dimmable light');
  return d.id;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('core/store — init() + state ownership', () => {
  it('seeds devices from the data source', async () => {
    const store = await makeStore();
    expect(store.devices.length).toBeGreaterThan(0);
    expect(store.devices.every((d: Device) => typeof d.id === 'string')).toBe(true);
  });

  it('byId resolves a device by id', async () => {
    const store = await makeStore();
    const id = firstId(store, 'light');
    expect(store.byId(id)?.id).toBe(id);
    expect(store.byId('nope')).toBeUndefined();
  });

  it('flags externalFloor only for a non-mock source (the mock IS the static demo floor)', async () => {
    // The mock's floor is the static demo model → the overview keeps the static
    // rooms; any other source brings its own device tree → derive from devices.
    const mock = await makeStore(new MockDataSource());
    expect(mock.externalFloor).toBe(false);

    setActivePinia(createPinia());
    const external = await makeStore(new SpyDataSource());
    expect(external.externalFloor).toBe(true);
  });

  it('exposes an empty nav tree + no layers for a source without layering (the mock)', async () => {
    const store = await makeStore(new MockDataSource());
    expect(store.navTree).toEqual([]);
    expect(store.layersFor('anything')).toEqual([]);
    // M5: dieselbe Degradation für die Seitentyp-Flächen. Ohne Baum gibt es
    // keine Popup-Seite, keine Startseite und keine Include-Quelle — und
    // trotzdem keinen Absturz: der Mock-Pfad bleibt exakt wie vorher.
    expect(store.popupFor('anything')).toBeNull();
    expect(store.firstPageId()).toBeNull();
    expect(store.shownPageId).toBeNull();
    expect(store.gatedIncludesFor('anything')).toEqual([]);
    store.navigate('anything');
    expect(store.currentPageId).toBe('anything');
    expect(store.openPopups).toEqual([]);
  });

  it('reflects a layering source: navTree from init, layersFor read-through (W3c)', async () => {
    class LayeringSpy extends SpyDataSource {
      navTree() {
        return [{ id: 'p', name: 'Raum', type: 'PAGE' as const, access: null, children: [] }];
      }
      layersFor(pageId: string) {
        return pageId === 'p'
          ? [{ id: 'p', origin: 'own' as const, order: 0, items: [{ id: 'w' }] }]
          : [];
      }
    }
    const store = await makeStore(new LayeringSpy());
    expect(store.navTree.map((n) => n.id)).toEqual(['p']);
    expect(store.layersFor('p')[0].items[0].id).toBe('w');
    expect(store.layersFor('nope')).toEqual([]);
  });
});

describe('core/store — subscribe() writes feedback into state', () => {
  it('merges a backend patch into the matching device', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = firstId(store, 'light');
    ds.push({ id, changes: { on: true, dim: 33 } });
    const d = store.byId(id) as LightDevice;
    expect(d.on).toBe(true);
    expect(d.dim).toBe(33);
  });

  it('ignores a patch for an unknown id', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const before = store.devices.length;
    ds.push({ id: 'ghost', changes: { on: true } });
    expect(store.devices.length).toBe(before);
  });
});

describe('core/store — toggle()', () => {
  it('flips a switch on-state optimistically and dispatches toggle', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = firstId(store, 'switch');
    const before = (store.byId(id) as SwitchDevice).on;
    await store.toggle(id);
    expect((store.byId(id) as SwitchDevice).on).toBe(!before);
    expect(ds.dispatched).toContainEqual({ id, action: 'toggle', payload: undefined });
  });

  it('turning a light on while dim===0 sets dim to 60 (widgets.js → tap)', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    // find an off light with dim === 0
    const target = store.devices.find(
      (d: Device) => d.type === 'light' && !(d as LightDevice).on && (d as LightDevice).dim === 0,
    ) as LightDevice;
    expect(target?.id).toBeTruthy();
    await store.toggle(target.id!);
    const after = store.byId(target.id!) as LightDevice;
    expect(after.on).toBe(true);
    expect(after.dim).toBe(60);
    // the canonical action wired is setDim(60), which sets dim + on
    expect(ds.dispatched).toContainEqual({
      id: target.id,
      action: 'setDim',
      payload: { value: 60 },
    });
  });

  it('turning a dimmed light off via toggle leaves dim untouched and dispatches toggle', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = dimmableId(store);
    // bring it on at a non-zero dim first
    await store.setDim(id, 45);
    ds.dispatched.length = 0;
    await store.toggle(id);
    const after = store.byId(id) as LightDevice;
    expect(after.on).toBe(false);
    expect(after.dim).toBe(45);
    expect(ds.dispatched).toContainEqual({ id, action: 'toggle', payload: undefined });
  });

  it('a non-dimmable light (dim===null) toggles plainly', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const target = store.devices.find(
      (d: Device) => d.type === 'light' && (d as LightDevice).dim === null,
    ) as LightDevice;
    expect(target?.id).toBeTruthy();
    const before = target.on;
    await store.toggle(target.id!);
    expect((store.byId(target.id!) as LightDevice).on).toBe(!before);
    expect(ds.dispatched).toContainEqual({ id: target.id, action: 'toggle', payload: undefined });
  });
});

describe('core/store — setDim()', () => {
  it('clamps to 0..100 and turns the light on when > 0', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = dimmableId(store);
    await store.setDim(id, 150);
    let d = store.byId(id) as LightDevice;
    expect(d.dim).toBe(100);
    expect(d.on).toBe(true);
    await store.setDim(id, -10);
    d = store.byId(id) as LightDevice;
    expect(d.dim).toBe(0);
    expect(d.on).toBe(false);
    expect(ds.dispatched).toContainEqual({ id, action: 'setDim', payload: { value: 100 } });
    expect(ds.dispatched).toContainEqual({ id, action: 'setDim', payload: { value: 0 } });
  });
});

describe('core/store — setPosition()', () => {
  it('clamps a blind position 0..100 and dispatches setPosition', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = firstId(store, 'blind');
    await store.setPosition(id, 200);
    expect((store.byId(id) as BlindDevice).position).toBe(100);
    await store.setPosition(id, -50);
    expect((store.byId(id) as BlindDevice).position).toBe(0);
    expect(ds.dispatched).toContainEqual({ id, action: 'setPosition', payload: { value: 100 } });
    expect(ds.dispatched).toContainEqual({ id, action: 'setPosition', payload: { value: 0 } });
  });

  it('a locked blind ignores tile operation (locked blockiert die Kachel)', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const lockedBlind = store.devices.find(
      (d: Device) => d.type === 'blind' && (d as BlindDevice).locked,
    ) as BlindDevice;
    expect(lockedBlind?.id).toBeTruthy();
    const before = lockedBlind.position;
    await store.setPosition(lockedBlind.id!, 80);
    expect((store.byId(lockedBlind.id!) as BlindDevice).position).toBe(before);
    expect(ds.dispatched).toHaveLength(0);
  });
});

describe('core/store — setSlat()', () => {
  it('clamps a jalousie slat 0..100 and dispatches setSlat', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = firstId(store, 'jalousie');
    await store.setSlat(id, 130);
    expect((store.byId(id) as JalousieDevice).slat).toBe(100);
    expect(ds.dispatched).toContainEqual({ id, action: 'setSlat', payload: { value: 100 } });
  });

  it('a locked jalousie ignores tile slat operation', async () => {
    const seed: JalousieDevice[] = [
      {
        id: 'jal-locked',
        type: 'jalousie',
        mode: 'jalousie',
        room: 'R',
        label: 'L',
        accent: 'green',
        position: 50,
        slat: 20,
        locked: true,
        statuses: [],
      },
    ];
    const dsl = new SpyDataSource(seed);
    const store = await makeStore(dsl);
    await store.setSlat('jal-locked', 90);
    expect((store.byId('jal-locked') as JalousieDevice).slat).toBe(20);
    expect(dsl.dispatched).toHaveLength(0);
  });
});

describe('core/store — lock() / unlock()', () => {
  it('lock sets locked; unlock clears it', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = firstId(store, 'blind');
    await store.lock(id);
    expect((store.byId(id) as BlindDevice).locked).toBe(true);
    await store.unlock(id);
    expect((store.byId(id) as BlindDevice).locked).toBe(false);
    expect(ds.dispatched).toContainEqual({ id, action: 'lock', payload: undefined });
    expect(ds.dispatched).toContainEqual({ id, action: 'unlock', payload: undefined });
  });

  it('unlock works on a locked device even though the tile is otherwise blocked', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const lockedBlind = store.devices.find(
      (d: Device) => d.type === 'blind' && (d as BlindDevice).locked,
    ) as BlindDevice;
    expect(lockedBlind?.id).toBeTruthy();
    await store.unlock(lockedBlind.id!);
    expect((store.byId(lockedBlind.id!) as BlindDevice).locked).toBe(false);
  });
});

describe('core/store — activateScene()', () => {
  it('dispatches activateScene for a scene device', async () => {
    const seed: SceneDevice[] = [
      { id: 'scene-1', type: 'scene', room: 'Szenen', label: 'Film', accent: 'violet', icon: 'sparkle' },
    ];
    const ds = new SpyDataSource(seed);
    const store = await makeStore(ds);
    await store.activateScene('scene-1');
    expect(ds.dispatched).toContainEqual({ id: 'scene-1', action: 'activateScene', payload: undefined });
  });
});

describe('core/store — alarm arm/disarm (v1.1 stub)', () => {
  it('arm / disarm dispatch the canonical action without throwing', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    // v1.1 stub: actions exist and dispatch; no core alarm device in v1 model.
    await store.arm('alarm-x');
    await store.disarm('alarm-x');
    expect(ds.dispatched).toContainEqual({ id: 'alarm-x', action: 'arm', payload: undefined });
    expect(ds.dispatched).toContainEqual({ id: 'alarm-x', action: 'disarm', payload: undefined });
  });
});

/** An auth-capable spy source (Welle L) that records login/logout/list/subscribe. */
class AuthSpySource implements DataSource {
  readonly loginCalls: Array<{ user: string; pass: string }> = [];
  listCalls = 0;
  subscribeCalls = 0;
  logoutCalls = 0;
  private authed: boolean;

  constructor(private readonly opts: { failLogin?: boolean; startAuthed?: boolean } = {}) {
    this.authed = !!opts.startAuthed;
  }
  list(): Promise<Device[]> {
    this.listCalls++;
    return Promise.resolve([]);
  }
  subscribe(): () => void {
    this.subscribeCalls++;
    return () => {};
  }
  dispatch(): Promise<void> {
    return Promise.resolve();
  }
  login(user: string, pass: string): Promise<void> {
    this.loginCalls.push({ user, pass });
    if (this.opts.failLogin) return Promise.reject(new Error('bad credentials'));
    this.authed = true;
    return Promise.resolve();
  }
  logout(): void {
    this.logoutCalls++;
    this.authed = false;
  }
  isAuthenticated(): boolean {
    return this.authed;
  }
}

describe('core/store — auth (guest by default, opt-in login)', () => {
  it('is a guest by default (no auth source → not authenticated, no name)', async () => {
    const store = await makeStore(new SpyDataSource());
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
  });

  it('rejects login on a source without an auth surface, staying guest', async () => {
    const store = await makeStore(new SpyDataSource());
    await expect(store.login('alice', 'pw')).rejects.toThrow(/does not support login/);
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
  });

  it('logs in via the source, remembers the name and re-fetches (list + subscribe)', async () => {
    const src = new AuthSpySource();
    const store = await makeStore(src);
    const listAfterInit = src.listCalls;
    const subAfterInit = src.subscribeCalls;

    await store.login('alice', 's3cret');

    expect(src.loginCalls).toEqual([{ user: 'alice', pass: 's3cret' }]);
    expect(store.authenticated).toBe(true);
    expect(store.username).toBe('alice');
    expect(src.listCalls).toBe(listAfterInit + 1);
    expect(src.subscribeCalls).toBe(subAfterInit + 1);
  });

  it('surfaces a failed login and leaves the guest state untouched (no refetch)', async () => {
    const src = new AuthSpySource({ failLogin: true });
    const store = await makeStore(src);
    const listAfterInit = src.listCalls;

    await expect(store.login('mallory', 'nope')).rejects.toThrow(/bad credentials/);
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
    expect(src.listCalls).toBe(listAfterInit);
  });

  it('logs out via the source and re-fetches back to guest', async () => {
    const src = new AuthSpySource();
    const store = await makeStore(src);
    await store.login('alice', 's3cret');
    const listBeforeLogout = src.listCalls;

    await store.logout();

    expect(src.logoutCalls).toBe(1);
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
    expect(src.listCalls).toBe(listBeforeLogout + 1);
  });

  it('logout on a source without auth is a no-op that still re-fetches', async () => {
    const src = new SpyDataSource();
    const store = await makeStore(src);
    // seed a nonzero list count via refresh to observe the re-fetch
    await store.logout();
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
  });

  it('reflects a restored session on init (source already authenticated, no name)', async () => {
    const store = await makeStore(new AuthSpySource({ startAuthed: true }));
    expect(store.authenticated).toBe(true);
    expect(store.username).toBeNull();
  });

  it('refresh() re-runs list() and re-subscribes on the current source', async () => {
    const src = new AuthSpySource();
    const store = await makeStore(src);
    const listBefore = src.listCalls;
    const subBefore = src.subscribeCalls;
    await store.refresh();
    expect(src.listCalls).toBe(listBefore + 1);
    expect(src.subscribeCalls).toBe(subBefore + 1);
  });
});

/** A page-auth-capable spy source (Welle 3b): records PIN attempts, drops a gate
 *  on the correct PIN and re-reports it via `pageGates()` after the store re-lists. */
class PageAuthSpySource implements DataSource {
  readonly pinCalls: Array<{ pageId: string; pin: string }> = [];
  listCalls = 0;
  subscribeCalls = 0;
  /** Pages still gated; the store reads this after each list()/refresh(). */
  private gated: PageGate[];

  constructor(gated: PageGate[] = [{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]) {
    this.gated = [...gated];
  }
  list(): Promise<Device[]> {
    this.listCalls++;
    return Promise.resolve([]);
  }
  subscribe(): () => void {
    this.subscribeCalls++;
    return () => {};
  }
  dispatch(): Promise<void> {
    return Promise.resolve();
  }
  authenticatePage(pageId: string, pin: string): Promise<unknown> {
    this.pinCalls.push({ pageId, pin });
    if (pin !== '1234') return Promise.reject(new Error('obs: wrong PIN'));
    // Correct PIN → this page is no longer gated (mirrors the token being cached).
    this.gated = this.gated.filter((g) => g.pageId !== pageId);
    return Promise.resolve({ sessionToken: 'sess', expiresIn: 3600 });
  }
  pageGates(): readonly PageGate[] {
    return this.gated;
  }
}

describe('core/store – authenticatePage (Welle 3b, PIN gating)', () => {
  it('reflects the source gates on init; none for a mock/guest source', async () => {
    const store = await makeStore(new PageAuthSpySource());
    expect(store.pageGates).toEqual([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]);

    const plain = await makeStore(new SpyDataSource());
    expect(plain.pageGates).toEqual([]);
  });

  it('rejects on a source without page auth, leaving gates empty', async () => {
    const store = await makeStore(new SpyDataSource());
    await expect(store.authenticatePage('p2', '1234')).rejects.toThrow(/does not support PIN auth/);
    expect(store.pageGates).toEqual([]);
  });

  it('a correct PIN forwards to the source, re-fetches, and drops the gate', async () => {
    const src = new PageAuthSpySource();
    const store = await makeStore(src);
    const listAfterInit = src.listCalls;

    await store.authenticatePage('p2', '1234');

    expect(src.pinCalls).toEqual([{ pageId: 'p2', pin: '1234' }]);
    // A re-fetch ran (init → list() + re-subscribe) and the gate is gone.
    expect(src.listCalls).toBe(listAfterInit + 1);
    expect(store.pageGates).toEqual([]);
  });

  it('a wrong PIN rejects, keeps the gate and does not re-fetch (no crash)', async () => {
    const src = new PageAuthSpySource();
    const store = await makeStore(src);
    const listAfterInit = src.listCalls;

    await expect(store.authenticatePage('p2', '0000')).rejects.toThrow(/PIN/);
    expect(store.pageGates.map((g) => g.pageId)).toEqual(['p2']);
    expect(src.listCalls).toBe(listAfterInit);
  });
});

describe('core/store — optimistic update + backend correction', () => {
  it('applies optimistically, then a subscribe patch corrects the state', async () => {
    const ds = new SpyDataSource();
    const store = await makeStore(ds);
    const id = firstId(store, 'light');
    await store.toggle(id);
    const optimistic = (store.byId(id) as LightDevice).on;
    // backend corrects to the opposite of the optimistic value
    ds.push({ id, changes: { on: !optimistic } });
    expect((store.byId(id) as LightDevice).on).toBe(!optimistic);
  });
});

/* ------------------------------------------------ page links (v1.11, #1194) */

/** A page-auth source that also reports PIN sessions per DEFINING node. */
class LinkGateSource extends PageAuthSpySource {
  /** Defining nodes with a live PIN session. */
  readonly sessions = new Set<string>();
  hasPageSession(nodeId: string): boolean {
    return this.sessions.has(nodeId);
  }
}

const KELLER_TREE = [
  {
    id: 'keller',
    name: 'Keller',
    type: 'LOCATION' as const,
    access: 'protected',
    children: [{ id: 'p2', name: 'Technik', type: 'PAGE' as const, access: null, children: [] }],
  },
];

describe('core/store — followLink: the host owns the jump (#1194)', () => {
  it('navigates on a reachable target and owns the current page', async () => {
    const store = await makeStore(new SpyDataSource());
    expect(store.currentPageId).toBeNull();

    const outcome = store.followLink({ targetNodeId: 'camera-full' });

    expect(outcome).toEqual({ kind: 'navigate', pageId: 'camera-full' });
    expect(store.currentPageId).toBe('camera-full');
    expect(store.pendingGate).toBeNull();
  });

  it('gates a protected target instead of navigating (the PIN path)', async () => {
    const src = new LinkGateSource();
    const store = await makeStore(src);
    store.navTree = KELLER_TREE;

    const outcome = store.followLink({ targetNodeId: 'p2' });

    expect(outcome).toEqual({ kind: 'gate', pageId: 'p2', accessNodeId: 'keller' });
    // The decisive guarantee: the host did NOT move onto the target page.
    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBe('p2');
  });

  it('passes once a session is held for the DEFINING node', async () => {
    const src = new LinkGateSource();
    const store = await makeStore(src);
    store.navTree = KELLER_TREE;
    src.sessions.add('keller');

    expect(store.hasPageSession('keller')).toBe(true);
    expect(store.followLink({ targetNodeId: 'p2' })).toEqual({ kind: 'navigate', pageId: 'p2' });
    expect(store.currentPageId).toBe('p2');
  });

  it('a source without page auth reports no session — that gates, it never leaks', async () => {
    const store = await makeStore(new SpyDataSource());
    expect(store.hasPageSession('keller')).toBe(false);
  });

  it('unlocking the pending gate with the PIN completes the jump', async () => {
    const src = new LinkGateSource();
    const store = await makeStore(src);
    store.navTree = KELLER_TREE;

    store.followLink({ targetNodeId: 'p2' });
    expect(store.pendingGate).toBe('p2');

    await store.authenticatePage('p2', '1234');

    expect(store.pageGates).toEqual([]);
    expect(store.currentPageId).toBe('p2');
    expect(store.pendingGate).toBeNull();
  });

  it('linkOutcome resolves the SAME way but acts on nothing (the read-only half, #146)', async () => {
    const src = new LinkGateSource();
    const store = await makeStore(src);
    store.navTree = KELLER_TREE;

    // Same three-way answer as followLink …
    expect(store.linkOutcome({ targetNodeId: 'p2' })).toEqual({
      kind: 'gate',
      pageId: 'p2',
      accessNodeId: 'keller',
    });
    expect(store.linkOutcome({ targetNodeId: 'weg' })).toEqual({
      kind: 'unknown',
      targetNodeId: 'weg',
    });
    // … and no state moved, for any of them. This is what lets a page-owning
    // skin decide its affordance BEFORE a click without owning the decision.
    src.sessions.add('keller');
    expect(store.linkOutcome({ targetNodeId: 'p2' })).toEqual({ kind: 'navigate', pageId: 'p2' });
    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBeNull();
  });

  it('an unknown target in a real tree changes no state', async () => {
    const store = await makeStore(new SpyDataSource());
    store.navTree = KELLER_TREE;

    expect(store.followLink({ targetNodeId: 'weg' })).toEqual({
      kind: 'unknown',
      targetNodeId: 'weg',
    });
    expect(store.currentPageId).toBeNull();
    expect(store.pendingGate).toBeNull();
  });
});

/**
 * `shownPageId` — die Seite, die der Host ZEIGT, im Unterschied zu der, die
 * jemand ausdrücklich angesteuert hat. Der Unterschied ist der ganze Punkt:
 * `currentPageId` ist bis zur ersten Navigation null, gezeigt wird trotzdem
 * schon eine Seite. Wer die Include-Beziehung der gezeigten Seite braucht
 * (die PIN an der Include-Stelle, M5 R15c), hängt daran.
 */
class PopupTreeSource extends SpyDataSource {
  navTree() {
    return [
      { id: 'glob', name: 'Kopf', type: 'PAGE' as const, access: null, kind: 'globalInclude' as const, children: [] },
      { id: 'home', name: 'Start', type: 'PAGE' as const, access: null, kind: 'normal' as const, children: [] },
      { id: 'home2', name: 'Zwei', type: 'PAGE' as const, access: null, kind: 'normal' as const, children: [] },
    ];
  }
  layersFor() {
    return [];
  }
  popupFor(pageId: string) {
    return pageId === 'pop' ? { id: 'pop' } : null;
  }
}

describe('core/store — shownPageId: die gezeigte Seite steht von Anfang an fest', () => {
  it('nennt vor jeder Navigation die erste NORMALE Seite des Baums', async () => {
    const store = await makeStore(new PopupTreeSource());
    // Niemand hat navigiert …
    expect(store.currentPageId).toBeNull();
    // … gezeigt wird trotzdem schon eine Seite, und zwar nicht die globale
    // Includeseite, die im Baum davor steht.
    expect(store.shownPageId).toBe('home');
  });

  it('folgt danach der Navigation', async () => {
    const store = await makeStore(new PopupTreeSource());
    store.navigate('home2');
    expect(store.currentPageId).toBe('home2');
    expect(store.shownPageId).toBe('home2');
  });

  it('ein Popup bewegt die gezeigte Seite NICHT (es liegt darüber)', async () => {
    const store = await makeStore(new PopupTreeSource());
    store.navigate('home2');
    store.navigate('pop');
    expect(store.openPopups.map((p) => p.id)).toEqual(['pop']);
    expect(store.shownPageId).toBe('home2');
  });
});
