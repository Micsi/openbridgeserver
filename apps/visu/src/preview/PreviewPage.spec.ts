import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import { h, type VNode } from 'vue';
import type { PageHost } from '@obs/visu-contract';

/**
 * preview/PreviewPage - die ganze Bruecke an einem Stueck (C4, Issue #171).
 *
 * Die Modul-Specs pinnen die Regeln einzeln; diese hier laesst den kompletten
 * Weg laufen, weil genau der die Zusage von Teil C4 ist:
 *
 *   postMessage -> Handshake -> Entwurf -> Store -> SkinHost -> gerendertes DOM
 *
 * und prueft dabei die drei Dinge, die niemand sonst prueft: dass ein Entwurf
 * OHNE Speichern auf dem Bildschirm landet, dass eine fremde Herkunft nichts
 * bewirkt, und dass die Admin-Session dabei nirgends auftaucht.
 */

let captured: PageHost | null = null;
vi.mock('../skin-host/skins', () => ({
  resolveSkin: (key: string) => {
    if (key !== 'edomi-stub') throw new Error(`skin-host: unknown skin "${key}"`);
    return {
      tiles: { light: () => h('div', { class: 'stub-tile' }) },
      details: {},
      rootClass: 'stub-root',
      manifest: {
        name: 'edomi-stub',
        unsupported: [],
        layout: { model: 'grid', honors: ['position', 'layers', 'nav'] },
      },
      page: (host: PageHost) => {
        captured = host;
        const layers = host.layersFor(host.currentPageId ?? '');
        return h(
          'div',
          { class: 'skin-page-owned' },
          layers.flatMap((l) => l.items.map((it) => host.renderTile(it.id) as VNode)),
        );
      },
    };
  },
}));

import { createI18n } from 'vue-i18n';

import PreviewPage from './PreviewPage.vue';
import deMessages from '../locales/de.json';
import { PREVIEW_CHANNEL, PREVIEW_MESSAGE, PREVIEW_PROTOCOL_VERSION } from './protocol';

const ADMIN_ORIGIN = window.location.origin;
const EVIL_ORIGIN = 'https://evil.example';
const TOKEN = 'admin-session-token-91de';

const DRAFT = {
  skin: 'edomi-stub',
  pageId: 'page-wohnen',
  nodes: [
    {
      id: 'page-wohnen',
      parent_id: null,
      name: 'Wohnen',
      type: 'PAGE',
      kind: 'normal',
      page_config: {
        widgets: [
          {
            id: 'w-lamp',
            type: 'Licht',
            datapoint_id: null,
            status_datapoint_id: null,
            config: { dp_switch: 'dp-lamp' },
            x: 1,
            y: 2,
            w: 3,
            h: 4,
          },
        ],
      },
    },
  ],
};

/** Ein Elternfenster-Doppel: haelt jede ausgehende Nachricht fest. */
function fakeParent() {
  const sent: { message: unknown; targetOrigin: string }[] = [];
  return {
    sent,
    postMessage(message: unknown, targetOrigin: string): void {
      sent.push({ message, targetOrigin });
    },
  };
}

/**
 * Ein `message`-Ereignis einspeisen. jsdom laesst im `MessageEvent`-Konstruktor
 * nur echte Fenster als `source` zu, deshalb wird das Ereignis hier von Hand
 * zusammengesetzt - die Naht liest ohnehin nur `data`/`origin`/`source`.
 */
function emit(data: unknown, origin: string, source: unknown): void {
  const ev = Object.assign(new Event('message'), { data, origin, source });
  window.dispatchEvent(ev);
}

const message = (type: string, extra: Record<string, unknown> = {}) => ({
  channel: PREVIEW_CHANNEL,
  type,
  protocol: PREVIEW_PROTOCOL_VERSION,
  ...extra,
});

