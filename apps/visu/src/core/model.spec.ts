import { describe, it, expect } from 'vitest';
import { fixtures } from '@obs/visu-contract';
import type { Device } from '@obs/visu-contract';

import {
  devices,
  byId,
  rooms,
  demoRooms,
  climateRooms,
  layoutRole,
  type RoomGroup,
  type LayoutEntry,
} from './model';

/**
 * core/model — device/room model (CO1, Issue #91).
 *
 * Ported from reference/vue-ionic/store.js (device dataset + mobileGroups).
 * Data shapes follow CONTRACT-v1 §3; the model is read-only to the outside
 * and imports no skins (Goldene Regeln 1 + "Renderer rein").
 */

describe('core/model — loads', () => {
  it('exposes a non-empty device list (ported from store.js)', () => {
    expect(Array.isArray(devices)).toBe(true);
    expect(devices.length).toBeGreaterThan(0);
  });

  it('only carries stable core widget types (no reserved/tablet-only types)', () => {
    // v1.2 added media + camera; v1.4 added climate (and sensor/scene enrichment)
    // to the core types. Still-reserved types (weather/energy/chart/alarm) stay out.
    const coreTypes = new Set([
      'light',
      'switch',
      'blind',
      'jalousie',
      'sensor',
      'scene',
      'media',
      'camera',
      'climate',
    ]);
    for (const d of devices) {
      expect(coreTypes.has(d.type)).toBe(true);
    }
  });

  it('every device declares the contract base fields (id/room/label/accent)', () => {
    for (const d of devices) {
      expect(typeof d.id).toBe('string');
      expect(d.id).not.toBe('');
      expect(typeof d.room).toBe('string');
      expect(typeof d.label).toBe('string');
      expect(typeof d.accent).toBe('string');
    }
  });
});

