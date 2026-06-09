import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

// Mock the host skin registry so a test can hand the panel a synthetic manifest
// (e.g. an unsupported tweak type). By default it delegates to the real module,
// so the ionic-manifest tests run against the genuine schema.
const { realResolveSkin } = vi.hoisted(() => ({ realResolveSkin: { fn: undefined as unknown } }));

vi.mock('../skin-host/skins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../skin-host/skins')>();
  realResolveSkin.fn = actual.resolveSkin;
  return { ...actual, resolveSkin: vi.fn(actual.resolveSkin) };
});

import TweaksPanel from './TweaksPanel.vue';
import { resolveSkin } from '../skin-host/skins';

const resolveSkinMock = vi.mocked(resolveSkin);

/** Override `resolveSkin` with a synthetic skin shape for a single test. */
function setResolved(skin: unknown): void {
  resolveSkinMock.mockReturnValue(skin as never);
}

afterEach(() => {
  // Restore the genuine registry lookup for the manifest-driven tests.
  resolveSkinMock.mockImplementation(realResolveSkin.fn as typeof resolveSkin);
});

/**
 * app/TweaksPanel — generic, manifest-driven tweak editor (A6, Issue #102).
 *
 * The panel renders the active page-skin's `manifest.tweaks` schema with no
 * per-skin special-casing (Goldene Regel 7: Daten=JSON, Verhalten=Code) and
 * owns no state (Goldene Regel 4) — it is a controlled `v-model` component that
 * emits a fresh values object on every edit. These tests pin: the ionic schema
 * renders without a special case, defaults fill missing values, edits emit, an
 * unknown tweak type fails loudly (never a silent control), and chrome/tweak
 * strings come from vue-i18n with a readable fallback.
 */

/** Props the panel accepts (skin key + optional per-page values). */
interface PanelProps {
  skin: string;
  modelValue?: Record<string, string | number>;
}

/** A minimal i18n plugin; tweak/chrome keys are intentionally absent (fallback path). */
function i18n(messages: Record<string, unknown> = {}) {
  return createI18n({
    legacy: false,
    locale: 'de',
    fallbackLocale: 'de',
    messages: { de: messages as Record<string, never> },
  });
}

function mountPanel(props: PanelProps, messages?: Record<string, unknown>) {
  return mount(TweaksPanel, {
    props,
    global: { plugins: [i18n(messages)] },
  });
}

describe('TweaksPanel — renders the ionic manifest schema generically', () => {
  it('renders one row per manifest tweak, addressed by key (no ionic special-case)', () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    const tweakKeys = Object.keys(resolveSkin('ionic').manifest.tweaks ?? {});
    expect(tweakKeys.length).toBeGreaterThan(0);

    const rows = wrapper.findAll('.tweaks-panel__row');
    expect(rows.length).toBe(tweakKeys.length);
    for (const key of tweakKeys) {
      expect(wrapper.find(`[data-tweak="${key}"]`).exists()).toBe(true);
    }
  });

  it('renders a select tweak as segmented buttons over its options', () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    // `stil` is a select with options glass/ios/md in the ionic manifest.
    const row = wrapper.find('[data-tweak="stil"]');
    const buttons = row.findAll('.tweaks-panel__seg-btn');
    expect(buttons.map((b) => b.text())).toEqual(['glass', 'ios', 'md']);
  });

  it('renders a slider tweak as a range input over min/max/step', () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    // `glassBlur` is a slider 0..40 step 1 in the ionic manifest.
    const input = wrapper.find('[data-tweak="glassBlur"] input.tweaks-panel__slider');
    expect(input.attributes('type')).toBe('range');
    expect(input.attributes('min')).toBe('0');
    expect(input.attributes('max')).toBe('40');
    expect(input.attributes('step')).toBe('1');
  });
});

