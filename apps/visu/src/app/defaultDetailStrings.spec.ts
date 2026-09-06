/* eslint-disable vue/one-component-per-file -- Testhelfer (ion-* Durchreicher und ein
   Kind, das die Host-API einsammelt) stehen bewusst neben dem Test, genau wie in
   `DetailModalHost.spec.ts`. */
// Ratsche gegen Schlüssel, die die generische Detailfläche benutzt, die es in den
// Locale-Dateien aber nicht gibt.
//
// ══ Der Fehler, gegen den sie steht
//
// `DetailModalHost → defaultDetail` zeichnet die Detailfläche für Gerätetypen, für die
// der Skin keinen Renderer mitbringt (heute z. B. `scene` im ionic-Skin). Ihre Beschriftungen
// laufen über `ctx.t`. Fehlt der Schlüssel in den Locales, gibt vue-i18n den SCHLÜSSEL
// zurück — und der stand im Auslieferungsstand wörtlich auf dem Knopf: `skin.default.activate`.
//
// Der Literal-Fallback in `defaultDetail` griff dagegen nicht: er ist an `t` selbst gebunden
// (`t ? t(key) : fallback`), nicht an das Ergebnis. Sobald der Host einen Translator
// installiert hat — und das tut `main.ts` beim Start —, ist `t` da und der Fallback aus dem Spiel.
//
// ══ Warum das kein Gate fängt
//
// `tools/check_i18n_guard.py` hat `TARGET_FILE_RE = ^(gui/src|frontend/src)/…` — `apps/visu/src`
// fällt nicht darunter, und `.github/workflows/visu-ci.yml` hat keinen i18n-Schritt. Für diese
// App gibt es also keinen i18n-Hard-Gate; diese Ratsche deckt den einen Ort ab, an dem der
// Fehler sichtbar wurde.
//
// ══ Was erhoben wird
//
// Die Schlüssel kommen aus der QUELLE von `DetailModalHost.vue`, nicht aus einer Liste hier:
// eine hart hingeschriebene Liste würde den Fehler nur ins Spec verschieben. Ein neuer
// `tr('…')`-Aufruf fällt damit automatisch unter die Prüfung.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, inject } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import type { Device } from '@obs/visu-contract';
import type { SkinHostApi } from './DetailModalHost.vue';

import de from '../locales/de.json';
import en from '../locales/en.json';

// Nicht ueber `import.meta.url`: unter der jsdom-Umgebung liefert Vite dafuer keine
// `file:`-URL, und `fileURLToPath` wirft. Vitest laeuft mit dem Paketverzeichnis als cwd.
/**
 * Die ion-* Web-Komponenten rendern ihren Slot unter jsdom nicht (ihr Lebenszyklus laeuft
 * dort nicht). Ein Durchreicher macht den Rumpf pruefbar — dasselbe Vorgehen wie in
 * `DetailModalHost.spec.ts`.
 */
function PassThrough(tag: string) {
  return defineComponent({
    props: { isOpen: { type: Boolean, default: false } },
    setup(p, { slots }) {
      return () => h(tag, { 'is-open': String(!!p.isOpen) }, slots.default ? slots.default() : []);
    },
  });
}

const SOURCE_PATH = resolve(process.cwd(), 'src/app/DetailModalHost.vue');
const SOURCE = existsSync(SOURCE_PATH) ? readFileSync(SOURCE_PATH, 'utf8') : '';

/** Die `tr('<schlüssel>', '<literal>')`-Aufrufe der generischen Detailfläche. */
const CALLS: readonly { key: string; fallback: string }[] = [
  ...SOURCE.matchAll(/\btr\(\s*'([^']+)'\s*,\s*'([^']*)'\s*\)/g),
].map((m) => ({ key: m[1] as string, fallback: m[2] as string }));

/** Löst einen punktierten Schlüssel im Locale-Baum auf. */
function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

