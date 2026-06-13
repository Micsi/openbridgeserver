/**
 * core/obs/mapping — pure server-Visu-config → contract translation.
 *
 * The obs server stores its Visu as a tree of `VisuNode`s (LOCATION/PAGE); a
 * PAGE carries `page_config.widgets[]`, each a `WidgetInstance` with a server
 * `type` (the `frontend/` widget taxonomy: "Licht", "Toggle", "Rolladen", …),
 * an optional `datapoint_id` / `status_datapoint_id` and a free-form `config`
 * that — for blind/jalousie — holds the extra datapoint references.
 *
 * This module is the *spec mirror* of the reference `frontend/` widgets
 * (Licht/Toggle/Rolladen/…/Widget.vue): it reproduces which config keys carry
 * which datapoint and how raw datapoint values map onto contract device fields.
 * It is PURE — no fetch, no WebSocket, no state — so the transport
 * (ObsDataSource) and the tests can both reason over it cheaply.
 *
 * Golden rules: one model (no data fork), renderer-rein (imports only the
 * contract), data=JSON / behaviour=code (the mapping tables are data, the field
 * derivation is the only code).
 */

import type {
  Device,
  LightDevice,
  SwitchDevice,
  BlindDevice,
  JalousieDevice,
  JalousieStatus,
  AccentToken,
} from '@obs/visu-contract';

/* ----------------------------------------------------------- server schema */
// Minimal structural shapes of the obs REST responses we consume. Mirrors
// obs/models/visu.py (WidgetInstance, PageConfig, VisuNode) and the
// datapoints value endpoint — only the fields this mapping reads.

/** One widget on a page (obs/models/visu.py → WidgetInstance). */
export interface ObsWidget {
  readonly id: string;
  readonly name?: string;
  readonly type: string;
  readonly datapoint_id: string | null;
  readonly status_datapoint_id: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

/** A page's render config (obs/models/visu.py → PageConfig). */
export interface ObsPageConfig {
  readonly widgets?: readonly ObsWidget[];
}

/** A visu tree node (obs/models/visu.py → VisuNode), flat list from /visu/tree. */
export interface ObsVisuNode {
  readonly id: string;
  readonly parent_id: string | null;
  readonly name: string;
  readonly type: 'LOCATION' | 'PAGE';
  readonly page_config: ObsPageConfig | null;
}

/** A single datapoint value (websocket value-event / GET …/value, normalised). */
export interface DpValue {
  readonly id: string;
  readonly v: unknown;
}

/* --------------------------------------------------------------- helpers */

/** Read a string config key, returning null for missing/empty (frontend pattern). */
function cfgStr(config: Readonly<Record<string, unknown>>, key: string): string | null {
  const v = config[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Read a boolean config key (default false), mirroring `(config.x as boolean) ?? false`. */
function cfgBool(config: Readonly<Record<string, unknown>>, key: string): boolean {
  return config[key] === true;
}

/** Coerce a raw datapoint value to boolean (Rolladen/Licht `getBool`). null = unknown. */
export function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'off' || s === '') return false;
  }
  return null;
}

/** Coerce a raw datapoint value to a number (Rolladen/Licht `toNumber`). null = unknown. */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

const clampPct = (n: number): number => Math.max(0, Math.min(100, n));

/* --------------------------------------------------- type → CoreWidgetType */
// The reference frontend widget `type` strings that have a stable core-contract
// equivalent. Other server widget types (ValueDisplay, Chart, Wetter, Kamera,
// IFrame, …) have no core mobile equivalent yet and are skipped (issue #124:
// media/camera + tablet/desktop types are not mapped — they stay on the mock
// demo page, the mapper just ignores them, never crashes).
export type ObsKind = 'light' | 'switch' | 'blind' | 'jalousie';

/**
 * The datapoint ids a mapped device reads from (status DP preferred), used to
 * build the websocket subscription set. Each entry remembers which device field
 * the datapoint feeds so a value-event can be applied back (see {@link applyDp}).
 */
export interface DeviceBinding {
  /** The mapped device's stable id (server widget id). */
  readonly deviceId: string;
  /** datapoint id → which field of the device it updates. */
  readonly reads: ReadonlyArray<{ readonly dp: string; readonly field: BoundField }>;
}

/** Which contract field a subscribed datapoint feeds. */
export type BoundField =
  | { readonly kind: 'on' } // boolean → on
  | { readonly kind: 'dim' } // number 0-100 → dim (+on)
  | { readonly kind: 'position'; readonly invert: boolean } // number → position
  | { readonly kind: 'slat' } // number → slat
  | { readonly kind: 'locked' } // boolean → locked
  | { readonly kind: 'status'; readonly index: number }; // boolean → statuses[i].val

