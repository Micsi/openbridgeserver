import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import de from '../locales/de.json';
import en from '../locales/en.json';

/**
 * app/LoginPanel — the guest-by-default opt-in login for the shell menu (Welle L).
 *
 * Pins the acceptance criteria: guest is the default (the app renders with a
 * login entry, never a wall); submit forwards to the store's `login()`, and a
 * success shows the indicator AND re-fetches (store.init → source.list again);
 * a failed login shows an INLINE note without a crash and keeps the guest state;
 * logout calls `logout()` and re-fetches back to guest.
 *
 * Ionic web components are not jsdom-friendly, so they are stubbed to plain
 * elements; IonInput carries a working v-model so the form can be filled.
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
      props: { type: { type: String, default: 'button' } },
      setup(props, { slots }) {
        return () => h('button', { type: props.type }, slots.default ? slots.default() : []);
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

import LoginPanel from './LoginPanel.vue';
import { useDeviceStore } from '../core/store';
import type { AuthCapableDataSource } from '../core/datasource';
import type { Device } from '@obs/visu-contract';

/** A fake auth-capable source that records login/logout/list so the wiring shows. */
class FakeAuthSource implements AuthCapableDataSource {
  readonly loginCalls: Array<{ user: string; pass: string }> = [];
  listCalls = 0;
  logoutCalls = 0;
  subscribeCalls = 0;
  private authed = false;

  constructor(private readonly opts: { failLogin?: boolean; startAuthed?: boolean; deferLogin?: boolean } = {}) {
    this.authed = !!opts.startAuthed;
  }

  list(): Promise<Device[]> {
    this.listCalls++;
    return Promise.resolve([]);
  }
  subscribe(): () => void {
    this.subscribeCalls++;
    return () => {};
  }
  dispatch(): Promise<void> {
    return Promise.resolve();
  }
  login(user: string, pass: string): Promise<void> {
    this.loginCalls.push({ user, pass });
    if (this.opts.failLogin) return Promise.reject(new Error('bad credentials'));
    if (this.opts.deferLogin) return new Promise<void>(() => {}); // never settles
    this.authed = true;
    return Promise.resolve();
  }
  logout(): void {
    this.logoutCalls++;
    this.authed = false;
  }
  isAuthenticated(): boolean {
    return this.authed;
  }
}

function i18n() {
  return createI18n({ legacy: false, locale: 'de', fallbackLocale: 'de', messages: { de, en } });
}

function mountPanel() {
  return mount(LoginPanel, { global: { plugins: [i18n()] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('LoginPanel — guest is the default', () => {
  it('renders the login entry and no form, without any login', () => {
    const w = mountPanel();
    expect(w.find('.login-open').text()).toBe(de.auth.login);
    expect(w.find('.login-form').exists()).toBe(false);
    expect(w.find('.login-indicator').exists()).toBe(false);
  });

  it('reveals the credential form when the entry is tapped', async () => {
    const w = mountPanel();
    await w.find('.login-open').trigger('click');
    expect(w.find('.login-form').exists()).toBe(true);
    expect(w.find('.login-username').exists()).toBe(true);
    expect(w.find('.login-password').exists()).toBe(true);
  });

  it('shows a generic indicator for a restored session without a remembered name', async () => {
    const store = useDeviceStore();
    await store.init(new FakeAuthSource({ startAuthed: true }));
    const w = mountPanel();
    expect(store.authenticated).toBe(true);
    expect(store.username).toBeNull();
    expect(w.find('.login-indicator').text()).toBe(de.auth.signedIn);
  });
});

describe('LoginPanel — submit → login() + refresh', () => {
  it('forwards credentials to store.login and, on success, shows the indicator and re-fetches', async () => {
    const store = useDeviceStore();
    const src = new FakeAuthSource();
    await store.init(src);
    const listAfterInit = src.listCalls;

    const w = mountPanel();
    await w.find('.login-open').trigger('click');
    await w.find('.login-username').setValue('alice');
    await w.find('.login-password').setValue('s3cret');
    await w.find('.login-form').trigger('submit');
    await flushPromises();

    // login() was called with the entered credentials …
    expect(src.loginCalls).toEqual([{ user: 'alice', pass: 's3cret' }]);
    // … the store reflects the session …
    expect(store.authenticated).toBe(true);
    // … the form closed and the indicator names the user …
    expect(w.find('.login-form').exists()).toBe(false);
    expect(w.find('.login-indicator').text()).toBe('Angemeldet als alice');
    // … and a data refresh ran (init → source.list() again + re-subscribe).
    expect(src.listCalls).toBe(listAfterInit + 1);
    expect(src.subscribeCalls).toBeGreaterThan(1);
  });

  it('ignores a second submit while the first login is still in flight', async () => {
    const store = useDeviceStore();
    const src = new FakeAuthSource({ deferLogin: true });
    await store.init(src);

    const w = mountPanel();
    await w.find('.login-open').trigger('click');
    await w.find('.login-username').setValue('alice');
    await w.find('.login-password').setValue('s3cret');
    // Fire twice before the (never-settling) first login resolves.
    await w.find('.login-form').trigger('submit');
    await w.find('.login-form').trigger('submit');
    await flushPromises();

    expect(src.loginCalls).toHaveLength(1);
  });

  it('shows an inline failure and keeps guest when login rejects (no crash)', async () => {
    const store = useDeviceStore();
    const src = new FakeAuthSource({ failLogin: true });
    await store.init(src);
    const listAfterInit = src.listCalls;

    const w = mountPanel();
    await w.find('.login-open').trigger('click');
    await w.find('.login-username').setValue('mallory');
    await w.find('.login-password').setValue('nope');
    await w.find('.login-form').trigger('submit');
    await flushPromises();

    expect(src.loginCalls).toHaveLength(1);
    // Inline note shown, guest preserved, form still open, no refetch happened.
    expect(w.find('.login-error').text()).toBe(de.auth.failed);
    expect(store.authenticated).toBe(false);
    expect(w.find('.login-open').exists()).toBe(true);
    expect(src.listCalls).toBe(listAfterInit);
  });
});

describe('LoginPanel — logout → back to guest + refresh', () => {
  it('calls store.logout and re-fetches, returning to the guest entry', async () => {
    const store = useDeviceStore();
    const src = new FakeAuthSource();
    await store.init(src);

    const w = mountPanel();
    await w.find('.login-open').trigger('click');
    await w.find('.login-username').setValue('alice');
    await w.find('.login-password').setValue('s3cret');
    await w.find('.login-form').trigger('submit');
    await flushPromises();
    const listBeforeLogout = src.listCalls;

    await w.find('.login-logout').trigger('click');
    await flushPromises();

    expect(src.logoutCalls).toBe(1);
    expect(store.authenticated).toBe(false);
    expect(w.find('.login-open').exists()).toBe(true);
    expect(src.listCalls).toBe(listBeforeLogout + 1);
  });
});