describe('TweaksPanel — defaults + controlled values (skin owns no state)', () => {
  it('shows the schema default when a tweak has no provided value', () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    // default stil = glass → that button is pressed.
    const glass = wrapper
      .find('[data-tweak="stil"]')
      .findAll('.tweaks-panel__seg-btn')
      .find((b) => b.text() === 'glass');
    expect(glass?.attributes('aria-pressed')).toBe('true');
    // default glassBlur = 22 → slider reflects it.
    const slider = wrapper.find('[data-tweak="glassBlur"] input');
    expect((slider.element as HTMLInputElement).value).toBe('22');
  });

  it('reflects a provided per-page value over the default', () => {
    const wrapper = mountPanel({ skin: 'ionic', modelValue: { stil: 'md', glassBlur: 10 } });
    const md = wrapper
      .find('[data-tweak="stil"]')
      .findAll('.tweaks-panel__seg-btn')
      .find((b) => b.text() === 'md');
    expect(md?.attributes('aria-pressed')).toBe('true');
    expect((wrapper.find('[data-tweak="glassBlur"] input').element as HTMLInputElement).value).toBe('10');
  });

  it('emits a fresh values object on a select edit, default-filled for untouched keys', async () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    const ios = wrapper
      .find('[data-tweak="stil"]')
      .findAll('.tweaks-panel__seg-btn')
      .find((b) => b.text() === 'ios');
    await ios?.trigger('click');

    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeTruthy();
    const payload = emitted?.[0]?.[0] as Record<string, unknown>;
    expect(payload.stil).toBe('ios');
    // untouched keys carry their defaults (the panel emits the merged set).
    expect(payload.accentStyle).toBe('glow');
    expect(payload.glassBlur).toBe(22);
  });

  it('emits a numeric value on a slider edit', async () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    const slider = wrapper.find('[data-tweak="glassBlur"] input');
    (slider.element as HTMLInputElement).value = '30';
    await slider.trigger('input');

    const payload = wrapper.emitted('update:modelValue')?.[0]?.[0] as Record<string, unknown>;
    expect(payload.glassBlur).toBe(30);
    expect(typeof payload.glassBlur).toBe('number');
  });

  it('does not mutate the passed-in modelValue (controlled, immutable)', async () => {
    const model = Object.freeze({ stil: 'glass' });
    const wrapper = mountPanel({ skin: 'ionic', modelValue: model });
    const ios = wrapper
      .find('[data-tweak="stil"]')
      .findAll('.tweaks-panel__seg-btn')
      .find((b) => b.text() === 'ios');
    // would throw if the component tried to write into the frozen object.
    await expect(ios?.trigger('click')).resolves.not.toThrow();
    expect(model).toEqual({ stil: 'glass' });
  });
});

describe('TweaksPanel — i18n strings with readable fallback', () => {
  it('uses vue-i18n labels when present', () => {
    const wrapper = mountPanel(
      { skin: 'ionic' },
      {
        tweaks: {
          title: 'Feineinstellungen',
          stil: { label: 'Kachel-Optik', options: { glass: 'Glas' } },
        },
      },
    );
    expect(wrapper.find('.tweaks-panel__title').text()).toBe('Feineinstellungen');
    expect(wrapper.find('[data-tweak="stil"] .tweaks-panel__label-text').text()).toBe('Kachel-Optik');
    const glass = wrapper
      .find('[data-tweak="stil"]')
      .findAll('.tweaks-panel__seg-btn')
      .find((b) => b.attributes('aria-pressed') === 'true');
    expect(glass?.text()).toBe('Glas');
  });

  it('falls back to the raw key/value when no translation exists', () => {
    const wrapper = mountPanel({ skin: 'ionic' });
    // no `tweaks.*` messages provided → labels degrade to the raw key.
    expect(wrapper.find('[data-tweak="stil"] .tweaks-panel__label-text').text()).toBe('stil');
    expect(wrapper.find('.tweaks-panel__title').text()).toBe('Tweaks');
  });
});

describe('TweaksPanel — gaps & guards (never a silent control)', () => {
  it('throws a visible error for an unknown skin key (no silent fallback)', () => {
    expect(() => mountPanel({ skin: 'no-such-skin' })).toThrow(/unknown skin/);
  });

  it('throws on an unsupported tweak type rather than dropping the control', () => {
    // A skin whose manifest carries a tweak type the panel does not render.
    setResolved({
      tiles: {},
      details: {},
      manifest: {
        name: 'bogus',
        targetsContract: '1.1',
        unsupported: [],
        widgets: {},
        layout: { model: 'grid' },
        tweaks: { weird: { type: 'color', default: '#fff' } },
      },
    });
    expect(() => mountPanel({ skin: 'bogus' })).toThrow(/unsupported tweak type "color"/);
  });

  it('shows an empty hint for a skin that declares no tweaks', () => {
    setResolved({
      tiles: {},
      details: {},
      manifest: {
        name: 'plain',
        targetsContract: '1.1',
        unsupported: [],
        widgets: {},
        layout: { model: 'grid' },
      },
    });
    const wrapper = mountPanel({ skin: 'plain' });
    expect(wrapper.find('.tweaks-panel__row').exists()).toBe(false);
    expect(wrapper.find('.tweaks-panel__empty').exists()).toBe(true);
  });
});