describe('core/model — byId', () => {
  it('indexes every device by its id', () => {
    for (const d of devices) {
      expect(byId[d.id!]).toBe(d);
    }
    expect(Object.keys(byId).length).toBe(devices.length);
  });

  it('resolves a known id to the matching device', () => {
    const light = byId['kueche-wand'];
    expect(light).toBeDefined();
    expect(light?.type).toBe('light');
    expect(light?.room).toBe('EG Küche');
  });

  it('has no duplicate ids', () => {
    const ids = devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('core/model — room grouping', () => {
  it('groups devices into ordered room blocks (mobileGroups)', () => {
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBeGreaterThan(0);
    const names = rooms.map((g) => g.room);
    expect(names).toEqual([
      'Küche',
      'WC & Bad',
      'Wintergarten',
      'Schlafzimmer',
      'Wohnzimmer',
      'Gäste & Treppe',
      'Technik',
    ]);
  });

  it('every grouped entry references a real device by id', () => {
    for (const group of rooms) {
      for (const entry of group.entries) {
        expect(byId[entry.id]).toBeDefined();
      }
    }
  });

  it('preserves the store.js order within a room (grouping + order as the floor)', () => {
    const kueche = rooms.find((g) => g.room === 'Küche') as RoomGroup;
    expect(kueche.entries.map((e) => e.id)).toEqual([
      'kueche-wand',
      'kueche-pendel',
      'kueche-arbeit',
      'kueche-roll',
    ]);
  });

  it('covers exactly the devices reachable from the room groups (overview + demo + climate)', () => {
    // Every model device is reachable from some exported group set: the mobile
    // overview floor (`rooms`), the v1.2 Medien demo block (`demoRooms`), and the
    // v1.4 climate showcase block (`climateRooms`).
    const grouped = new Set(
      [...rooms, ...demoRooms, ...climateRooms].flatMap((g) => g.entries.map((e) => e.id)),
    );
    expect(grouped.size).toBe(devices.length);
    for (const d of devices) {
      expect(grouped.has(d.id!)).toBe(true);
    }
  });
});

describe('core/model — v1.2 media/camera demo block (Issue #122)', () => {
  it('exposes the Medien demo room kept out of the mobile overview floor', () => {
    expect(rooms.map((g) => g.room)).not.toContain('Medien');
    const medien = demoRooms.find((g) => g.room === 'Medien') as RoomGroup;
    expect(medien).toBeDefined();
    expect(Object.isFrozen(demoRooms)).toBe(true);
    // Every demo entry references a real device in the single model.
    for (const entry of medien.entries) expect(byId[entry.id]).toBeDefined();
  });

  it('seeds at least one media and one camera device with v1.2 fields', () => {
    const mediaDevs = devices.filter((d) => d.type === 'media');
    const cameraDevs = devices.filter((d) => d.type === 'camera');
    expect(mediaDevs.length).toBeGreaterThanOrEqual(1);
    expect(cameraDevs.length).toBeGreaterThanOrEqual(1);

    const playing = mediaDevs.find((d) => d.type === 'media' && d.playState === 'playing');
    expect(playing).toBeDefined();
    if (playing?.type === 'media') {
      expect(typeof playing.title).toBe('string');
      expect(typeof playing.subtitle).toBe('string');
      expect(typeof playing.volume).toBe('number');
      expect(typeof playing.artUrl).toBe('string');
    }

    const onlineCam = cameraDevs.find((d) => d.type === 'camera' && d.online);
    expect(onlineCam).toBeDefined();
    if (onlineCam?.type === 'camera') {
      expect(typeof onlineCam.snapshotUrl).toBe('string');
    }
  });
});

describe('core/model — v1.4 climate + enriched sensor showcase', () => {
  it('seeds a ClimateDevice with setpoint/current/mode/unit + floor', () => {
    const c = byId['rtr-wohnen'];
    expect(c?.type).toBe('climate');
    if (c?.type !== 'climate') return;
    expect(c.setpoint).toBe(21.5);
    expect(c.current).toBe(20.8);
    expect(c.mode).toBe('heat');
    expect(c.unit).toBe('°C');
    expect(c.floor).toBe('Erdgeschoss');
  });

  it('groups the climate device in the separate climate showcase (not the overview/terminal floor)', () => {
    // climate has no skin renderer yet (follow-up), so it stays out of the mounted
    // overview floor but remains a first-class grouped model device.
    expect(rooms.flatMap((g) => g.entries.map((e) => e.id))).not.toContain('rtr-wohnen');
    expect(climateRooms.flatMap((g) => g.entries.map((e) => e.id))).toContain('rtr-wohnen');
    expect(Object.isFrozen(climateRooms)).toBe(true);
  });

  it('seeds a sensor with a series + min/max (Verlauf) and one with an accent icon', () => {
    const voc = byId['voc-wc'];
    expect(voc?.type).toBe('sensor');
    if (voc?.type !== 'sensor') return;
    expect(voc.series).toEqual([46, 120, 288, 250, 210]);
    expect(voc.min).toBe(46);
    expect(voc.max).toBe(288);
    expect(voc.floor).toBe('Erdgeschoss');

    const wetter = byId['wetter-aussen'];
    expect(wetter?.type).toBe('sensor');
    if (wetter?.type !== 'sensor') return;
    expect(wetter.icon).toBe('cloud');
  });

  it('rounds out the overview "Technik" room with sensor · scene · media · camera', () => {
    const technik = rooms.find((g) => g.room === 'Technik') as RoomGroup;
    expect(technik).toBeDefined();
    const types = technik.entries.map((e) => byId[e.id]?.type);
    expect(new Set(types)).toEqual(new Set(['sensor', 'scene', 'media', 'camera']));
  });
});

describe('core/model — span/row → role', () => {
  it('maps a plain entry to the device type default role', () => {
    const plain: LayoutEntry = { id: 'kueche-wand' };
    expect(layoutRole(plain, byId[plain.id]!)).toBe('default');
  });

  it('maps a wide span hint to the "wide" role', () => {
    const wide: LayoutEntry = { id: 'wiga-pendel', span: 2 };
    expect(layoutRole(wide, byId[wide.id]!)).toBe('wide');
  });

  it('keeps the jalousie default role even with span/row hints', () => {
    const jal: LayoutEntry = { id: 'wiga-jalousie', span: 2, row: 3 };
    expect(layoutRole(jal, byId[jal.id]!)).toBe('wide');
  });

  it('maps a plain climate entry to "default" and a span≥2 climate to "wide" (v1.4)', () => {
    // CONTRACT v1.4: climate roles.allow includes wide, default is "default".
    const climateDev = byId['rtr-wohnen']!;
    expect(layoutRole({ id: 'rtr-wohnen' }, climateDev)).toBe('default');
    expect(layoutRole({ id: 'rtr-wohnen', span: 2 }, climateDev)).toBe('wide');
  });

  it('does not promote a span≥2 switch/sensor to "wide" (not in their allowed roles)', () => {
    // switch + sensor allow only compact|default — a wide span must not override.
    const swDevice = { id: 's', type: 'switch', room: 'r', label: 'l', accent: 'teal', on: false } as Device;
    expect(layoutRole({ id: 's', span: 2 }, swDevice)).toBe('compact');
    const seDevice = {
      id: 'x', type: 'sensor', room: 'r', label: 'l', accent: 'blue', value: '1', unit: '°C',
    } as Device;
    expect(layoutRole({ id: 'x', span: 2 }, seDevice)).toBe('compact');
  });

  it('byId resolves to undefined for an unknown id (the type reflects this)', () => {
    expect(byId['no-such-device']).toBeUndefined();
  });
});

describe('core/model — shapes match the contract fixtures', () => {
  it('a light device matches the light fixture field set', () => {
    const fixtureLight = (fixtures as unknown as Record<string, Record<string, Device>>).light
      .dimmed;
    const modelLight = byId['kueche-pendel'];
    expect(modelLight?.type).toBe('light');
    // Same data fields as the contract fixture (plus the runtime id/type).
    for (const key of Object.keys(fixtureLight)) {
      expect(modelLight).toHaveProperty(key);
    }
  });

  it('a jalousie device matches the jalousie fixture field set', () => {
    const fixtureJal = (fixtures as unknown as Record<string, Record<string, Device>>).jalousie
      .tilted;
    const modelJal = byId['wiga-jalousie'];
    expect(modelJal?.type).toBe('jalousie');
    for (const key of Object.keys(fixtureJal)) {
      expect(modelJal).toHaveProperty(key);
    }
  });
});

describe('core/model — read-only to the outside (Goldene Regel 1)', () => {
  it('freezes the device list and byId index', () => {
    expect(Object.isFrozen(devices)).toBe(true);
    expect(Object.isFrozen(byId)).toBe(true);
    expect(Object.isFrozen(rooms)).toBe(true);
  });

  it('deep-freezes each device and its nested fields (no reference-mutation escape)', () => {
    for (const d of devices) expect(Object.isFrozen(d)).toBe(true);
    const jal = byId['wiga-jalousie'];
    expect(jal?.type).toBe('jalousie');
    if (jal?.type !== 'jalousie') return;
    expect(Object.isFrozen(jal.statuses)).toBe(true);
    // A nested status object is frozen too.
    expect(Object.isFrozen(jal.statuses[0])).toBe(true);
  });
});
