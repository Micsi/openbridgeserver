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

import type { Device, PageLink, WidgetAction, WidgetPosition } from '@obs/visu-contract';
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
 * An optional auth surface a data source may add on top of {@link DataSource}
 * (Welle L). Login is **additive**: a source that omits it is a guest-only
 * source (the mock), and the host stays in guest mode. A source that implements
 * it (the obs-server source) can obtain a per-user JWT that unlocks RBAC — but
 * reading never requires it. The network flow lives in the source; the host
 * store only calls these and re-lists/re-subscribes afterwards.
 */
export interface AuthCapableDataSource extends DataSource {
  /** Log in with credentials; rejects on a bad credential (never silently). */
  login(username: string, password: string): Promise<void>;
  /** Drop the session → back to guest. */
  logout(): void | Promise<void>;
  /** Whether a session is currently active (logged in vs. guest). */
  isAuthenticated(): boolean;
}

/** Narrow a {@link DataSource} to one that supports login (guest-safe fallback). */
export function supportsAuth(ds: DataSource): ds is AuthCapableDataSource {
  const cand = ds as Partial<AuthCapableDataSource>;
  return (
    typeof cand.login === 'function' && typeof cand.logout === 'function' && typeof cand.isAuthenticated === 'function'
  );
}

/**
 * The page-scoped access mode surfaced to the app for gating (Welle 3b). Mirrors
 * the server `AccessLevel` / `mapping.PageAccess`: `public`/`readonly` need no
 * auth, `protected` is PIN-gated, `user` needs a per-user JWT login.
 */
export type PageAccessMode = 'readonly' | 'public' | 'protected' | 'user';

/**
 * One page the app must gate before the user can reach it: a PIN-`protected`
 * page without a valid session, or a `user`-level page while the user is a guest.
 * `public`/`readonly` pages are NEVER gated and never appear here (no PIN/login
 * for the mere reading of them, per Golden Rule). Data, not behaviour: the app
 * reads this to render a *dezenter* hint ("PIN erforderlich" / "Anmeldung
 * erforderlich"), never a red error wall.
 */
export interface PageGate {
  /** The PAGE node id: the `authenticatePage` target and the `X-Page-Id`. */
  readonly pageId: string;
  /** The page's name (its room label), for the hint text. */
  readonly name: string;
  /** Why the page is gated: `protected` (PIN) or `user` (login). */
  readonly access: Extract<PageAccessMode, 'protected' | 'user'>;
}

/**
 * An optional page-auth surface a data source may add (Welle 3b). A `protected`
 * page is unlocked with a PIN into a session token; the source caches it and
 * later page-scoped reads/writes carry it. {@link pageGates} enumerates the pages
 * that currently need a gate decision so the app can offer a PIN prompt / login
 * hint. A source that omits this (the mock) simply has no gated pages, so the
 * guest default is untouched.
 */
export interface PageAuthCapableDataSource extends DataSource {
  /** Unlock a PIN-protected page; rejects on a wrong PIN (never silently). */
  authenticatePage(pageId: string, pin: string): Promise<unknown>;
  /** The pages that currently need a gate (PIN missing / login required). */
  pageGates(): readonly PageGate[];
  /**
   * Whether a valid PIN session is held for `nodeId` — the node that DEFINES the
   * access, which is where the backend scopes the session (mapping →
   * `accessNodeId`). Optional and additive (#1194): the host's link resolution
   * asks this before jumping onto a `protected` target, so a link lands on the
   * PIN path instead of blindly on the page. A source that omits it simply
   * reports "no session", which gates rather than leaks.
   */
  hasPageSession?(nodeId: string): boolean;
}

/** Narrow a {@link DataSource} to one that supports PIN/page auth (guest-safe). */
export function supportsPageAuth(ds: DataSource): ds is PageAuthCapableDataSource {
  const cand = ds as Partial<PageAuthCapableDataSource>;
  return typeof cand.authenticatePage === 'function' && typeof cand.pageGates === 'function';
}

/**
 * A source that carries per-device author positions (x/y/w/h, CONTRACT-v1.9 →
 * layering W3). Additive: a source without it (the mock) simply has no positions,
 * so a pixel-honouring skin falls back to the responsive floor. {@link positions}
 * maps a device id to its {@link WidgetPosition} when the backend widget declares
 * a complete box.
 */
export interface PositionCapableDataSource extends DataSource {
  /** Device id → author position, for devices whose widget declares x/y/w/h. */
  positions(): ReadonlyMap<string, WidgetPosition>;
}

/** Does the source expose per-device author positions (layering W3)? */
export function supportsPositions(ds: DataSource): ds is PositionCapableDataSource {
  return typeof (ds as Partial<PositionCapableDataSource>).positions === 'function';
}

/**
 * A source that carries per-device page links (CONTRACT-v1.11 → #1194). Additive:
 * a source without it (the mock) simply has no links, so every tile behaves as
 * before. {@link links} maps a device id to its {@link PageLink} when the backend
 * widget declares a target node (the V1 `target_node_id` config key).
 */
export interface LinkCapableDataSource extends DataSource {
  /** Device id → page link, for devices whose widget declares a target node. */
  links(): ReadonlyMap<string, PageLink>;
}

/** Does the source expose per-device page links (#1194)? */
export function supportsLinks(ds: DataSource): ds is LinkCapableDataSource {
  return typeof (ds as Partial<LinkCapableDataSource>).links === 'function';
}

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
 * A shallow copy still shares nested objects – a jalousie's `statuses` array and
 * its status objects, and the v1.6 `presets` array (blind/jalousie) with its
 * preset objects – so a consumer mutating `list()[…].statuses[0]` or a preset
 * would reach back into the source. Deep-clone the nested fields that exist.
 */
function clone(device: Device): Device {
  if (device.type === 'jalousie') {
    return {
      ...device,
      statuses: device.statuses.map((s) => ({ ...s })),
      ...(device.presets ? { presets: device.presets.map((p) => ({ ...p })) } : {}),
    };
  }
  if (device.type === 'blind' && device.presets) {
    return { ...device, presets: device.presets.map((p) => ({ ...p })) };
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
