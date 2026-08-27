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
  ClimateDevice,
} from '@obs/visu-contract';
import { ctx, makeCtx, DEFAULT_ICONS } from './ctx';

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
  climate: { heat: ClimateDevice; off: ClimateDevice };
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

  it('climate → "Ist <value> <unit> · <Modus>" (B1: muted foot)', () => {
    // fixture heat: current 20.4 → de-DE "20,4"; unit "°C"; mode heat → "Heizen".
    // Value is glued to the unit by a NBSP; the mode trails after the " · ".
    expect(ctx.stateText(withType<ClimateDevice>(f.climate.heat, 'climate'))).toBe(
      `Ist 20,4${NBSP}°C · Heizen`,
    );
    expect(ctx.stateText(withType<ClimateDevice>(f.climate.off, 'climate'))).toBe(
      `Ist 19,2${NBSP}°C · Aus`,
    );
  });

  it('a type without a footer phrasing (media/camera) → empty string', () => {
    const media = { type: 'media', room: 'r', label: 'l', accent: 'blue' } as unknown as Device;
    expect(ctx.stateText(media)).toBe('');
  });
});

describe('ctx.stateParts — leading state word vs. rest (v1.4)', () => {
  // The single invariant: `word + rest === stateText(d)` for every device, so a
  // skin can render `<b>{word}</b>{rest}` without ever drifting from stateText.
  const light = (extra: Partial<LightDevice>): LightDevice =>
    ({ type: 'light', room: 'r', label: 'l', accent: 'orange', on: false, dim: null, ...extra });

  it('plain light/switch: the whole word, no rest', () => {
    expect(ctx.stateParts(withType<LightDevice>(f.light.off, 'light'))).toEqual({
      word: 'Aus',
      rest: '',
    });
    expect(ctx.stateParts(withType<LightDevice>(f.light.on, 'light'))).toEqual({
      word: 'Ein',
      rest: '',
    });
    expect(ctx.stateParts(withType<SwitchDevice>(f.switch.on, 'switch'))).toEqual({
      word: 'An',
      rest: '',
    });
  });

  it('dimmed light: word "Ein", rest " — 45 %"', () => {
    const parts = ctx.stateParts(withType<LightDevice>(f.light.dimmed, 'light'));
    expect(parts).toEqual({ word: 'Ein', rest: ` — 45${NBSP}%` });
    // consistency with stateText
    expect(parts.word + parts.rest).toBe(ctx.stateText(withType<LightDevice>(f.light.dimmed, 'light')));
  });

  it('dimmable-but-off light: whole word (dim set, on false)', () => {
    // covers the `d.on` = false arm of the dimmed guard.
    const dev = light({ dim: 0, on: false });
    expect(ctx.stateParts(dev)).toEqual({ word: 'Aus', rest: '' });
  });

  it('blind/jalousie: word "62 %", rest " · Teil"', () => {
    const blind = ctx.stateParts(withType<BlindDevice>(f.blind.half, 'blind'));
    expect(blind).toEqual({ word: `62${NBSP}%`, rest: ' · Teil' });
    expect(blind.word + blind.rest).toBe(ctx.stateText(withType<BlindDevice>(f.blind.half, 'blind')));
    const jal = ctx.stateParts(withType<JalousieDevice>(f.jalousie.tilted, 'jalousie'));
    expect(jal).toEqual({ word: `62${NBSP}%`, rest: ' · Teil' });
  });

  it('climate: fully muted foot — word = "", rest = whole text (B1)', () => {
    const parts = ctx.stateParts(withType<ClimateDevice>(f.climate.heat, 'climate'));
    expect(parts).toEqual({ word: '', rest: `Ist 20,4${NBSP}°C · Heizen` });
    expect(parts.word + parts.rest).toBe(
      ctx.stateText(withType<ClimateDevice>(f.climate.heat, 'climate')),
    );
  });

  it('sensor/scene: the whole text is the word', () => {
    expect(ctx.stateParts(withType<SensorDevice>(f.sensor.warn, 'sensor'))).toEqual({
      word: 'erhöht',
      rest: '',
    });
    expect(ctx.stateParts(withType<SceneDevice>(f.scene.film, 'scene'))).toEqual({
      word: 'Licht · Rollladen · TV',
      rest: '',
    });
  });
});

