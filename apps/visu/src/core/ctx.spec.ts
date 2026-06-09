import { describe, it, expect } from 'vitest';
import { fixtures } from '@obs/visu-contract';
import type {
  Device,
  LightDevice,
  SwitchDevice,
  BlindDevice,
  JalousieDevice,
  SensorDevice,
  SceneDevice,
} from '@obs/visu-contract';
import { ctx, DEFAULT_ICONS } from './ctx';

/**
 * core/ctx (CONTRACT-v1.md §5) — the shared helpers a renderer receives.
 *
 * Sources of truth:
 *  - de-DE number format + softHyphenate: reference/vue-ionic/store.js (nf, softHyphenate)
 *  - footer state text: reference/vue-ionic/widgets.js (vz-tile-foot block)
 *  - default icon set: reference/vue-ionic/store.js → ICONS
 *
 * Golden rules: ctx exposes ONLY these helpers (sandbox boundary, rule 4);
 * it owns no state and executes no device action (rule 1).
 */

const NBSP = ' ';
const SHY = '­';

// Typed fixture handles (fixtures.json carries the same shapes as store.js).
const f = fixtures as unknown as {
  light: { off: LightDevice; on: LightDevice; dimmed: LightDevice };
  switch: { off: SwitchDevice; on: SwitchDevice };
  blind: { open: BlindDevice; half: BlindDevice; locked: BlindDevice };
  jalousie: { open: JalousieDevice; tilted: JalousieDevice; locked: JalousieDevice };
  sensor: { ok: SensorDevice; warn: SensorDevice };
  scene: { film: SceneDevice; morgen: SceneDevice };
};

// fixtures omit `type`; restore the discriminant for the typed helpers.
const withType = <T extends Device>(d: Omit<T, 'type'>, type: T['type']): T =>
  ({ ...d, type }) as unknown as T;

describe('ctx.nf — de-DE number formatting', () => {
  it('formats integers with no decimals and a thousands point', () => {
    expect(ctx.nf(1240)).toBe('1.240');
  });

  it('defaults non-integers to one decimal with a decimal comma', () => {
    expect(ctx.nf(20.8)).toBe('20,8');
  });

  it('honours an explicit decimal count', () => {
    expect(ctx.nf(21.5, 1)).toBe('21,5');
    expect(ctx.nf(1240, 2)).toBe('1.240,00');
  });

  it('parses comma-decimal strings before formatting', () => {
    expect(ctx.nf('20,4', 1)).toBe('20,4');
  });

  it('returns an en dash for null / undefined / NaN', () => {
    expect(ctx.nf(null as unknown as number)).toBe('–');
    expect(ctx.nf(undefined as unknown as number)).toBe('–');
    expect(ctx.nf('abc')).toBe('–');
  });
});

describe('ctx.hyphenate — German soft hyphenation', () => {
  it('inserts a soft hyphen before a known compound segment', () => {
    expect(ctx.hyphenate('Pendelleuchten')).toBe(`Pendel${SHY}leuchten`);
  });

  it('leaves short words untouched', () => {
    expect(ctx.hyphenate('Bad')).toBe('Bad');
  });

  it('returns the input unchanged when it is not a non-empty string', () => {
    expect(ctx.hyphenate('')).toBe('');
  });

  it('does not double-insert a soft hyphen', () => {
    const once = ctx.hyphenate('Wandleuchten');
    expect(ctx.hyphenate(once)).toBe(once);
  });
});

describe('ctx.stateText — centralised footer text (§5)', () => {
  it('light off → "Aus"', () => {
    expect(ctx.stateText(withType<LightDevice>(f.light.off, 'light'))).toBe('Aus');
  });

  it('light on, not dimmable → "Ein"', () => {
    expect(ctx.stateText(withType<LightDevice>(f.light.on, 'light'))).toBe('Ein');
  });

  it('light dimmed → "Ein — 45 %"', () => {
    expect(ctx.stateText(withType<LightDevice>(f.light.dimmed, 'light'))).toBe(
      `Ein — 45${NBSP}%`,
    );
  });

  it('switch on/off → "An" / "Aus"', () => {
    expect(ctx.stateText(withType<SwitchDevice>(f.switch.on, 'switch'))).toBe('An');
    expect(ctx.stateText(withType<SwitchDevice>(f.switch.off, 'switch'))).toBe('Aus');
  });

  it('blind 62 → "62 % · Teil"', () => {
    expect(ctx.stateText(withType<BlindDevice>(f.blind.half, 'blind'))).toBe(
      `62${NBSP}% · Teil`,
    );
  });

  it('blind 0 → "0 % · Offen", 100 → "100 % · Zu"', () => {
    expect(ctx.stateText(withType<BlindDevice>(f.blind.open, 'blind'))).toBe(
      `0${NBSP}% · Offen`,
    );
    expect(ctx.stateText(withType<BlindDevice>(f.blind.locked, 'blind'))).toBe(
      `100${NBSP}% · Zu`,
    );
  });

  it('jalousie reuses the blind state text', () => {
    expect(ctx.stateText(withType<JalousieDevice>(f.jalousie.tilted, 'jalousie'))).toBe(
      `62${NBSP}% · Teil`,
    );
  });

  it('sensor → its status text, empty when none', () => {
    expect(ctx.stateText(withType<SensorDevice>(f.sensor.warn, 'sensor'))).toBe('erhöht');
  });

  it('scene → its subtitle, empty when none', () => {
    expect(ctx.stateText(withType<SceneDevice>(f.scene.film, 'scene'))).toBe(
      'Licht · Rollladen · TV',
    );
  });
});

describe('ctx.warn — sensor outside comfort', () => {
  it('true when a sensor status is not "komfort"', () => {
    expect(ctx.warn(withType<SensorDevice>(f.sensor.warn, 'sensor'))).toBe(true);
  });

  it('false for a comfortable sensor', () => {
    expect(ctx.warn(withType<SensorDevice>(f.sensor.ok, 'sensor'))).toBe(false);
  });

  it('false for non-sensor devices', () => {
    expect(ctx.warn(withType<LightDevice>(f.light.on, 'light'))).toBe(false);
  });
});

describe('ctx.icon — skin set → default fallback', () => {
  it('falls back to the default icon set when no skin icon is wired', () => {
    const d = withType<LightDevice>(f.light.on, 'light');
    expect(ctx.icon(d, 'bulb')).toBe(DEFAULT_ICONS.bulb);
  });

  it('returns empty string for an unknown slot', () => {
    const d = withType<LightDevice>(f.light.on, 'light');
    expect(ctx.icon(d, 'does-not-exist')).toBe('');
  });
});
