/**
 * core/datasource — the austauschbare Andockpunkt (MIGRATION §4, Issue #92).
 *
 * One `DataSource` interface (list / subscribe / dispatch) decouples the UI
 * from where device state actually lives. Today {@link MockDataSource} holds a
 * local reactive copy seeded from {@link core/model}; later a KNX/MQTT/obs-REST
 * source plugs in behind the *same* interface and the UI stays unchanged —
 * only `dispatch`/`subscribe` get a real transport.
 *
 * Goldene Regeln honoured here:
 *  - **State lives in core.** This module is the single owner of live device
 *    state; skins/renderers never see it except through read-only snapshots.
 *  - **Canonical actions only.** `dispatch` understands the contract's
 *    `WidgetAction` names (CONTRACT-v1 §6). Callers send intents; no one
 *    mutates a `Device` directly (golden rule 4).
 *  - **Renderer rein:** imports nothing from any skin — only the model and the
 *    data/type contract.
 *
 * Data and behaviour are kept apart: the seed data comes from `model.ts`, the
 * only code here is the transport plumbing + the canonical mutators.
 */

import type { Device, WidgetAction } from '@obs/visu-contract';
import { devices as seedDevices } from './model';

/* ------------------------------------------------------------------ types */

/**
 * A live-update patch addressed to one device. Carries only the fields that
 * changed — never the whole device — so a transport can forward minimal diffs
 * and a store can merge them cheaply (MIGRATION §4: `subscribe` "trägt echte
 * Rückmeldungen ein").
 */
export interface DevicePatch {
  readonly id: string;
  readonly changes: Readonly<Partial<Device>>;
}

/** A live-update callback. Returns nothing; errors are the subscriber's concern. */
export type PatchListener = (patch: DevicePatch) => void;

/**
 * The austauschbare data source. Mock today, KNX/MQTT/obs-REST later — same
 * shape, UI unchanged (MIGRATION §4).
 */
export interface DataSource {
  /** Initial devices — a read-only snapshot of current state. */
  list(): Promise<Device[]>;
  /** Subscribe to live updates; returns an unsubscribe handle. */
  subscribe(cb: PatchListener): () => void;
  /** Send a canonical action (CONTRACT-v1 §6) to a device. */
  dispatch(id: string, action: WidgetAction, payload?: unknown): Promise<void>;
}

/* -------------------------------------------------------- canonical mutators */
// Each returns the changed fields for the given action, or throws if the action
// is not valid for the device type. Pure over (device, payload) — no I/O, no
// state; the mutation is applied by MockDataSource.

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

function numValue(payload: unknown): number {
  // Contract slider actions (setDim/setPosition/setSlat) carry the percentage as
  // `{ pct }` (CONTRACT-v1 §6); the prototype/tests also use `{ value }`. Accept
  // both so contract-compliant controls dispatch, preferring the contract `pct`.
  const p = payload as { pct?: unknown; value?: unknown } | undefined;
  const v = p?.pct ?? p?.value;
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error('datasource: action needs a numeric { pct } or { value }');
  }
  return v;
}

/**
 * Compute the field changes a canonical action produces for a device.
 * Throws `Error` for an unknown device or an action the type does not support.
 */
function computeChanges(device: Device, action: WidgetAction, payload?: unknown): Partial<Device> {
  switch (action) {
    case 'toggle': {
      if (device.type !== 'light' && device.type !== 'switch') break;
      return { on: !device.on } as Partial<Device>;
    }
    case 'setDim': {
      if (device.type !== 'light') break;
      // `dim === null` marks a non-dimmable (plain on/off) light; setting a
      // numeric brightness would silently turn it into a dimmable device and
      // change how later snapshots classify it. Reject instead.
      if (device.dim === null) {
        throw new Error('datasource: setDim is not valid for a non-dimmable light');
      }
      const dim = clamp(numValue(payload));
      return { dim, on: dim > 0 } as Partial<Device>;
    }
    case 'setPosition': {
      if (device.type !== 'blind' && device.type !== 'jalousie') break;
      return { position: clamp(numValue(payload)) } as Partial<Device>;
    }
    case 'setSlat': {
      if (device.type !== 'jalousie') break;
      return { slat: clamp(numValue(payload)) } as Partial<Device>;
    }
    case 'lock': {
      if (device.type !== 'blind' && device.type !== 'jalousie') break;
      return { locked: true } as Partial<Device>;
    }
    case 'unlock': {
      if (device.type !== 'blind' && device.type !== 'jalousie') break;
      return { locked: false } as Partial<Device>;
    }
    case 'activateScene': {
      if (device.type !== 'scene') break;
      return {} as Partial<Device>; // scenes are stateless intents (no local field)
    }
    default:
      break;
  }
  throw new Error(`datasource: action "${action}" not supported for type "${device.type}"`);
}

/* ------------------------------------------------------------- MockDataSource */

/**
 * Clone a device so a returned snapshot shares no mutable state with the source.
 * A shallow copy still shares nested objects — notably a jalousie's `statuses`
 * array and its status objects — so a consumer mutating `list()[…].statuses[0]`
 * would reach back into the source. Deep-clone the one nested field that exists.
 */
function clone(device: Device): Device {
  if (device.type === 'jalousie') {
    return { ...device, statuses: device.statuses.map((s) => ({ ...s })) };
  }
  return { ...device } as Device;
}

/**
 * Local, reactive Mock seeded from the model. `dispatch` mutates the in-memory
 * state and *optimistically* notifies subscribers before the (trivially
 * resolved) promise settles — exactly the seam a real backend will later use to
 * confirm or correct via `subscribe` (MIGRATION §4).
 */
export class MockDataSource implements DataSource {
  /** Source of truth for live state, keyed by id (state lives in core). */
  private readonly state = new Map<string, Device>();
  private readonly listeners = new Set<PatchListener>();

  constructor(seed: readonly Device[] = seedDevices) {
    for (const d of seed) {
      if (!d.id) continue;
      this.state.set(d.id, clone(d));
    }
  }

  list(): Promise<Device[]> {
    return Promise.resolve([...this.state.values()].map(clone));
  }

  subscribe(cb: PatchListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  dispatch(id: string, action: WidgetAction, payload?: unknown): Promise<void> {
    const current = this.state.get(id);
    if (!current) {
      return Promise.reject(new Error(`datasource: unknown device "${id}"`));
    }
    let changes: Partial<Device>;
    try {
      changes = computeChanges(current, action, payload);
    } catch (err) {
      return Promise.reject(err);
    }
    // Optimistic: apply locally and emit synchronously, before resolving.
    const next = { ...current, ...changes } as Device;
    this.state.set(id, next);
    this.emit({ id, changes });
    return Promise.resolve();
  }

  private emit(patch: DevicePatch): void {
    // One faulty listener must not block delivery to the rest (the interface
    // documents callback errors as the subscriber's own concern) nor make
    // dispatch() reject after it already applied the change. Isolate each.
    for (const cb of this.listeners) {
      try {
        cb(patch);
      } catch {
        /* a subscriber's failure is its own concern — keep delivering */
      }
    }
  }
}