/**
 * Eine FALLE auf beide Browser-Ablagen (dieselbe wie in `receiver.spec.ts`).
 *
 * Ein Spion auf `Storage.prototype` faengt in dieser Umgebung nicht, was ueber
 * `sessionStorage` laeuft, und macht `localStorage` nur ueber einen `TypeError`
 * rot - also nicht ueber die Zusicherung. Die Doppel hier funktionieren normal
 * und protokollieren jeden Schreibversuch, egal auf welcher Ablage.
 */
function trapStorage(): { writes: string[]; restore: () => void } {
  const writes: string[] = [];
  const originals: [string, PropertyDescriptor | undefined][] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    originals.push([name, Object.getOwnPropertyDescriptor(window, name)]);
    const data = new Map<string, string>();
    const fake = {
      get length(): number {
        return data.size;
      },
      key: (i: number): string | null => Array.from(data.keys())[i] ?? null,
      getItem: (k: string): string | null => data.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        writes.push(`${name}.setItem(${k})`);
        data.set(k, String(v));
      },
      removeItem: (k: string): void => {
        writes.push(`${name}.removeItem(${k})`);
        data.delete(k);
      },
      clear: (): void => {
        writes.push(`${name}.clear()`);
        data.clear();
      },
    } as unknown as Storage;
    Object.defineProperty(window, name, { value: fake, configurable: true, writable: true });
  }
  return {
    writes,
    restore(): void {
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(window, name, descriptor);
      }
    },
  };
}

