import { describe, it, expect } from 'vitest';
import type { BlindDevice, JalousieDevice, LightDevice, SwitchDevice } from '@obs/visu-contract';
import {
  obsKind,
  mapWidget,
  mapTree,
  applyDp,
  planWrite,
  toBool,
  toNum,
  type ObsWidget,
  type ObsVisuNode,
} from './mapping';

/* ----------------------------------------------------------------- widgets */

const lichtSwitch = (over: Partial<ObsWidget> = {}): ObsWidget => ({
  id: 'w-licht',
  name: 'Wandleuchte',
  type: 'Licht',
  datapoint_id: null,
  status_datapoint_id: null,
  config: {
    label: 'Wandleuchte',
    mode: 'switch',
    dp_switch: 'dp-sw',
    dp_switch_status: 'dp-sw-st',
  },
  ...over,
});

const lichtDim = (): ObsWidget => ({
  id: 'w-dim',
  name: 'Pendel',
  type: 'Licht',
  datapoint_id: null,
  status_datapoint_id: null,
  config: {
    label: 'Pendel',
    mode: 'dimm',
    dp_switch: 'dp-d-sw',
    dp_switch_status: 'dp-d-sw-st',
    dp_dim: 'dp-dim',
    dp_dim_status: 'dp-dim-st',
  },
});

const toggle = (): ObsWidget => ({
  id: 'w-toggle',
  name: 'Lüfter',
  type: 'Toggle',
  datapoint_id: 'dp-tg-write',
  status_datapoint_id: 'dp-tg-read',
  config: { label: 'Lüfter' },
});

const rolladen = (over: Partial<ObsWidget['config']> = {}): ObsWidget => ({
  id: 'w-roll',
  name: 'Rollladen',
  type: 'Rolladen',
  datapoint_id: null,
  status_datapoint_id: null,
  config: {
    label: 'Rollladen',
    mode: 'rolladen',
    invert: false,
    dp_position: 'dp-pos',
    dp_position_status: 'dp-pos-st',
    dp_lock: 'dp-lock',
    ...over,
  },
});

const jalousie = (): ObsWidget => ({
  id: 'w-jal',
  name: 'Jalousie Süd',
  type: 'Rolladen',
  datapoint_id: null,
  status_datapoint_id: null,
  config: {
    label: 'Jalousie Süd',
    mode: 'jalousie',
    invert: false,
    dp_position: 'dp-jp',
    dp_position_status: 'dp-jp-st',
    dp_slat: 'dp-js',
    dp_slat_status: 'dp-js-st',
    dp_lock: 'dp-jl',
    dp_status_1: 'dp-st1',
    label_status_1: 'Sturm',
    dp_status_2: 'dp-st2',
    label_status_2: 'Sonne',
  },
});

/* ----------------------------------------------------------- coercion */

describe('toBool / toNum', () => {
  it('coerces booleans, numbers and strings', () => {
    expect(toBool(true)).toBe(true);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool('on')).toBe(true);
    expect(toBool('false')).toBe(false);
    expect(toBool(null)).toBe(null);
    expect(toNum(42)).toBe(42);
    expect(toNum('17')).toBe(17);
    expect(toNum('x')).toBe(null);
  });
});

/* -------------------------------------------------------------- obsKind */

describe('obsKind — server type → CoreWidgetType', () => {
  it('maps Licht→light, Toggle→switch, Rolladen→blind, jalousie-mode→jalousie', () => {
    expect(obsKind(lichtSwitch())).toBe('light');
    expect(obsKind(toggle())).toBe('switch');
    expect(obsKind(rolladen())).toBe('blind');
    expect(obsKind(jalousie())).toBe('jalousie');
  });

  it('returns null for unmapped types (media/camera/value/chart skipped)', () => {
    for (const type of ['Kamera', 'ValueDisplay', 'Chart', 'Wetter', 'IFrame', 'Slider']) {
      const w: ObsWidget = { id: 'x', type, datapoint_id: null, status_datapoint_id: null, config: {} };
      expect(obsKind(w)).toBe(null);
      expect(mapWidget(w, 'Room')).toBe(null);
    }
  });
});

/* ------------------------------------------------------------ list mapping */

describe('mapWidget — per type', () => {
  it('light (switch mode) — on from status DP, dim null (non-dimmable)', () => {
    const values = new Map<string, unknown>([['dp-sw-st', true]]);
    const m = mapWidget(lichtSwitch(), 'EG Küche', values)!;
    const d = m.device as LightDevice;
    expect(d.type).toBe('light');
    expect(d.room).toBe('EG Küche');
    expect(d.label).toBe('Wandleuchte');
    expect(d.on).toBe(true);
    expect(d.dim).toBe(null);
    expect(m.writes.onOff).toBe('dp-sw');
  });

  it('light (dimm mode) — dim from status DP, on derived', () => {
    const values = new Map<string, unknown>([['dp-dim-st', 55]]);
    const m = mapWidget(lichtDim(), 'EG Küche', values)!;
    const d = m.device as LightDevice;
    expect(d.dim).toBe(55);
    expect(m.writes.dim).toBe('dp-dim');
  });

  it('switch (Toggle) — reads status DP, writes datapoint_id', () => {
    const values = new Map<string, unknown>([['dp-tg-read', 1]]);
    const m = mapWidget(toggle(), 'EG WC', values)!;
    const d = m.device as SwitchDevice;
    expect(d.type).toBe('switch');
    expect(d.on).toBe(true);
    expect(m.writes.onOff).toBe('dp-tg-write');
  });

  it('blind — position from status DP, locked from lock DP', () => {
    const values = new Map<string, unknown>([['dp-pos-st', 62], ['dp-lock', true]]);
    const m = mapWidget(rolladen(), 'Wintergarten', values)!;
    const d = m.device as BlindDevice;
    expect(d.type).toBe('blind');
    expect(d.position).toBe(62);
    expect(d.locked).toBe(true);
    expect(m.writes.position).toBe('dp-pos');
  });

  it('blind with invert — shown position is 100 - raw', () => {
    const values = new Map<string, unknown>([['dp-pos-st', 30]]);
    const m = mapWidget(rolladen({ invert: true }), 'Wintergarten', values)!;
    expect((m.device as BlindDevice).position).toBe(70);
    expect(m.writes.invertPosition).toBe(true);
  });

  it('jalousie — position, slat, lock and status traffic-lights from config DPs', () => {
    const values = new Map<string, unknown>([
      ['dp-jp-st', 40],
      ['dp-js-st', 35],
      ['dp-jl', false],
      ['dp-st1', false],
      ['dp-st2', true],
    ]);
    const m = mapWidget(jalousie(), 'Wintergarten', values)!;
    const d = m.device as JalousieDevice;
    expect(d.type).toBe('jalousie');
    expect(d.position).toBe(40);
    expect(d.slat).toBe(35);
    expect(d.locked).toBe(false);
    expect(d.statuses).toEqual([
      { label: 'Sturm', val: false },
      { label: 'Sonne', val: true },
    ]);
    expect(m.writes.slat).toBe('dp-js');
    expect(m.writes.lock).toBe('dp-jl');
  });
});