/** Mutable builder for {@link DeviceBinding.reads}; assignable to the readonly field. */
type MutableReads = Array<{ dp: string; field: BoundField }>;

/**
 * One fully mapped widget: the contract {@link Device} (with current values
 * applied) plus its {@link DeviceBinding} (read datapoints) and the write
 * targets `dispatch()` needs. Returns `null` for widgets without a core mapping.
 */
export interface MappedWidget {
  readonly device: Device;
  readonly binding: DeviceBinding;
  /** Write-target datapoint ids per canonical action (dispatch uses these). */
  readonly writes: WriteTargets;
}

/** Write-target datapoints + scaling info per device (dispatch reads these). */
export interface WriteTargets {
  readonly onOff?: string | null; // toggle → boolean DP (light dp_switch / switch datapoint_id)
  readonly dim?: string | null; // setDim → 0-100 DP
  readonly position?: string | null; // setPosition → 0-100 DP (invert handled below)
  readonly invertPosition?: boolean;
  readonly slat?: string | null; // setSlat → 0-100 DP
  readonly lock?: string | null; // lock/unlock → boolean DP
}

/** Map a raw server `type` to its core kind, or null if it has no core mapping. */
export function obsKind(widget: ObsWidget): ObsKind | null {
  switch (widget.type) {
    case 'Licht':
      return 'light';
    case 'Toggle':
      return 'switch';
    case 'Rolladen':
      // Rolladen with mode 'jalousie' has a slat → contract jalousie; else blind.
      return cfgStr(widget.config, 'mode') === 'jalousie' ? 'jalousie' : 'blind';
    default:
      return null;
  }
}

/* ----------------------------------------------------------- per-type map */
// Each builder mirrors the corresponding reference Widget.vue: it picks the read
// datapoints (status preferred, e.g. `dpDimStatus.value ?? dpDim.value`) for the
// initial value + subscription, and records the write targets for dispatch.

const DEFAULT_ACCENT: AccentToken = 'slate';

function mapLight(w: ObsWidget, room: string, values: ReadonlyMap<string, unknown>): MappedWidget {
  const dpSwitch = cfgStr(w.config, 'dp_switch');
  const dpSwitchStatus = cfgStr(w.config, 'dp_switch_status');
  const dpDim = cfgStr(w.config, 'dp_dim');
  const dpDimStatus = cfgStr(w.config, 'dp_dim_status');
  const dimmable = cfgStr(w.config, 'mode') === 'dimm';

  const onReadDp = dpSwitchStatus ?? dpSwitch;
  const dimReadDp = dpDimStatus ?? dpDim;

  const on = onReadDp ? (toBool(values.get(onReadDp)) ?? false) : false;
  const dim = dimmable && dimReadDp ? toNum(values.get(dimReadDp)) : null;

  const reads: MutableReads = [];
  if (onReadDp) reads.push({ dp: onReadDp, field: { kind: 'on' } });
  if (dimmable && dimReadDp) reads.push({ dp: dimReadDp, field: { kind: 'dim' } });

  const device: LightDevice = {
    id: w.id,
    type: 'light',
    room,
    label: deviceLabel(w),
    accent: DEFAULT_ACCENT,
    on,
    dim: dim === null ? (dimmable ? 0 : null) : clampPct(dim),
  };
  return {
    device,
    binding: { deviceId: w.id, reads },
    writes: { onOff: dpSwitch ?? dpSwitchStatus, dim: dpDim ?? dpDimStatus },
  };
}

function mapSwitch(w: ObsWidget, room: string, values: ReadonlyMap<string, unknown>): MappedWidget {
  // Toggle: datapoint_id writes, status_datapoint_id reads (frontend `statusValue ?? value`).
  const readDp = w.status_datapoint_id ?? w.datapoint_id;
  const on = readDp ? (toBool(values.get(readDp)) ?? false) : false;
  const reads: DeviceBinding['reads'] = readDp ? [{ dp: readDp, field: { kind: 'on' } }] : [];

  const device: SwitchDevice = {
    id: w.id,
    type: 'switch',
    room,
    label: deviceLabel(w),
    accent: DEFAULT_ACCENT,
    on,
  };
  return {
    device,
    binding: { deviceId: w.id, reads },
    writes: { onOff: w.datapoint_id ?? w.status_datapoint_id },
  };
}

