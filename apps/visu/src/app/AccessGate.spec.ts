import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import de from '../locales/de.json';
import en from '../locales/en.json';

/**
 * app/AccessGate – the dezenter Zugriffs-Hinweis for gated pages (Welle 3b).
 *
 * Pins the acceptance criteria: a guest on public/readonly pages sees NOTHING
 * (reading is never gated); a PIN-protected page shows a PIN prompt whose submit
 * forwards to the store's `authenticatePage()`, re-fetches and drops the gate; a
 * wrong PIN shows an INLINE "PIN falsch" without a crash and keeps the gate; a
 * user-level page shows a quiet "Anmeldung erforderlich" hint with no PIN field.
 *
 * Ionic web components are not jsdom-friendly, so they are stubbed to plain
 * elements; IonInput carries a working v-model so the PIN field can be filled.
 */
vi.mock('@ionic/vue', () => {
  const passthrough = (tag: string) =>
    defineComponent({
      name: tag,
      setup(_props, { slots }) {
        return () => h(tag, {}, slots.default ? slots.default() : []);
      },
    });
  return {
    IonItem: passthrough('ion-item'),
    IonLabel: passthrough('ion-label'),
    IonNote: passthrough('ion-note'),
    IonButton: defineComponent({
      name: 'ion-button',
      props: { type: { type: String, default: 'button' }, disabled: { type: Boolean, default: false } },
      setup(props, { slots }) {
        return () => h('button', { type: props.type, disabled: props.disabled }, slots.default ? slots.default() : []);
      },
    }),
    IonInput: defineComponent({
      name: 'ion-input',
      props: { modelValue: { type: String, default: '' }, type: { type: String, default: 'text' } },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        return () =>
          h('input', {
            type: props.type,
            value: props.modelValue,
            onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
          });
      },
    }),
  };
});

import AccessGate from './AccessGate.vue';
import { useDeviceStore } from '../core/store';
import type { DataSource, PageGate } from '../core/datasource';
import type { Device } from '@obs/visu-contract';

/** A page-auth-capable fake: records PIN attempts and drops a gate on the right PIN. */
class FakePageSource implements DataSource {
  readonly pinCalls: Array<{ pageId: string; pin: string }> = [];
  listCalls = 0;
  private gated: PageGate[];

  constructor(
    gated: PageGate[] = [],
    private readonly opts: { deferPin?: boolean } = {},
  ) {
    this.gated = [...gated];
  }
  list(): Promise<Device[]> {
    this.listCalls++;
    return Promise.resolve([]);
  }
  subscribe(): () => void {
    return () => {};
  }
  dispatch(): Promise<void> {
    return Promise.resolve();
  }
  authenticatePage(pageId: string, pin: string): Promise<unknown> {
    this.pinCalls.push({ pageId, pin });
    if (this.opts.deferPin) return new Promise<unknown>(() => {}); // never settles
    if (pin !== '1234') return Promise.reject(new Error('obs: wrong PIN'));
    this.gated = this.gated.filter((g) => g.pageId !== pageId);
    return Promise.resolve({ sessionToken: 'sess', expiresIn: 3600 });
  }
  pageGates(): readonly PageGate[] {
    return this.gated;
  }
}

function i18n() {
  return createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de, en } });
}

