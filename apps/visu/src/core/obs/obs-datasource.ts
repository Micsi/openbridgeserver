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

import type { Device, WidgetAction } from '@obs/visu-contract';
import type { DataSource, DevicePatch, PatchListener } from '../datasource';
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
  resolveEffectiveAccess,
  deviceWriteDps,
  type ObsVisuNode,
  type MappedWidget,
  type PageAccess,
} from './mapping';

/**
 * A {@link DataSource} backed by the obs server. Construct directly with an
 * {@link ObsClientConfig} (or a ready {@link ObsClient} for tests), then use it
 * exactly like the mock: `store.init(new ObsDataSource())`.
 */
export class ObsDataSource implements DataSource {
  private readonly client: ObsClient;
  /** Mapped widgets keyed by device id — the single owner of mapped state. */
  private readonly mapped = new Map<string, MappedWidget>();
  /** device id → owning PAGE id (the X-Page-Id for its datapoint ops). */
  private readonly devicePage = new Map<string, string>();
  /** datapoint id → the PAGE id its reads should be scoped to (first seen). */
  private readonly dpPage = new Map<string, string>();
  /** datapoint id → device ids that read it (a DP may feed several widgets). */
  private readonly dpToDevices = new Map<string, Set<string>>();
  private readonly listeners = new Set<PatchListener>();
  private ws: WsHandle | null = null;

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
    return this.client.authenticatePin(nodeId, pin);
  }

  /* ---------------------------------------------------------------- list */

  async list(): Promise<Device[]> {
    const nodes = await this.client.getVisuTree<ObsVisuNode[]>();
    const list = Array.isArray(nodes) ? nodes : [];
    const accessByNode = resolveEffectiveAccess(list);
    const mappedWidgets = mapTree(list);

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

    // Re-map with the fetched values, then fold in access + writability.
    const withValues = mapTree(list, values);

    this.mapped.clear();
    this.dpToDevices.clear();
    this.devicePage.clear();
    this.dpPage.clear();
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

  /** Fold a page's access + the server's per-DP verdict into `Device.writable`. */
  private isWritable(
    m: MappedWidget,
    access: PageAccess,
    writableMap: Record<string, boolean> | undefined,
  ): boolean {
    // readonly page, or a user page we cannot operate in v1 → locked outright.
    if (access === 'readonly' || access === 'user') return false;
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
        const token = this.client.sessionToken(pageId) ?? undefined;
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
        const pageId = dpPage.get(id);
        const token = pageId ? (this.client.sessionToken(pageId) ?? undefined) : undefined;
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
    this.listeners.add(cb);
    // Open the WS lazily on the first subscriber and feed it the current id set.
    // The socket is opened without a single page scope: the mobile view
    // aggregates many pages, so it relies on the server delivering only the
    // allowed (filtered) value-events for the subscribed ids.
    if (!this.ws) {
      this.ws = this.client.openWebSocket((ev) => this.onValueEvent(ev));
    }
    const ids = [...this.dpToDevices.keys()];
    if (ids.length > 0) this.ws.subscribe(ids);

    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0 && this.ws) {
        this.ws.close();
        this.ws = null;
      }
    };
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
    const pageId = this.devicePage.get(id);
    const token = pageId ? (this.client.sessionToken(pageId) ?? undefined) : undefined;
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
