/**
 * core/obs/obs-datasource — the real obs-server-backed {@link DataSource}.
 *
 * Fulfils the same `list()` / `subscribe()` / `dispatch()` contract as
 * {@link MockDataSource}, but against the live obs server: the server's Visu
 * configuration (`GET /visu/tree`) is the mapping source, datapoint values flow
 * in over the WebSocket, and canonical actions become `POST …/value` writes.
 *
 * Authorization is **page-scoped** (v1, no admin/user JWT login): each device
 * remembers its PAGE node id, and datapoint reads/writes carry that page's
 * `X-Page-Id` (plus `X-Session-Token` for PIN-protected pages). Per-device
 * operability is resolved from the page's effective `access` and the server's
 * per-datapoint `writable` verdict, and stored in `Device.writable` (contract
 * v1.5) so a skin renders locked controls without ever attempting a forbidden
 * write. Concealment (a filtered tree, a 404 value, a 403 write) is tolerated
 * silently — never a crash, never a global logout.
 *
 * OPT-IN (issue #124): the app keeps {@link MockDataSource} as its default. This
 * source is only wired up when {@link obsDataSourceFromEnv} returns one — i.e.
 * when `VITE_OBS_API` (or `VITE_USE_OBS`) is set — so demo/tests never touch a
 * real KNX bus.
 *
 * Golden rules: state lives in core (this source owns the live device map);
 * renderers/skins only ever see read-only snapshots via the store; callers send
 * canonical actions, never mutate devices. media/camera and the tablet/desktop
 * widget types have no server mapping yet and are silently skipped by
 * {@link mapTree} — they keep running on the mock demo page.
 */

import type { Device, PageLink, WidgetAction, WidgetPosition } from '@obs/visu-contract';
import type {
  AuthCapableDataSource,
  DevicePatch,
  PageAuthCapableDataSource,
  LinkCapableDataSource,
  PageGate,
  PatchListener,
  PositionCapableDataSource,
} from '../datasource';
import { getAccessToken } from './auth';
import {
  ObsClient,
  ObsForbiddenError,
  type ObsClientConfig,
  type ObsValueEvent,
  type WsHandle,
} from './client';
import {
  mapTree,
  applyDp,
  planWrite,
  resolveAccessNodes,
  deviceWriteDps,
  type ObsVisuNode,
  type MappedWidget,
  type PageAccess,
} from './mapping';
import {
  composeLayers,
  composePopup,
  buildNavTree,
  type HostNavNode,
  type LayeringCapableDataSource,
} from './compose';
import type { PageLayer, PopupDescriptor } from '@obs/visu-contract';

/**
 * A {@link DataSource} backed by the obs server. Construct directly with an
 * {@link ObsClientConfig} (or a ready {@link ObsClient} for tests), then use it
 * exactly like the mock: `store.init(new ObsDataSource())`.
 */