function mountGate() {
  return mount(AccessGate, { global: { plugins: [i18n()] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('AccessGate – reading is never gated', () => {
  it('renders nothing for a guest/mock source (no gated pages)', async () => {
    const store = useDeviceStore();
    await store.init(new FakePageSource([]));
    const w = mountGate();
    expect(w.find('.access-gate').exists()).toBe(false);
    expect(w.find('.access-gate-pin').exists()).toBe(false);
    expect(w.find('.access-gate-login').exists()).toBe(false);
  });
});

describe('AccessGate – protected page → PIN prompt', () => {
  it('shows the PIN hint + field for a protected page', async () => {
    const store = useDeviceStore();
    await store.init(new FakePageSource([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]));
    const w = mountGate();
    expect(w.find('.access-gate-pin').exists()).toBe(true);
    expect(w.find('.access-gate-hint').text()).toBe('PIN erforderlich für Wintergarten');
    expect(w.find('.access-gate-input').exists()).toBe(true);
  });

  it('submit forwards the PIN to authenticatePage, re-fetches and drops the gate', async () => {
    const store = useDeviceStore();
    const src = new FakePageSource([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]);
    await store.init(src);
    const listAfterInit = src.listCalls;

    const w = mountGate();
    await w.find('.access-gate-input').setValue('1234');
    await w.find('.access-gate-pin').trigger('submit');
    await flushPromises();

    // authenticatePage got the entered PIN …
    expect(src.pinCalls).toEqual([{ pageId: 'p2', pin: '1234' }]);
    // … a data refresh ran (init → list() again) …
    expect(src.listCalls).toBe(listAfterInit + 1);
    // … and the now-unlocked page dropped off, so the prompt is gone.
    expect(store.pageGates).toEqual([]);
    expect(w.find('.access-gate-pin').exists()).toBe(false);
  });

  it('submits an empty PIN (no entry) as "" without crashing', async () => {
    const store = useDeviceStore();
    const src = new FakePageSource([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]);
    await store.init(src);

    const w = mountGate();
    // Submit without ever setting the field → the empty-default branch.
    await w.find('.access-gate-pin').trigger('submit');
    await flushPromises();

    expect(src.pinCalls).toEqual([{ pageId: 'p2', pin: '' }]);
    // Empty PIN is a wrong PIN here → inline note, gate stays.
    expect(w.find('.access-gate-error').text()).toBe(de.access.pinWrong);
    expect(store.pageGates.map((g) => g.pageId)).toEqual(['p2']);
  });

  it('ignores a second submit while the first PIN attempt is still in flight', async () => {
    const store = useDeviceStore();
    const src = new FakePageSource([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }], { deferPin: true });
    await store.init(src);

    const w = mountGate();
    await w.find('.access-gate-input').setValue('1234');
    // Fire twice before the (never-settling) first attempt resolves.
    await w.find('.access-gate-pin').trigger('submit');
    await w.find('.access-gate-pin').trigger('submit');
    await flushPromises();

    expect(src.pinCalls).toHaveLength(1);
  });

  it('a wrong PIN shows an inline note, keeps the gate and does not crash', async () => {
    const store = useDeviceStore();
    const src = new FakePageSource([{ pageId: 'p2', name: 'Wintergarten', access: 'protected' }]);
    await store.init(src);
    const listAfterInit = src.listCalls;

    const w = mountGate();
    await w.find('.access-gate-input').setValue('0000');
    await w.find('.access-gate-pin').trigger('submit');
    await flushPromises();

    expect(src.pinCalls).toEqual([{ pageId: 'p2', pin: '0000' }]);
    // Inline failure, gate preserved, no refetch, prompt still there.
    expect(w.find('.access-gate-error').text()).toBe(de.access.pinWrong);
    expect(store.pageGates.map((g) => g.pageId)).toEqual(['p2']);
    expect(src.listCalls).toBe(listAfterInit);
    expect(w.find('.access-gate-pin').exists()).toBe(true);
  });
});

describe('AccessGate – user page → login-required hint', () => {
  it('shows a quiet "Anmeldung erforderlich" hint with no PIN field', async () => {
    const store = useDeviceStore();
    await store.init(new FakePageSource([{ pageId: 'pu', name: 'Zentrale', access: 'user' }]));
    const w = mountGate();
    expect(w.find('.access-gate-login').text()).toBe('Anmeldung erforderlich für Zentrale');
    // No PIN prompt for a user-level page (login lives in LoginPanel).
    expect(w.find('.access-gate-pin').exists()).toBe(false);
    expect(w.find('.access-gate-input').exists()).toBe(false);
  });
});

describe('AccessGate – a link stopped by the PIN gate becomes visible (#1194)', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('scrolls the pending gate into view and focuses its PIN field', async () => {
    const store = useDeviceStore();
    await store.init(
      new FakePageSource([
        { pageId: 'p1', name: 'Flur', access: 'protected' },
        { pageId: 'p2', name: 'Technik', access: 'protected' },
      ]),
    );
    // attachTo so focus() actually lands (jsdom only focuses connected nodes).
    const wrapper = mount(AccessGate, {
      global: { plugins: [i18n()] },
      attachTo: document.body,
    });

    await flushPromises();

    // jsdom implements no scrollIntoView — install a recorder in its place.
    const scrolled: string[] = [];
    for (const form of Array.from(document.querySelectorAll<HTMLElement>('.access-gate-pin'))) {
      form.scrollIntoView = () => scrolled.push(form.dataset.page ?? '');
    }

    // The host reports the gate the link ran into.
    store.pendingGate = 'p2';
    await flushPromises();

    // It is brought into view …
    expect(scrolled).toEqual(['p2']);
    // … marked …
    const form = wrapper.find('.access-gate-pin[data-page="p2"]');
    expect(form.attributes('data-pending')).toBe('true');
    expect(form.classes()).toContain('is-pending');
    // … and the cursor sits in its PIN field, so the click is never a silent no-op.
    expect(document.activeElement).toBe(form.find('input').element);
    // The other gate is untouched.
    expect(wrapper.find('.access-gate-pin[data-page="p1"]').attributes('data-pending')).toBeUndefined();

    wrapper.unmount();
  });

  it('does nothing when no gate is pending', async () => {
    const store = useDeviceStore();
    await store.init(new FakePageSource([{ pageId: 'p1', name: 'Flur', access: 'protected' }]));
    const wrapper = mountGate();
    await flushPromises();
    expect(wrapper.find('.access-gate-pin[data-page="p1"]').attributes('data-pending')).toBeUndefined();
  });
});