describe('preview/PreviewPage - der ganze Weg vom Editor bis ins DOM', () => {
  let parent: ReturnType<typeof fakeParent>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    setActivePinia(createPinia());
    captured = null;
    parent = fakeParent();
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ value: true }) });
    vi.stubGlobal('fetch', fetchSpy);
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}));
    }
  });

  afterEach(() => {
    for (const s of consoleSpies.splice(0)) s.mockRestore();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
  });

  async function mountPreview() {
    const i18n = createI18n({ legacy: false, locale: 'de', messages: { de: deMessages } });
    const wrapper = mount(PreviewPage, { global: { plugins: [i18n] } });
    await flushPromises();
    return wrapper;
  }

  /** Der Wurzelknoten der Seite, unabhaengig davon, was IonPage daraus macht. */
  const root = (wrapper: ReturnType<typeof mount>) => wrapper.find('[data-page="preview"]');

  it('meldet sich beim Elternfenster an und wartet, bis ein Entwurf kommt', async () => {
    const wrapper = await mountPreview();

    expect(parent.sent[0].message).toMatchObject({ type: PREVIEW_MESSAGE.ready });
    expect(parent.sent[0].targetOrigin).toBe(ADMIN_ORIGIN);
    expect(wrapper.find('[data-testid="preview-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="preview-canvas"]').exists()).toBe(false);
  });

  it('rendert einen Entwurf, ohne ihn zu speichern', async () => {
    const wrapper = await mountPreview();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    emit(message(PREVIEW_MESSAGE.draft, { draft: DRAFT }), ADMIN_ORIGIN, parent);
    await flushPromises();

    // Der Entwurf steht auf dem Bildschirm ...
    const canvas = wrapper.find('[data-testid="preview-canvas"]');
    expect(canvas.exists()).toBe(true);
    expect(canvas.attributes('data-preview-page')).toBe('page-wohnen');
    expect(wrapper.find('.skin-host-cell[data-id="w-lamp"]').exists()).toBe(true);
    expect(wrapper.find('.stub-tile').exists()).toBe(true);

    // ... und der Editor bekommt die Rueckmeldung.
    expect(parent.sent.at(-1)!.message).toMatchObject({
      type: PREVIEW_MESSAGE.draftApplied,
      pageId: 'page-wohnen',
      widgetCount: 1,
    });

    // Gespeichert wurde nichts: kein einziger schreibender Aufruf.
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.method ?? 'GET').toBe('GET');
      expect(String(call[0])).not.toContain('/visu/nodes');
    }
  });

  it('liest die Werte seitenbezogen mit der Session im Header, nie in der URL', async () => {
    await mountPreview();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    emit(message(PREVIEW_MESSAGE.draft, { draft: DRAFT }), ADMIN_ORIGIN, parent);
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/datapoints/dp-lamp/value');
    expect(url).not.toContain(TOKEN);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Page-Id']).toBe('page-wohnen');
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('bleibt gegenueber einer fremden Herkunft stumm', async () => {
    const wrapper = await mountPreview();
    const before = parent.sent.length;

    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), EVIL_ORIGIN, parent);
    emit(message(PREVIEW_MESSAGE.draft, { draft: DRAFT }), EVIL_ORIGIN, parent);
    await flushPromises();

    expect(wrapper.find('[data-testid="preview-canvas"]').exists()).toBe(false);
    expect(parent.sent).toHaveLength(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('zeigt einen unbekannten Skin als Fehler, statt still leer zu bleiben', async () => {
    const wrapper = await mountPreview();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    emit(message(PREVIEW_MESSAGE.draft, { draft: { ...DRAFT, skin: 'gibt-es-nicht' } }), ADMIN_ORIGIN, parent);
    await flushPromises();

    expect(wrapper.find('[data-testid="preview-canvas"]').exists()).toBe(false);
    expect(root(wrapper).attributes('data-preview-state')).toBe('unknown-skin');
  });

  it('haelt die Session aus Ablage, DOM, Nachrichten und Log heraus', async () => {
    // Hier standen frueher zwei Zusicherungen ueber `window.location`. Weder die
    // Seite noch der Empfaenger fassen `location` je an - die beiden Zeilen
    // konnten aus diesem Modul heraus gar nicht rot werden und haben nichts
    // bewiesen. Geprueft werden jetzt die vier Wege, die es hier wirklich gibt.
    const trap = trapStorage();
    let wrapper;
    try {
      wrapper = await mountPreview();
      emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
      emit(message(PREVIEW_MESSAGE.draft, { draft: DRAFT }), ADMIN_ORIGIN, parent);
      await flushPromises();
    } finally {
      trap.restore();
    }

    // 1. Keine Ablage: die Session lebt nur in der Closure der Seite. Die Falle
    //    faengt `localStorage` UND `sessionStorage`, jeden Schreibweg.
    expect(trap.writes).toEqual([]);
    // 2. Nicht im gerenderten DOM - kein Attribut, kein Text, kein Link.
    expect(wrapper!.html()).not.toContain(TOKEN);
    // 3. Nicht in einer ausgehenden Nachricht (auch nicht an den erlaubten Origin).
    for (const s of parent.sent) expect(JSON.stringify(s.message)).not.toContain(TOKEN);
    // 4. Nicht in einem Log, auf keiner der fuenf Ebenen.
    for (const spy of consoleSpies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
    // Und der Weg, auf dem sie ueberhaupt hinausdarf, wurde wirklich gegangen -
    // sonst waeren die vier Zusicherungen oben auch ohne Session gruen.
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('loest einen Link auf, ohne die Vorschau von der Entwurfsseite wegzufuehren', async () => {
    const wrapper = await mountPreview();
    emit(message(PREVIEW_MESSAGE.init, { session: { accessToken: TOKEN } }), ADMIN_ORIGIN, parent);
    emit(message(PREVIEW_MESSAGE.draft, { draft: DRAFT }), ADMIN_ORIGIN, parent);
    await flushPromises();

    expect(captured).not.toBeNull();
    expect(captured!.currentPageId).toBe('page-wohnen');
    // Auch nach einer Navigations-Anforderung bleibt die Entwurfsseite stehen.
    captured!.navigate('irgendwo-anders');
    await flushPromises();
    expect(captured!.currentPageId).toBe('page-wohnen');
    expect(wrapper.find('[data-testid="preview-canvas"]').attributes('data-preview-page')).toBe(
      'page-wohnen',
    );
  });
});