export class ObsDataSource
  implements
    AuthCapableDataSource,
    PageAuthCapableDataSource,
    PositionCapableDataSource,
    LinkCapableDataSource,
    LayeringCapableDataSource
{
  private readonly client: ObsClient;
  /** Mapped widgets keyed by device id — the single owner of mapped state. */
  private readonly mapped = new Map<string, MappedWidget>();
  /** device id → owning PAGE id (the X-Page-Id for its datapoint ops). */
  private readonly devicePage = new Map<string, string>();
  /**
   * PAGE id → its defining-node id (accessNodeId) — the node the backend scopes
   * a `protected` session to. A PIN session is cached/looked up under THIS id, so
   * one PIN covers every sibling page under the same defining node. Rebuilt on
   * every {@link list}; a page with no defining node above it is simply absent.
   */
  private readonly accessNode = new Map<string, string>();
  /** datapoint id → the PAGE id its reads should be scoped to (first seen). */
  private readonly dpPage = new Map<string, string>();
  /** datapoint id → device ids that read it (a DP may feed several widgets). */
  private readonly dpToDevices = new Map<string, Set<string>>();
  private readonly listeners = new Set<PatchListener>();
  private ws: WsHandle | null = null;
  /** Guest live-value poll timer (page-scoped getValue), or null when idle. */
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Guard so a slow poll round never overlaps the next tick. */
  private polling = false;
  /** Last raw value seen per datapoint, so a poll round only emits real changes. */
  private readonly lastPolled = new Map<string, unknown>();
  /** The enriched (page-config loaded) tree of the last list(), for layering W3c:
   *  navTree()/layersFor() compose over it. Empty before the first list(). */
  private tree: readonly ObsVisuNode[] = [];
  /** The datapoint values of the last list(), so composed layers carry live state. */
  private treeValues: ReadonlyMap<string, unknown> = new Map();
  /**
   * The pages the server declared readonly when their config was loaded
   * (`X-Source-Page-Readonly`, M5 R15). Their widgets are locked regardless of
   * what the tree's raw `access` or the per-datapoint verdict say; the header is
   * the only reliable readonly source (CONTRIBUTING-visu-m5.md §2.1). Rebuilt on
   * every {@link list}; a page whose config came inline never appears here.
   */
  private readonly readonlyPages = new Set<string>();
  /** Guest poll cadence (ms). Live WS is used instead once logged in. */
  private static readonly POLL_INTERVAL_MS = 4000;
  /**
   * The pages that currently need a gate decision (PIN missing / login required),
   * recomputed on every {@link list}. Surfaced to the app via {@link pageGates}.
   */
  private pageGateList: PageGate[] = [];

  constructor(config: ObsClientConfig | ObsClient = {}) {
    this.client = config instanceof ObsClient ? config : new ObsClient(config);
  }

  /**
   * Authenticate a PIN-protected page. On success the session token is held by
   * the client and later reads/writes/live-updates for that page carry it
   * automatically; re-run {@link list} afterwards to pick up the now-writable
   * devices. Surfaces the client's errors (wrong PIN → {@link ObsAuthError}).
   */
  authenticatePage(nodeId: string, pin: string): Promise<{ sessionToken: string; expiresIn: number }> {
    // Authenticate against the page's *defining node* (accessNodeId), not the
    // page itself: the backend scopes the session to that node, so a single PIN
    // unlocks every sibling page that inherits `protected` from it. A page with
    // no known defining node (e.g. called before any list()) falls back to itself.
    return this.client.authenticatePin(this.accessNode.get(nodeId) ?? nodeId, pin);
  }

  /**
   * The `X-Session-Token` to send for a page's datapoint op, or undefined. The
   * session is keyed on the page's *defining node* (accessNodeId), so every
   * sibling page under the same `protected` ancestor shares the one PIN session;
   * a public/readonly page has no session and yields undefined. Shared by every
   * page-scoped read and write.
   */
  private sessionTokenFor(pageId: string): string | undefined {
    return this.client.sessionToken(this.accessNode.get(pageId) ?? pageId) ?? undefined;
  }

  /**
   * The pages that currently need a gate decision (Welle 3b): a `protected` page
   * with no valid PIN session, or a `user`-level page while the caller is a guest.
   * `public`/`readonly` pages are never gated. Recomputed on every {@link list}
   * (and on login/logout, since the host re-lists) so a page drops off the moment
   * its PIN is entered or the user logs in. Concealment stays honoured: a page the
   * server filtered out of the tree simply never appears here.
   */
  pageGates(): readonly PageGate[] {
    return this.pageGateList;
  }

  /** Build the gate list from the (filtered) tree + effective access per page. */
  private computeGates(
    nodes: readonly ObsVisuNode[],
    accessByNode: ReadonlyMap<string, PageAccess>,
  ): PageGate[] {
    const gates: PageGate[] = [];
    const loggedIn = this.isAuthenticated();
    for (const node of nodes) {
      if (node.type !== 'PAGE') continue;
      const access = accessByNode.get(node.id) ?? 'public';
      if (access === 'protected') {
        // Needs a PIN until a valid session token is held for the page's DEFINING
        // node — accessNode is always populated for a protected page (list() sets
        // it before computeGates). A sibling unlocked earlier already dropped the
        // gate for this page, because they share that one defining-node session.
        const definingNode = this.accessNode.get(node.id)!;
        if (this.client.sessionToken(definingNode) === null) {
          gates.push({ pageId: node.id, name: node.name, access });
        }
      } else if (access === 'user') {
        // Needs a JWT login; a guest sees a "sign-in required" hint, never an error.
        if (!loggedIn) gates.push({ pageId: node.id, name: node.name, access });
      }
    }
    return gates;
  }

  /* ------------------------------------------------------------ JWT login */

  /**
   * JWT login (Welle L, opt-in). Delegates to the client's `/auth/login`; a
   * wrong credential rejects (ObsAuthError) so the caller can surface it inline.
   * Login is additive — reading never needs it — but after a success the caller
   * should re-run {@link list} / re-{@link subscribe} to pick up the now-writable
   * devices and the principal-scoped live feed (the host store does this).
   */
  login(username: string, password: string): Promise<void> {
    return this.client.login(username, password);
  }

  /** Drop the stored JWT → back to guest. Page-scoped / PIN paths are untouched. */
  logout(): void {
    this.client.logout();
  }

  /** Whether a JWT is currently stored (logged in vs. guest). */
  isAuthenticated(): boolean {
    return getAccessToken() !== null;
  }

  /**
   * Per-device author positions (x/y/w/h, CONTRACT-v1.9 → layering W3). Built
   * from the mapped widgets of the last {@link list}; only devices whose backend
   * widget declared a complete box appear. A skin honouring `position` uses this;
   * the responsive skin ignores it and lays out by room/role.
   */
  positions(): ReadonlyMap<string, WidgetPosition> {
    const out = new Map<string, WidgetPosition>();
    for (const [id, m] of this.mapped) {
      if (m.position) out.set(id, m.position);
    }
    return out;
  }

  /**
   * Per-device page links (CONTRACT-v1.11 → #1194). Built from the mapped widgets
   * of the last {@link list}; only devices whose backend widget declared a
   * `target_node_id` appear (the same config key the V1 link widget uses). The
   * host resolves + executes them; a device without one behaves as before.
   */
  links(): ReadonlyMap<string, PageLink> {
    const out = new Map<string, PageLink>();
    for (const [id, m] of this.mapped) {
      if (m.link) out.set(id, m.link);
    }
    return out;
  }

  /**
   * Whether a valid PIN session is held for `nodeId` (#1194). The session hangs on
   * the node that DEFINES the access, so this asks the client for exactly that
   * node — the same key {@link sessionTokenFor} uses for page-scoped reads/writes.
   * The host's link resolution calls this before jumping onto a `protected` target.
   */
  hasPageSession(nodeId: string): boolean {
    return this.client.sessionToken(this.accessNode.get(nodeId) ?? nodeId) !== null;
  }

  /**
   * The navigation tree (layering W3c): the visible PAGE/LOCATION hierarchy of the
   * last {@link list}. A skin renders its own navigation from this; the responsive
   * skin ignores it. Empty before the first list().
   */
  navTree(): HostNavNode[] {
    return buildNavTree(this.tree);
  }

  /**
   * The popup descriptor of a popup page (M5 R2-R6), or null for any other page.
   * The host (SkinHost) owns the open-state and the auto-close timer; this only
   * hands out the author's data for a page it already loaded.
   */
  popupFor(pageId: string): PopupDescriptor | null {
    return composePopup(this.tree, pageId);
  }

  /**
   * The ordered layer stack for a page (M5 R9-R15): global include pages, the
   * page's own includes and its own content, composed from the last {@link list}'s
   * tree + live values. A skin overlays this; the responsive skin ignores it.
   * Empty for an unknown page.
   */
  layersFor(pageId: string): PageLayer[] {
    return composeLayers(this.tree, pageId, this.treeValues);
  }

  /* ---------------------------------------------------------------- list */

  async list(): Promise<Device[]> {
    const nodes = await this.client.getVisuTree<ObsVisuNode[]>();
    const list = Array.isArray(nodes) ? nodes : [];
    const accessInfo = resolveAccessNodes(list);
    // Rebuild the page → defining-node map so session lookups (gate + reads +
    // writes) key on the node the backend scopes the PIN session to.
    this.accessNode.clear();
    const accessByNode = new Map<string, PageAccess>();
    for (const [id, info] of accessInfo) {
      accessByNode.set(id, info.access);
      if (info.accessNodeId) this.accessNode.set(id, info.accessNodeId);
    }
    this.pageGateList = this.computeGates(list, accessByNode);
    // The authz `/visu/tree` is a summary (no `page_config`); load each
    // accessible PAGE's widgets so the mapper can see them. Concealed/locked
    // pages (404/403) contribute nothing until unlocked / logged in.
    const enriched = await this.loadPageConfigs(list);
    const mappedWidgets = mapTree(enriched);

    // Collect the read datapoints and remember each one's page so the initial
    // GET …/value carries the right X-Page-Id / session token.
    const dpIds = new Set<string>();
    const dpPage = new Map<string, string>();
    for (const m of mappedWidgets) {
      const pageId = m.pageId ?? '';
      for (const r of m.binding.reads) {
        dpIds.add(r.dp);
        if (!dpPage.has(r.dp)) dpPage.set(r.dp, pageId);
      }
    }
    const values = await this.fetchValues([...dpIds], dpPage);

    // Ask the server which datapoints the current caller may actually write,
    // per page — skipping readonly/user pages (all controls locked there).
    const writableByPage = await this.fetchWritable(mappedWidgets, accessByNode);

    // Keep the enriched tree + values so navTree()/layersFor() can compose (W3c).
    this.tree = enriched;
    this.treeValues = values;
    // Re-map with the fetched values, then fold in access + writability.
    const withValues = mapTree(enriched, values);

    this.mapped.clear();
    this.dpToDevices.clear();
    this.devicePage.clear();
    this.dpPage.clear();
    // Seed the poll baseline with the values list() just read, so a guest poll's
    // first round stays quiet and only later real changes emit patches.
    this.lastPolled.clear();
    for (const [dp, v] of values) this.lastPolled.set(dp, v);
    const out: Device[] = [];
    for (const m of withValues) {
      const pageId = m.pageId ?? '';
      const access = accessByNode.get(pageId) ?? 'public';
      const device = { ...m.device, writable: this.isWritable(m, access, writableByPage.get(pageId)) } as Device;
      const stored: MappedWidget = { ...m, device };

      const id = device.id as string;
      this.mapped.set(id, stored);
      this.devicePage.set(id, pageId);
      for (const r of m.binding.reads) {
        if (!this.dpPage.has(r.dp)) this.dpPage.set(r.dp, pageId);
        let set = this.dpToDevices.get(r.dp);
        if (!set) {
          set = new Set();
          this.dpToDevices.set(r.dp, set);
        }
        set.add(id);
      }
      out.push(device);
    }
    return out;
  }

  /**
   * Load each PAGE node's `page_config` (its widgets) from `GET /visu/pages/{id}`.
   *
   * The authz `/visu/tree` is a navigation summary without `page_config`, so the
   * widgets are fetched per page here — page-scoped with the page's PIN session
   * token when one is held (and the JWT when logged in). A node that already
   * carries an inline `page_config` (the mock/tests, or a server that inlines it)
   * is left untouched. A concealed/locked page (404/403) is skipped silently: it
   * keeps no widgets and simply shows its gate until unlocked or the user logs in.
   */
  private async loadPageConfigs(nodes: readonly ObsVisuNode[]): Promise<ObsVisuNode[]> {
    this.readonlyPages.clear();
    return Promise.all(
      nodes.map(async (node) => {
        if (node.type !== 'PAGE' || node.page_config) return node;
        try {
          const page = await this.client.getPage(node.id, this.sessionTokenFor(node.id));
          // M5 R15: remember the server's readonly verdict for this page as an
          // include source; it is what locks its widgets (§2.1).
          if (page.sourceReadonly) this.readonlyPages.add(node.id);
          return { ...node, page_config: page.config };
        } catch {
          return node;
        }
      }),
    );
  }

  /** Fold a page's access + the server's per-DP verdict into `Device.writable`. */
  private isWritable(
    m: MappedWidget,
    access: PageAccess,
    writableMap: Record<string, boolean> | undefined,
  ): boolean {
    // readonly page, or a user page we cannot operate in v1 → locked outright.
    if (access === 'readonly' || access === 'user') return false;
    // M5 R15: the server called this page readonly when we loaded it. That
    // verdict outranks everything below; an include source may resolve its
    // readonly level from an ancestor the client cannot see.
    if (this.readonlyPages.has(m.pageId ?? '')) return false;
    const dps = deviceWriteDps(m.writes);
    // Operable only when every write datapoint is confirmed writable by the host.
    return dps.length > 0 && dps.every((dp) => writableMap?.[dp] === true);
  }

  /** Fetch the per-datapoint writability map for each operable page. */
  private async fetchWritable(
    mappedWidgets: readonly MappedWidget[],
    accessByNode: ReadonlyMap<string, PageAccess>,
  ): Promise<Map<string, Record<string, boolean>>> {
    const out = new Map<string, Record<string, boolean>>();
    const pages = new Set<string>();
    for (const m of mappedWidgets) if (m.pageId) pages.add(m.pageId);
    await Promise.all(
      [...pages].map(async (pageId) => {
        const access = accessByNode.get(pageId) ?? 'public';
        // readonly/user pages are all-locked; don't bother the server for them.
        if (access === 'readonly' || access === 'user') return;
        const token = this.sessionTokenFor(pageId);
        try {
          out.set(pageId, await this.client.getWritable(pageId, token));
        } catch {
          /* 401/403/404 → leave the page without a map → all devices non-writable */
        }
      }),
    );
    return out;
  }

  /** Fetch current values for the given datapoints; failures are skipped (best-effort). */
  private async fetchValues(ids: string[], dpPage: ReadonlyMap<string, string>): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    await Promise.all(
      ids.map(async (id) => {
        const pageId = dpPage.get(id) as string; // every collected id has a page
        const token = this.sessionTokenFor(pageId);
        try {
          const r = await this.client.getValue(id, pageId, token);
          out.set(id, r.value);
        } catch {
          /* concealed (404) / forbidden / unauth → stays empty (mapping default) */
        }
      }),
    );
    return out;
  }

  /* ----------------------------------------------------------- subscribe */

  subscribe(cb: PatchListener): () => void {
    const first = this.listeners.size === 0;
    this.listeners.add(cb);
    // The live-value mode is chosen by auth status on the first subscriber:
    //  - Logged in (JWT): ONE principal-scoped WS via the `obs.jwt.<token>`
    //    subprotocol. The server filters to the caller's allowed datapoints, so a
    //    single socket covers the aggregate overview. No context-less socket is
    //    ever opened (that is the audited bug: the server would close it 4001).
    //  - Guest / PIN (no JWT): page-scoped POLLING – periodic `getValue` per DP
    //    carrying its page's `X-Page-Id` (+ `X-Session-Token`). A multi-page
    //    aggregate has no single identity to scope a socket to, so it polls.
    // The host store re-runs unsubscribe()+subscribe() on login/logout, so the
    // mode is re-selected there without any special-casing here.
    if (first) {
      if (this.isAuthenticated()) {
        this.ws = this.client.openWebSocket(
          (ev) => this.onValueEvent(ev),
          () => {
            const jwt = getAccessToken();
            return jwt ? { jwt } : {};
          },
        );
      } else {
        this.startPolling();
      }
    }
    if (this.ws) {
      const ids = [...this.dpToDevices.keys()];
      if (ids.length > 0) this.ws.subscribe(ids);
    }

    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        this.stopPolling();
      }
    };
  }

  /* --------------------------------------------------------------- poll */

  /** Start the guest poll loop: an immediate read, then every POLL_INTERVAL_MS. */
  private startPolling(): void {
    if (this.pollTimer) return;
    void this.pollOnce();
    this.pollTimer = setInterval(() => void this.pollOnce(), ObsDataSource.POLL_INTERVAL_MS);
  }

  /** Stop and clear the guest poll loop. */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.polling = false;
  }

  /**
   * One poll round: read every subscribed datapoint's current value (page-scoped,
   * best-effort) and feed each into the same value-event path the WS would. A
   * concealed/forbidden read (404/403) is skipped by {@link fetchValues} – no
   * value, no crash. Overlapping rounds are guarded so a slow batch can't stack.
   */
  private async pollOnce(): Promise<void> {
    if (this.polling) return;
    const ids = [...this.dpToDevices.keys()];
    if (ids.length === 0) return;
    this.polling = true;
    try {
      const values = await this.fetchValues(ids, this.dpPage);
      for (const [id, v] of values) {
        // Only surface a datapoint whose raw value actually moved since last read;
        // an unchanged poll (the common case) emits nothing and causes no re-render.
        if (this.lastPolled.has(id) && Object.is(this.lastPolled.get(id), v)) continue;
        this.lastPolled.set(id, v);
        this.onValueEvent({ id, v });
      }
    } finally {
      this.polling = false;
    }
  }

  /** Apply one incoming value-event to every device that reads its datapoint. */
  private onValueEvent(ev: ObsValueEvent): void {
    const deviceIds = this.dpToDevices.get(ev.id);
    // A value-event for a datapoint no longer in scope (live right-revocation) or
    // never mapped is simply ignored — no crash, no stray patch.
    if (!deviceIds) return;
    for (const deviceId of deviceIds) {
      const m = this.mapped.get(deviceId);
      if (!m) continue;
      const changes = applyDp(m.binding, m.device, ev.id, ev.v);
      if (!changes) continue;
      // Keep the owned device current so later dispatch()/planWrite reads see it.
      const next = { ...m.device, ...changes } as Device;
      this.mapped.set(deviceId, { ...m, device: next });
      this.emit({ id: deviceId, changes });
    }
  }

  /* ------------------------------------------------------------ dispatch */

  async dispatch(id: string, action: WidgetAction, payload?: unknown): Promise<void> {
    const m = this.mapped.get(id);
    if (!m) throw new Error(`obs-datasource: unknown device "${id}"`);
    // A device the host marked non-writable (readonly page or no write right) is
    // locked: swallow the action silently rather than provoke a forbidden write.
    if (m.device.writable === false) return;

    const write = planWrite(m.device, m.writes, action, payload);
    const pageId = this.devicePage.get(id) as string; // a mapped device always has a page
    const token = this.sessionTokenFor(pageId);
    try {
      await this.client.writeValue(write.dp, write.value, pageId, token);
    } catch (err) {
      if (err instanceof ObsForbiddenError) {
        // 403 = the write is locked. Treat the device as non-writable from now on
        // and stay silent (no throw, no error surfaced to the caller).
        this.markNonWritable(id, m);
        return;
      }
      throw err;
    }
    // No optimistic local mutation: the server confirms via the WS value-event,
    // which onValueEvent() turns into the authoritative patch (CONTRACT-v1 §6).
  }

  /** Flip a device to non-writable and notify subscribers (post-403 lock). */
  private markNonWritable(id: string, m: MappedWidget): void {
    if (m.device.writable === false) return;
    const next = { ...m.device, writable: false } as Device;
    this.mapped.set(id, { ...m, device: next });
    this.emit({ id, changes: { writable: false } });
  }

  /* --------------------------------------------------------------- emit */

  private emit(patch: DevicePatch): void {
    for (const cb of this.listeners) {
      try {
        cb(patch);
      } catch {
        /* a subscriber's failure is its own concern — keep delivering */
      }
    }
  }
}