function mapBlind(w: ObsWidget, room: string, values: ReadonlyMap<string, unknown>): MappedWidget {
  const invert = cfgBool(w.config, 'invert');
  const dpPos = cfgStr(w.config, 'dp_position');
  const dpPosStatus = cfgStr(w.config, 'dp_position_status');
  const dpLock = cfgStr(w.config, 'dp_lock');
  const posReadDp = dpPosStatus ?? dpPos;

  // frontend: shownPosition = invert ? 100 - raw : raw
  const rawPos = posReadDp ? toNum(values.get(posReadDp)) : null;
  const position = rawPos === null ? 0 : clampPct(invert ? 100 - rawPos : rawPos);
  const locked = dpLock ? (toBool(values.get(dpLock)) ?? false) : false;

  const reads: MutableReads = [];
  if (posReadDp) reads.push({ dp: posReadDp, field: { kind: 'position', invert } });
  if (dpLock) reads.push({ dp: dpLock, field: { kind: 'locked' } });

  const device: BlindDevice = {
    id: w.id,
    type: 'blind',
    room,
    label: deviceLabel(w),
    accent: DEFAULT_ACCENT,
    position,
    locked,
  };
  return {
    device,
    binding: { deviceId: w.id, reads },
    writes: { position: dpPos ?? dpPosStatus, invertPosition: invert, lock: dpLock },
  };
}

function mapJalousie(
  w: ObsWidget,
  room: string,
  values: ReadonlyMap<string, unknown>,
): MappedWidget {
  const invert = cfgBool(w.config, 'invert');
  const dpPos = cfgStr(w.config, 'dp_position');
  const dpPosStatus = cfgStr(w.config, 'dp_position_status');
  const dpSlat = cfgStr(w.config, 'dp_slat');
  const dpSlatStatus = cfgStr(w.config, 'dp_slat_status');
  const dpLock = cfgStr(w.config, 'dp_lock');
  const posReadDp = dpPosStatus ?? dpPos;
  const slatReadDp = dpSlatStatus ?? dpSlat;

  const rawPos = posReadDp ? toNum(values.get(posReadDp)) : null;
  const position = rawPos === null ? 0 : clampPct(invert ? 100 - rawPos : rawPos);
  const rawSlat = slatReadDp ? toNum(values.get(slatReadDp)) : null;
  const slat = rawSlat === null ? 0 : clampPct(rawSlat);
  const locked = dpLock ? (toBool(values.get(dpLock)) ?? false) : false;

  const reads: MutableReads = [];
  if (posReadDp) reads.push({ dp: posReadDp, field: { kind: 'position', invert } });
  if (slatReadDp) reads.push({ dp: slatReadDp, field: { kind: 'slat' } });
  if (dpLock) reads.push({ dp: dpLock, field: { kind: 'locked' } });

  // Status traffic-light DPs (dp_status_1..4 + label_status_1..4).
  const statuses: JalousieStatus[] = [];
  for (let i = 1; i <= 4; i++) {
    const dp = cfgStr(w.config, `dp_status_${i}`);
    if (!dp) continue;
    const label = cfgStr(w.config, `label_status_${i}`) ?? `Status ${i}`;
    statuses.push({ label, val: toBool(values.get(dp)) });
    reads.push({ dp, field: { kind: 'status', index: statuses.length - 1 } });
  }

  const device: JalousieDevice = {
    id: w.id,
    type: 'jalousie',
    mode: 'jalousie',
    room,
    label: deviceLabel(w),
    accent: DEFAULT_ACCENT,
    position,
    slat,
    locked,
    invert,
    moving: null,
    statuses,
  };
  return {
    device,
    binding: { deviceId: w.id, reads },
    writes: {
      position: dpPos ?? dpPosStatus,
      invertPosition: invert,
      slat: dpSlat ?? dpSlatStatus,
      lock: dpLock,
    },
  };
}

/** A widget's label: its config label, else its name, else its type. */
function deviceLabel(w: ObsWidget): string {
  return cfgStr(w.config, 'label') ?? (w.name && w.name.length > 0 ? w.name : w.type);
}

/**
 * Map one server widget to a contract device + binding + write targets, applying
 * any already-known datapoint values. Returns null for widgets without a core
 * mapping (issue #124: ValueDisplay/Chart/Wetter/Kamera/IFrame/… are skipped).
 */
export function mapWidget(
  w: ObsWidget,
  room: string,
  values: ReadonlyMap<string, unknown> = new Map(),
): MappedWidget | null {
  const kind = obsKind(w);
  switch (kind) {
    case 'light':
      return mapLight(w, room, values);
    case 'switch':
      return mapSwitch(w, room, values);
    case 'blind':
      return mapBlind(w, room, values);
    case 'jalousie':
      return mapJalousie(w, room, values);
    default:
      return null;
  }
}

