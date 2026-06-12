import { describe, it, expect, vi } from 'vitest';
import type {
  Device,
  LightDevice,
  BlindDevice,
  JalousieDevice,
  MediaDevice,
  CameraDevice,
} from '@obs/visu-contract';

import { MockDataSource, type DataSource, type DevicePatch } from './datasource';
import { byId } from './model';

/**
 * core/datasource — the austauschbare Andockpunkt (CO6, Issue #92).
 *
 * MIGRATION §4: a `DataSource` interface (list / subscribe / dispatch) plus a
 * `MockDataSource` that today holds a local reactive state seeded from
 * `core/model.ts`. `dispatch` is a local mutator; later KNX/MQTT/obs-REST plug
 * in behind the *same* interface, UI unchanged.
 *
 * Goldene Regeln honoured here:
 *  - State lives in core (this module is that single owner for live device state).
 *  - `dispatch` performs only the canonical actions (CONTRACT-v1 §6); callers send
 *    intents, never mutate a Device directly.
 *  - Imports no skin/renderer — only the model + the data/type contract.
 */

function freshDevices(ds: DataSource): Promise<Device[]> {
  return ds.list();
}

describe('core/datasource — list()', () => {
  it('returns the model devices (seeded from store.js dataset)', async () => {
    const ds = new MockDataSource();
    const list = await ds.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(Object.keys(byId).length);
    const ids = new Set(list.map((d) => d.id));
    for (const id of Object.keys(byId)) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('returns deep copies — the caller cannot mutate the source state', async () => {
    const ds = new MockDataSource();
    const a = await ds.list();
    const target = a.find((d) => d.type === 'light') as LightDevice;
    // Mutating the returned object must not leak back into the source.
    (target as { on: boolean }).on = !target.on;
    const b = await ds.list();
    const same = b.find((d) => d.id === target.id) as LightDevice;
    expect(same.on).toBe(byId[target.id!] ? (byId[target.id!] as LightDevice).on : false);
  });

  it('serves the v1.2 media + camera demo devices with their contract fields (Issue #122)', async () => {
    const ds = new MockDataSource();
    const list = await ds.list();

    const playing = list.find((d) => d.type === 'media' && (d as MediaDevice).playState === 'playing') as
      | MediaDevice
      | undefined;
    expect(playing).toBeDefined();
    expect(playing!.title).toBeTypeOf('string');
    expect(playing!.subtitle).toBeTypeOf('string');
    expect(playing!.volume).toBeTypeOf('number');
    expect(playing!.artUrl).toBeTypeOf('string');

    const onlineCam = list.find((d) => d.type === 'camera' && (d as CameraDevice).online) as
      | CameraDevice
      | undefined;
    expect(onlineCam).toBeDefined();
    expect(onlineCam!.snapshotUrl).toBeTypeOf('string');
  });

  it('deep-clones nested jalousie statuses — mutating a snapshot does not leak back', async () => {
    const ds = new MockDataSource();
    const a = await ds.list();
    const jal = a.find((d) => d.type === 'jalousie' && (d as JalousieDevice).statuses.length > 0) as
      | JalousieDevice
      | undefined;
    if (!jal) throw new Error('no jalousie with statuses in the model');
    // Mutate a nested status object on the returned snapshot.
    (jal.statuses[0] as { val: boolean | null }).val = !jal.statuses[0].val;
    const b = await ds.list();
    const same = b.find((d) => d.id === jal.id) as JalousieDevice;
    expect(same.statuses[0].val).not.toBe(jal.statuses[0].val);
  });
});

describe('core/datasource — subscribe()', () => {
  it('returns an unsubscribe function that stops further patches', async () => {
    const ds = new MockDataSource();
    const cb = vi.fn<(p: DevicePatch) => void>();
    const off = ds.subscribe(cb);
    expect(typeof off).toBe('function');

    const lightId = (await firstOfType(ds, 'light')).id!;
    await ds.dispatch(lightId, 'toggle');
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    await ds.dispatch(lightId, 'toggle');
    expect(cb).toHaveBeenCalledTimes(1); // no further deliveries
  });

  it('delivers a patch addressed to the mutated device id', async () => {
    const ds = new MockDataSource();
    const lightId = (await firstOfType(ds, 'light')).id!;
    const patches: DevicePatch[] = [];
    ds.subscribe((p) => patches.push(p));
    await ds.dispatch(lightId, 'toggle');
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe(lightId);
    expect('on' in patches[0].changes).toBe(true);
  });

  it('supports multiple independent subscribers', async () => {
    const ds = new MockDataSource();
    const a = vi.fn();
    const b = vi.fn();
    ds.subscribe(a);
    ds.subscribe(b);
    const lightId = (await firstOfType(ds, 'light')).id!;
    await ds.dispatch(lightId, 'toggle');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing subscriber — later subscribers still receive the patch and dispatch resolves', async () => {
    const ds = new MockDataSource();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    ds.subscribe(bad);
    ds.subscribe(good);
    const lightId = (await firstOfType(ds, 'light')).id!;
    await expect(ds.dispatch(lightId, 'toggle')).resolves.toBeUndefined();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('core/datasource — dispatch() canonical actions', () => {
  it('toggle flips a light/switch on-state', async () => {
    const ds = new MockDataSource();
    const id = (await firstOfType(ds, 'light')).id!;
    const before = (await getById(ds, id)) as LightDevice;
    await ds.dispatch(id, 'toggle');
    const after = (await getById(ds, id)) as LightDevice;
    expect(after.on).toBe(!before.on);
  });

  it('setDim sets a clamped brightness 0..100 and turns the light on when > 0', async () => {
    const ds = new MockDataSource();
    const id = (await firstDimmable(ds)).id!;
    await ds.dispatch(id, 'setDim', { value: 150 });
    let d = (await getById(ds, id)) as LightDevice;
    expect(d.dim).toBe(100);
    expect(d.on).toBe(true);
    await ds.dispatch(id, 'setDim', { value: -10 });
    d = (await getById(ds, id)) as LightDevice;
    expect(d.dim).toBe(0);
    expect(d.on).toBe(false);
  });

  it('setPosition clamps a blind/jalousie position 0..100', async () => {
    const ds = new MockDataSource();
    const id = (await firstOfType(ds, 'blind')).id!;
    await ds.dispatch(id, 'setPosition', { value: 200 });
    const d = (await getById(ds, id)) as BlindDevice;
    expect(d.position).toBe(100);
  });

  it('setSlat clamps a jalousie slat angle 0..100', async () => {
    const ds = new MockDataSource();
    const id = (await firstOfType(ds, 'jalousie')).id!;
    await ds.dispatch(id, 'setSlat', { value: -5 });
    const d = (await getById(ds, id)) as JalousieDevice;
    expect(d.slat).toBe(0);
  });

  it('lock / unlock toggles the locked flag', async () => {
    const ds = new MockDataSource();
    const id = (await firstOfType(ds, 'blind')).id!;
    await ds.dispatch(id, 'lock');
    expect(((await getById(ds, id)) as BlindDevice).locked).toBe(true);
    await ds.dispatch(id, 'unlock');
    expect(((await getById(ds, id)) as BlindDevice).locked).toBe(false);
  });

  it('accepts the contract `{ pct }` payload for slider actions (setDim/setPosition/setSlat)', async () => {
    const ds = new MockDataSource();
    const lightId = (await firstDimmable(ds)).id!;
    await ds.dispatch(lightId, 'setDim', { pct: 30 });
    expect(((await getById(ds, lightId)) as LightDevice).dim).toBe(30);

    const blindId = (await firstOfType(ds, 'blind')).id!;
    await ds.dispatch(blindId, 'setPosition', { pct: 80 });
    expect(((await getById(ds, blindId)) as BlindDevice).position).toBe(80);

    const jalId = (await firstOfType(ds, 'jalousie')).id!;
    await ds.dispatch(jalId, 'setSlat', { pct: 55 });
    expect(((await getById(ds, jalId)) as JalousieDevice).slat).toBe(55);
  });

  it('rejects setDim on a non-dimmable (dim === null) light', async () => {
    const ds = new MockDataSource();
    const list = await ds.list();
    const nonDim = list.find((x) => x.type === 'light' && (x as LightDevice).dim === null) as
      | LightDevice
      | undefined;
    if (!nonDim) throw new Error('no non-dimmable light in the model');
    await expect(ds.dispatch(nonDim.id!, 'setDim', { pct: 50 })).rejects.toThrow();
    // The light stays non-dimmable (its classification is unchanged).
    expect(((await getById(ds, nonDim.id!)) as LightDevice).dim).toBeNull();
  });

  it('rejects an unknown device id', async () => {
    const ds = new MockDataSource();
    await expect(ds.dispatch('does-not-exist', 'toggle')).rejects.toThrow();
  });

  it('rejects an action the device type does not support', async () => {
    const ds = new MockDataSource();
    const id = (await firstOfType(ds, 'blind')).id!;
    await expect(ds.dispatch(id, 'toggle')).rejects.toThrow();
  });
});

describe('core/datasource — optimistic update', () => {
  it('applies the change to local state synchronously before dispatch resolves', async () => {
    const ds = new MockDataSource();
    const id = (await firstOfType(ds, 'light')).id!;
    const before = ((await getById(ds, id)) as LightDevice).on;
    const seen: boolean[] = [];
    ds.subscribe((p) => {
      if (p.id === id && 'on' in p.changes) seen.push(p.changes.on as boolean);
    });
    const pending = ds.dispatch(id, 'toggle');
    // The patch must already have been delivered (optimistic) before the await.
    expect(seen).toEqual([!before]);
    await pending;
    expect(((await getById(ds, id)) as LightDevice).on).toBe(!before);
  });

  it('a patch carries only the changed fields, not the whole device', async () => {
    const ds = new MockDataSource();
    const id = (await firstDimmable(ds)).id!;
    let patch: DevicePatch | undefined;
    ds.subscribe((p) => {
      patch = p;
    });
    await ds.dispatch(id, 'setDim', { value: 40 });
    expect(patch).toBeDefined();
    expect(patch!.changes).toMatchObject({ dim: 40, on: true });
    expect('position' in patch!.changes).toBe(false);
  });
});

/* ----------------------------------------------------------------- helpers */

async function firstOfType(ds: DataSource, type: Device['type']): Promise<Device> {
  const list = await freshDevices(ds);
  const d = list.find((x) => x.type === type);
  if (!d) throw new Error(`no device of type ${type}`);
  return d;
}

async function firstDimmable(ds: DataSource): Promise<LightDevice> {
  const list = await freshDevices(ds);
  const d = list.find((x) => x.type === 'light' && (x as LightDevice).dim !== null) as
    | LightDevice
    | undefined;
  if (!d) throw new Error('no dimmable light');
  return d;
}

async function getById(ds: DataSource, id: string): Promise<Device> {
  const list = await ds.list();
  const d = list.find((x) => x.id === id);
  if (!d) throw new Error(`no device ${id}`);
  return d;
}