describe('ctx.stateParts — with an injected translator (CONTRACT v1.1/v1.4)', () => {
  const t = (key: string, params?: Record<string, unknown>): string =>
    params ? `[${key} ${JSON.stringify(params)}]` : `[${key}]`;
  const tctx = makeCtx(t);

  it('climate is fully muted (word = "") and keeps word+rest === stateText', () => {
    const dev = withType<ClimateDevice>(f.climate.heat, 'climate');
    const parts = tctx.stateParts(dev);
    expect(parts.word).toBe('');
    expect(parts.rest).toBe(tctx.stateText(dev));
    expect(parts.word + parts.rest).toBe(tctx.stateText(dev));
  });

  it('falls back to the whole word when the leading word is not a prefix (dimmed via i18n key)', () => {
    // The dimmed string is one opaque i18n key, so the "on" word is not its prefix:
    // stateParts keeps consistency by returning the whole text as the word.
    const dev = withType<LightDevice>(f.light.dimmed, 'light');
    const parts = tctx.stateParts(dev);
    expect(parts).toEqual({ word: tctx.stateText(dev), rest: '' });
  });

  it('blind with no " · " separator in the translated text → whole word', () => {
    const dev = withType<BlindDevice>(f.blind.half, 'blind');
    const parts = tctx.stateParts(dev);
    expect(parts).toEqual({ word: tctx.stateText(dev), rest: '' });
  });
});

describe('ctx i18n — makeCtx with an injected translator (CONTRACT v1.1)', () => {
  // A spy translator that echoes the key + interpolates {x} placeholders, so we
  // can assert which i18n keys/params stateText resolves through ctx.t.
  const calls: Array<{ key: string; params?: Record<string, unknown> }> = [];
  const t = (key: string, params?: Record<string, unknown>): string => {
    calls.push({ key, params });
    if (!params) return `[${key}]`;
    return `[${key} ${JSON.stringify(params)}]`;
  };
  const tctx = makeCtx(t);

  it('exposes the injected t on the ctx surface', () => {
    expect(tctx.t).toBe(t);
  });

  it('light off/on resolve widgets.state.off / .on keys', () => {
    expect(tctx.stateText(withType<LightDevice>(f.light.off, 'light'))).toBe('[widgets.state.off]');
    expect(tctx.stateText(withType<LightDevice>(f.light.on, 'light'))).toBe('[widgets.state.on]');
  });

  it('light dimmed resolves widgets.state.dimmed with the dim param', () => {
    expect(tctx.stateText(withType<LightDevice>(f.light.dimmed, 'light'))).toBe(
      '[widgets.state.dimmed {"dim":45}]',
    );
  });

  it('switch on resolves widgets.state.switchOn, off resolves .off', () => {
    expect(tctx.stateText(withType<SwitchDevice>(f.switch.on, 'switch'))).toBe(
      '[widgets.state.switchOn]',
    );
    expect(tctx.stateText(withType<SwitchDevice>(f.switch.off, 'switch'))).toBe(
      '[widgets.state.off]',
    );
  });

  it('blind position resolves widgets.state.position with position + translated word', () => {
    expect(tctx.stateText(withType<BlindDevice>(f.blind.half, 'blind'))).toBe(
      '[widgets.state.position {"position":62,"word":"[widgets.state.partial]"}]',
    );
    expect(tctx.stateText(withType<BlindDevice>(f.blind.open, 'blind'))).toBe(
      '[widgets.state.position {"position":0,"word":"[widgets.state.open]"}]',
    );
    expect(tctx.stateText(withType<BlindDevice>(f.blind.locked, 'blind'))).toBe(
      '[widgets.state.position {"position":100,"word":"[widgets.state.closed]"}]',
    );
  });

  it('climate resolves widgets.climate.currentLabel + mode key, unit from device data', () => {
    // "Ist" comes from the i18n key; "°C" is device data (`d.unit`).
    expect(tctx.stateText(withType<ClimateDevice>(f.climate.heat, 'climate'))).toBe(
      `[widgets.climate.currentLabel] 20,4${NBSP}°C · [widgets.climate.mode.heat]`,
    );
  });
});

describe('ctx i18n — makeCtx() without a translator keeps the German literals', () => {
  it('produces the same output as the default ctx export', () => {
    const plain = makeCtx();
    expect(plain.t).toBeUndefined();
    expect(plain.stateText(withType<LightDevice>(f.light.dimmed, 'light'))).toBe(
      `Ein — 45${NBSP}%`,
    );
    expect(plain.stateText(withType<SwitchDevice>(f.switch.on, 'switch'))).toBe('An');
    expect(plain.stateText(withType<BlindDevice>(f.blind.half, 'blind'))).toBe(
      `62${NBSP}% · Teil`,
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