/* --------------------------------------------------------- opt-in factory */

/**
 * Build an {@link ObsDataSource} from Vite env, or return null to keep the mock.
 *
 * Activation (issue #124, opt-in): set `VITE_USE_OBS=1` (or just set
 * `VITE_OBS_API` to a non-empty base). Optional overrides:
 *  - `VITE_OBS_API`  — REST base (default `/api/v1`, served via the vite proxy)
 *  - `VITE_OBS_WS`   — WebSocket URL (default `/api/v1/ws`, resolved vs location)
 *
 * Auth is page-scoped (public/readonly need nothing, protected uses a PIN
 * session); there is no admin login, so no credential env vars. Returns null
 * when neither flag is set, so `main.ts` falls back to the mock and nothing ever
 * writes to a real bus by accident.
 */
export function obsDataSourceFromEnv(
  env: Record<string, string | undefined> = importMetaEnv(),
): ObsDataSource | null {
  const enabled = env.VITE_USE_OBS === '1' || (env.VITE_OBS_API ?? '').length > 0;
  if (!enabled) return null;
  return new ObsDataSource({
    apiBase: env.VITE_OBS_API || undefined,
    wsUrl: env.VITE_OBS_WS || undefined,
  });
}

/** Read import.meta.env without breaking non-Vite (test) execution. */
function importMetaEnv(): Record<string, string | undefined> {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  } catch {
    return {};
  }
}