/**
 * Flatten the visu tree into mapped widgets in tree/page/widget order. The room
 * name is the PAGE node's name (the "Reihenfolge + Gruppierung als Boden").
 * Tree order is taken as given (the REST /visu/tree returns nodes pre-ordered
 * by node_order); widgets keep their page order.
 */
export function mapTree(
  nodes: readonly ObsVisuNode[],
  values: ReadonlyMap<string, unknown> = new Map(),
): MappedWidget[] {
  const out: MappedWidget[] = [];
  for (const node of nodes) {
    if (node.type !== 'PAGE' || !node.page_config?.widgets) continue;
    for (const w of node.page_config.widgets) {
      const mapped = mapWidget(w, node.name, values);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/**
 * Apply one datapoint value-event to a binding, producing the contract-field
 * changes for that device — or null if the datapoint feeds no field of it. The
 * inverse of the per-type read mapping above (status DP → device field).
 */
export function applyDp(
  binding: DeviceBinding,
  device: Device,
  dpId: string,
  rawValue: unknown,
): Partial<Device> | null {
  let changes: Partial<Device> | null = null;
  for (const read of binding.reads) {
    if (read.dp !== dpId) continue;
    const f = read.field;
    if (f.kind === 'on') {
      const b = toBool(rawValue);
      if (b !== null) changes = { ...changes, on: b } as Partial<Device>;
    } else if (f.kind === 'dim') {
      const n = toNum(rawValue);
      if (n !== null) changes = { ...changes, dim: clampPct(n), on: n > 0 } as Partial<Device>;
    } else if (f.kind === 'position') {
      const n = toNum(rawValue);
      if (n !== null) {
        changes = { ...changes, position: clampPct(f.invert ? 100 - n : n) } as Partial<Device>;
      }
    } else if (f.kind === 'slat') {
      const n = toNum(rawValue);
      if (n !== null) changes = { ...changes, slat: clampPct(n) } as Partial<Device>;
    } else if (f.kind === 'locked') {
      const b = toBool(rawValue);
      if (b !== null) changes = { ...changes, locked: b } as Partial<Device>;
    } else if (f.kind === 'status' && device.type === 'jalousie') {
      const b = toBool(rawValue);
      const statuses = device.statuses.map((s, i) =>
        i === f.index ? { label: s.label, val: b } : s,
      );
      changes = { ...changes, statuses } as Partial<Device>;
    }
  }
  return changes;
}

/* --------------------------------------------------- dispatch → DP target */

/** A planned datapoint write: which datapoint and the converted target value. */
export interface DpWrite {
  readonly dp: string;
  readonly value: unknown;
}

const num = (payload: unknown): number => {
  const p = payload as { pct?: unknown; value?: unknown } | undefined;
  const v = p?.pct ?? p?.value;
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error('obs-datasource: action needs a numeric { pct } or { value }');
  }
  return clampPct(v);
};

/**
 * Translate a canonical {@link import('@obs/visu-contract').WidgetAction} into the
 * datapoint write(s) the obs server expects. Pure over (device, writes, action,
 * payload); throws for an action the device/config does not support. The DPT
 * conversion mirrors the reference widgets: booleans for toggle/lock, 0-100 for
 * dim/position/slat (position inverted when configured).
 */
export function planWrite(
  device: Device,
  writes: WriteTargets,
  action: string,
  payload?: unknown,
): DpWrite {
  switch (action) {
    case 'toggle': {
      if (device.type !== 'light' && device.type !== 'switch') break;
      if (!writes.onOff) throw new Error('obs-datasource: no on/off datapoint configured');
      return { dp: writes.onOff, value: !device.on };
    }
    case 'setDim': {
      if (device.type !== 'light') break;
      if (!writes.dim) throw new Error('obs-datasource: no dim datapoint configured');
      return { dp: writes.dim, value: num(payload) };
    }
    case 'setPosition': {
      if (device.type !== 'blind' && device.type !== 'jalousie') break;
      if (!writes.position) throw new Error('obs-datasource: no position datapoint configured');
      const pct = num(payload);
      return { dp: writes.position, value: writes.invertPosition ? 100 - pct : pct };
    }
    case 'setSlat': {
      if (device.type !== 'jalousie') break;
      if (!writes.slat) throw new Error('obs-datasource: no slat datapoint configured');
      return { dp: writes.slat, value: num(payload) };
    }
    case 'lock':
    case 'unlock': {
      if (device.type !== 'blind' && device.type !== 'jalousie') break;
      if (!writes.lock) throw new Error('obs-datasource: no lock datapoint configured');
      return { dp: writes.lock, value: action === 'lock' };
    }
    default:
      break;
  }
  throw new Error(`obs-datasource: action "${action}" not supported for type "${device.type}"`);
}