/* ----------------------------------------------------------------- mapTree */

describe('mapTree — flatten visu tree to devices, room = PAGE name', () => {
  const tree: ObsVisuNode[] = [
    { id: 'loc', parent_id: null, name: 'EG', type: 'LOCATION', page_config: null },
    {
      id: 'page-1',
      parent_id: 'loc',
      name: 'Küche',
      type: 'PAGE',
      page_config: { widgets: [lichtSwitch(), toggle(), { id: 'skip', type: 'Chart', datapoint_id: null, status_datapoint_id: null, config: {} }] },
    },
    {
      id: 'page-2',
      parent_id: 'loc',
      name: 'Wintergarten',
      type: 'PAGE',
      page_config: { widgets: [jalousie()] },
    },
  ];

  it('keeps tree/page/widget order and skips unmapped widgets', () => {
    const mapped = mapTree(tree);
    expect(mapped.map((m) => m.device.id)).toEqual(['w-licht', 'w-toggle', 'w-jal']);
    expect(mapped[0].device.room).toBe('Küche');
    expect(mapped[2].device.room).toBe('Wintergarten');
  });
});

/* ---------------------------------------------------------------- applyDp */

describe('applyDp — value-event → device field patch', () => {
  it('maps a position DP back to position (with invert)', () => {
    const m = mapWidget(rolladen({ invert: true }), 'WG')!;
    const patch = applyDp(m.binding, m.device, 'dp-pos-st', 25);
    expect(patch).toEqual({ position: 75 });
  });

  it('maps a dim DP back to dim + on', () => {
    const m = mapWidget(lichtDim(), 'K')!;
    expect(applyDp(m.binding, m.device, 'dp-dim-st', 0)).toEqual({ dim: 0, on: false });
    expect(applyDp(m.binding, m.device, 'dp-dim-st', 80)).toEqual({ dim: 80, on: true });
  });

  it('maps a jalousie status DP back to the matching statuses entry', () => {
    const m = mapWidget(jalousie(), 'WG')!;
    const patch = applyDp(m.binding, m.device, 'dp-st2', false) as { statuses: JalousieDevice['statuses'] };
    expect(patch.statuses[1]).toEqual({ label: 'Sonne', val: false });
    expect(patch.statuses[0]).toEqual({ label: 'Sturm', val: null });
  });

  it('returns null when the DP feeds no field of the device', () => {
    const m = mapWidget(toggle(), 'WC')!;
    expect(applyDp(m.binding, m.device, 'unrelated-dp', true)).toBe(null);
  });
});

/* --------------------------------------------------------------- planWrite */

describe('planWrite — canonical action → DP write', () => {
  it('toggle inverts the current on state onto the on/off DP', () => {
    const m = mapWidget(toggle(), 'WC', new Map([['dp-tg-read', false]]))!;
    expect(planWrite(m.device, m.writes, 'toggle')).toEqual({ dp: 'dp-tg-write', value: true });
  });

  it('setDim writes the clamped percentage', () => {
    const m = mapWidget(lichtDim(), 'K')!;
    expect(planWrite(m.device, m.writes, 'setDim', { pct: 150 })).toEqual({ dp: 'dp-dim', value: 100 });
  });

  it('setPosition applies invert to the written value', () => {
    const m = mapWidget(rolladen({ invert: true }), 'WG')!;
    expect(planWrite(m.device, m.writes, 'setPosition', { pct: 70 })).toEqual({ dp: 'dp-pos', value: 30 });
  });

  it('setSlat writes the slat DP', () => {
    const m = mapWidget(jalousie(), 'WG')!;
    expect(planWrite(m.device, m.writes, 'setSlat', { pct: 35 })).toEqual({ dp: 'dp-js', value: 35 });
  });

  it('lock/unlock write boolean to the lock DP', () => {
    const m = mapWidget(rolladen(), 'WG')!;
    expect(planWrite(m.device, m.writes, 'lock')).toEqual({ dp: 'dp-lock', value: true });
    expect(planWrite(m.device, m.writes, 'unlock')).toEqual({ dp: 'dp-lock', value: false });
  });

  it('throws for an action a device does not support', () => {
    const m = mapWidget(toggle(), 'WC')!;
    expect(() => planWrite(m.device, m.writes, 'setSlat', { pct: 1 })).toThrow();
  });
});