describe('Beschriftungen der generischen Detailfläche', () => {
  it('liest die Quelle, gegen die sie prüft', () => {
    // Ohne diese Zusicherung wäre ein falscher Pfad ein leerer Text — und die Erhebung
    // darunter still leer statt laut.
    expect(existsSync(SOURCE_PATH), `${SOURCE_PATH} nicht gefunden`).toBe(true);
  });

  it('benutzt überhaupt übersetzte Beschriftungen', () => {
    // Leere Erhebung ist kein Grün: fände die Regex nichts, bestünde die Prüfung darunter
    // trivial, ohne einen einzigen Schlüssel gesehen zu haben.
    expect(
      CALLS.length,
      'DetailModalHost.vue enthält keinen tr(…)-Aufruf — entweder zeichnet die generische ' +
        'Fläche keine Beschriftungen mehr, oder diese Erhebung ist blind.',
    ).toBeGreaterThan(0);
  });

  it.each(['de', 'en'])('kennt jeden benutzten Schlüssel in %s.json', (locale) => {
    const tree = locale === 'de' ? de : en;
    const missing = CALLS.filter((c) => lookup(tree, c.key) === undefined).map((c) => c.key);
    expect(
      missing,
      `Die generische Detailfläche benutzt Schlüssel, die ${locale}.json nicht kennt: ` +
        `${missing.join(', ')}. vue-i18n gibt dann den SCHLÜSSEL zurück — er steht wörtlich ` +
        'auf dem Bedienelement.',
    ).toEqual([]);
  });
});

describe('Fallback der generischen Detailfläche', () => {
  // 60 s: `vi.resetModules()` laedt die Vue-/Ionic-Kette neu; unter Last reisst der 5-s-Default.
  it('zeigt das Literal, wenn der Übersetzer den Schlüssel zurückgibt', { timeout: 60_000 }, async () => {
    // Genau das tut vue-i18n bei einem fehlenden Schlüssel — und die Fläche zeigte ihn dann
    // wörtlich an. Der Fallback hing an `t` SELBST (`t ? t(key) : fallback`), nicht an seinem
    // Ergebnis: sobald `main.ts` einen Übersetzer installiert hat, war er aus dem Spiel.
    //
    // Gemessen wird an der ECHTEN Komponente, nicht an einer Kopie der Regel. `vi.resetModules`
    // plus dynamische Importe halten den installierten Übersetzer in diesem Test — `core/ctx`
    // hält ihn in Modulzustand und bietet keinen Weg zurück zum Default.
    vi.resetModules();
    const { installCtxTranslator } = await import('../core/ctx');
    const { useDeviceStore } = await import('../core/store');
    const { MockDataSource } = await import('../core/datasource');
    const Host = (await import('./DetailModalHost.vue')).default;
    const { HOST_KEY } = await import('./DetailModalHost.vue');

    // Ein Übersetzer, der jeden Schlüssel unverändert zurückgibt.
    installCtxTranslator((key: string) => key);

    setActivePinia(createPinia());
    const scene = {
      type: 'scene',
      id: 'movie',
      room: 'EG Wohnz.',
      label: 'Filmabend',
      accent: 'violet',
      icon: 'scene',
    } as Device;
    await useDeviceStore().init(new MockDataSource([scene]));

    let api: SkinHostApi | undefined;
    const wrapper = mount(Host, {
      global: {
        config: { compilerOptions: { isCustomElement: (tag: string) => tag.startsWith('ion-') } },
        stubs: { IonModal: PassThrough('ion-modal'), IonPopover: PassThrough('ion-popover') },
      },
      props: { skin: 'ionic' },
      slots: {
        default: () =>
          h(
            defineComponent({
              setup() {
                const a = inject<SkinHostApi>(HOST_KEY);
                if (a) api = a;
                return () => h('div');
              },
            }),
          ),
      },
    });
    api!.openDetail('movie');
    await flushPromises();

    const action = wrapper.find('[data-action="activateScene"]');
    expect(action.exists(), 'die generische Detailfläche wurde nicht gezeichnet').toBe(true);
    expect(action.text(), 'der Knopf trägt den rohen i18n-Schlüssel statt einer Beschriftung').toBe('Aktivieren');
  });
});
