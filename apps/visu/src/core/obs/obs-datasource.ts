/**
 * core/obs/obs-datasource — the real obs-server-backed {@link DataSource}.
 *
 * Fulfils the same `list()` / `subscribe()` / `dispatch()` contract as
 * {@link MockDataSource}, but against the live obs server: the server's Visu
 * configuration (`GET /visu/tree`) is the mapping source, datapoint values flow
 * in over the WebSocket, and canonical actions become `POST …/value` writes.
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
import { ObsClient, type ObsClientConfig, type ObsValueEvent, type WsHandle } from './client';
import {
  mapTree,
  applyDp,
  planWrite,
  type ObsVisuNode,
  type MappedWidget,
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
  /** datapoint id → device ids that read it (a DP may feed several widgets). */
  private readonly dpToDevices = new Map<string, Set<string>>();
  private readonly listeners = new Set<PatchListener>();
  private ws: WsHandle | null = null;

  constructor(config: ObsClientConfig | ObsClient = {}) {
    this.client = config instanceof ObsClient ? config : new ObsClient(config);
  }

  /* ---------------------------------------------------------------- list */

  async list(): Promise<Device[]> {
    const nodes = await this.client.getVisuTree<ObsVisuNode[]>();
    const mappedWidgets = mapTree(Array.isArray(nodes) ? nodes : []);

    // Seed initial values: subscribed datapoints get their current value from
    // the WS `send_initial_values` push, but a synchronous list() snapshot is
    // expected to already carry state, so fetch the read datapoints up front.
    const dpIds = new Set<string>();
    for (const m of mappedWidgets) for (const r of m.binding.reads) dpIds.add(r.dp);
    const values = await this.fetchValues([...dpIds]);

    // Re-map with the fetched values so the returned devices carry initial state.
    const finalNodes = Array.isArray(nodes) ? nodes : [];
    const withValues = mapTree(finalNodes, values);

    this.mapped.clear();
    this.dpToDevices.clear();
    for (const m of withValues) {
      this.mapped.set(m.device.id as string, m);
      for (const r of m.binding.reads) {
        let set = this.dpToDevices.get(r.dp);
        if (!set) {
          set = new Set();
          this.dpToDevices.set(r.dp, set);
        }
        set.add(m.device.id as string);
      }
    }
    return withValues.map((m) => m.device);
  }

  /** Fetch current values for the given datapoints; failures are skipped (best-effort). */
  private async fetchValues(ids: string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await this.client.getValue(id);
          out.set(id, r.value);
        } catch {
          /* a missing/forbidden datapoint just stays at its mapping default */
        }
      }),
    );
    return out;
  }

  /* ----------------------------------------------------------- subscribe */

  subscribe(cb: PatchListener): () => void {
    this.listeners.add(cb);
    // Open the WS lazily on the first subscriber and feed it the current id set.
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
    const write = planWrite(m.device, m.writes, action, payload);
    await this.client.writeValue(write.dp, write.value);
    // No optimistic local mutation: the server confirms via the WS value-event,
    // which onValueEvent() turns into the authoritative patch (CONTRACT-v1 §6).
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
 *  - `VITE_OBS_USER` / `VITE_OBS_PASS` — credentials (default `admin`/`admin`)
 *
 * Returns null when neither flag is set, so `main.ts` falls back to the mock and
 * nothing ever writes to a real bus by accident.
 */
export function obsDataSourceFromEnv(
  env: Record<string, string | undefined> = importMetaEnv(),
): ObsDataSource | null {
  const enabled = env.VITE_USE_OBS === '1' || (env.VITE_OBS_API ?? '').length > 0;
  if (!enabled) return null;
  return new ObsDataSource({
    apiBase: env.VITE_OBS_API || undefined,
    wsUrl: env.VITE_OBS_WS || undefined,
    username: env.VITE_OBS_USER || undefined,
    password: env.VITE_OBS_PASS || undefined,
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
