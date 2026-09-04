import { describe, it, expect, vi } from 'vitest';

import { composeLayers, composePopup, buildNavTree, includeSourceIds } from './compose';
import { ObsClient } from './client';
import { ObsDataSource } from './obs-datasource';
import type { ObsVisuNode } from './mapping';

/**
 * core/obs/compose: die Regeltabelle R9-R15 aus CONTRIBUTING-visu-m5.md §1.
 *
 * Bis M5 leitete `composeLayers` den Stapel aus der `parent_id`-Kette ab (W3b-
 * Näherung). Das Backend liefert seit Teil A die echten Edomi-Felder (`kind`,
 * `page_config.includes`, `ignore_global_includes`, `popup`), also kodiert diese
 * Datei die Regeln selbst; je Regel ein Fall und je Verzweigung die
 * Gegenrichtung. Die Näherungs-Tests („Vorfahren als include-Ebenen", „zyklische
 * parent_id-Kette") sind bewusst entfallen: sie hielten genau das Modell fest,
 * das Issue #167 ersetzt, und sind nach der Umstellung nicht falsch, sondern
 * gegenstandslos.
 *
 * Reihenfolge des Stapels (Host-Entscheid, deterministisch): globale Includes
 * (aufsteigend nach Knoten-`order`) → individuelle Includes (Listenreihenfolge,
 * verschachtelte zuerst) → eigene Ebene zuoberst.
 */

/* --------------------------------------------------------------- Bausteine */

const toggle = (id: string, dp: string, box?: { x: number; y: number; w: number; h: number }) => ({
  id,
  name: id,
  type: 'Toggle',
  datapoint_id: dp,
  status_datapoint_id: null,
  config: {},
  ...(box ?? {}),
});

/** Eine Seite mit genau einem Widget; kürzt die Bäume unten ab. */
const page = (id: string, extra: Partial<ObsVisuNode> = {}): ObsVisuNode => ({
  id,
  parent_id: null,
  name: id,
  type: 'PAGE',
  access: 'public',
  page_config: { widgets: [toggle(`w-${id}`, `dp-${id}`)] },
  ...extra,
});

const ids = (layers: readonly { id: string }[]) => layers.map((l) => l.id);
const origins = (layers: readonly { origin: string }[]) => layers.map((l) => l.origin);

/* ------------------------------------------------------- R9 / R10 (global) */

describe('R9: globale Inkludeseiten kommen in jede normale Seite, nie in Popups', () => {
  const TREE: ObsVisuNode[] = [
    page('glob', { kind: 'globalInclude', order: 0 }),
    page('a'),
    page('b'),
    page('pop', { kind: 'popup' }),
  ];

  it('komponiert die globale Includeseite unter JEDE normale Seite', () => {
    for (const target of ['a', 'b']) {
      const layers = composeLayers(TREE, target);
      expect(ids(layers)).toEqual(['glob', target]);
      expect(origins(layers)).toEqual(['global', 'own']);
      expect(layers.map((l) => l.order)).toEqual([0, 1]);
    }
  });

  it('Gegenrichtung: ein Popup bekommt KEINE globale Includeseite', () => {
    const layers = composeLayers(TREE, 'pop');
    expect(ids(layers)).toEqual(['pop']);
    expect(origins(layers)).toEqual(['own']);
  });
});

describe('R10: mehrere globale Includes: aufsteigend nach Knoten-`order`, kleinste zuerst', () => {
  it('stapelt nach `order`, nicht nach Baumreihenfolge (§2.2, Abweichung von Edomis ID-Folge)', () => {
    const tree: ObsVisuNode[] = [
      page('g-spaet', { kind: 'globalInclude', order: 5 }),
      page('g-frueh', { kind: 'globalInclude', order: 1 }),
      page('g-mitte', { kind: 'globalInclude', order: 3 }),
      page('ziel'),
    ];
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['g-frueh', 'g-mitte', 'g-spaet', 'ziel']);
  });

  it('gleiche (oder fehlende) `order` behält die Baumreihenfolge: stabil, nie zufällig', () => {
    const tree: ObsVisuNode[] = [
      page('g1', { kind: 'globalInclude' }), // order fehlt → 0
      page('g2', { kind: 'globalInclude', order: 0 }),
      page('ziel'),
    ];
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['g1', 'g2', 'ziel']);
  });
});

describe('R11: Direktaufruf einer globalen Inkludeseite zeigt die anderen globalen nicht', () => {
  const TREE: ObsVisuNode[] = [
    page('g1', { kind: 'globalInclude', order: 1 }),
    page('g2', { kind: 'globalInclude', order: 2 }),
  ];

  it('zeigt beim Direktaufruf nur die eigene Ebene', () => {
    const layers = composeLayers(TREE, 'g1');
    expect(ids(layers)).toEqual(['g1']);
    expect(origins(layers)).toEqual(['own']);
  });

  it('Gegenrichtung: dieselben zwei stapeln sich sehr wohl unter einer normalen Seite', () => {
    const layers = composeLayers([...TREE, page('normal')], 'normal');
    expect(ids(layers)).toEqual(['g1', 'g2', 'normal']);
  });
});

describe('R12: globale Inkludeseiten inkludieren selbst nichts (eine Ebene)', () => {
  // Das Backend lehnt das mit 400 ab; der Host darf sich darauf nicht verlassen
  // (Restore/DB-Zugriff), muss also robust bleiben statt zu vertrauen.
  const TREE: ObsVisuNode[] = [
    page('quelle'),
    page('g', {
      kind: 'globalInclude',
      order: 1,
      page_config: { widgets: [toggle('w-g', 'dp-g')], includes: ['quelle'] },
    }),
    page('ziel'),
  ];

  it('ignoriert die `includes` einer globalen Includeseite beim Direktaufruf', () => {
    expect(ids(composeLayers(TREE, 'g'))).toEqual(['g']);
  });

  it('ignoriert sie auch, wenn die globale Seite in eine normale komponiert wird', () => {
    expect(ids(composeLayers(TREE, 'ziel'))).toEqual(['g', 'ziel']);
  });
});

describe('R13: `ignore_global_includes` unterdrückt die globalen Includes dieser Seite', () => {
  const TREE: ObsVisuNode[] = [
    page('g', { kind: 'globalInclude', order: 1 }),
    page('opt-out', {
      page_config: { widgets: [toggle('w-opt', 'dp-opt')], ignore_global_includes: true },
    }),
    page('normal'),
  ];

  it('lässt die globale Ebene weg, die eigene bleibt', () => {
    const layers = composeLayers(TREE, 'opt-out');
    expect(ids(layers)).toEqual(['opt-out']);
    expect(origins(layers)).toEqual(['own']);
  });

  it('Gegenrichtung: ohne das Flag steht die globale Ebene darunter', () => {
    expect(ids(composeLayers(TREE, 'normal'))).toEqual(['g', 'normal']);
  });

  it('unterdrückt nur die globalen, nicht die individuellen Includes', () => {
    const tree: ObsVisuNode[] = [
      page('g', { kind: 'globalInclude', order: 1 }),
      page('inc'),
      page('ziel', {
        page_config: {
          widgets: [toggle('w-ziel', 'dp-ziel')],
          includes: ['inc'],
          ignore_global_includes: true,
        },
      }),
    ];
    const layers = composeLayers(tree, 'ziel');
    expect(ids(layers)).toEqual(['inc', 'ziel']);
    expect(origins(layers)).toEqual(['include', 'own']);
  });
});

/* -------------------------------------------------------- R14 (individuell) */

describe('R14: individuelle Includes werden als eigene Ebenen einkomponiert', () => {
  it('hält die Listenreihenfolge und markiert sie als `include` unter der eigenen Ebene', () => {
    const tree: ObsVisuNode[] = [
      page('inc-b'),
      page('inc-a'),
      page('ziel', {
        page_config: { widgets: [toggle('w-ziel', 'dp-ziel')], includes: ['inc-a', 'inc-b'] },
      }),
    ];
    const layers = composeLayers(tree, 'ziel');
    expect(ids(layers)).toEqual(['inc-a', 'inc-b', 'ziel']);
    expect(origins(layers)).toEqual(['include', 'include', 'own']);
    expect(layers.map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it('stapelt global → include → own, wenn beides zusammentrifft', () => {
    const tree: ObsVisuNode[] = [
      page('g', { kind: 'globalInclude', order: 1 }),
      page('inc'),
      page('ziel', {
        page_config: { widgets: [toggle('w-ziel', 'dp-ziel')], includes: ['inc'] },
      }),
    ];
    expect(origins(composeLayers(tree, 'ziel'))).toEqual(['global', 'include', 'own']);
  });

  it('folgt verschachtelten Includes (Ziel des Ziels) und legt das tiefere zuunterst', () => {
    // §2.1: verschachtelte Ziele prüft das Backend nicht, die Zyklusprüfung
    // folgt aber der Kette; die Kette ist also gewollt, nicht verboten.
    const tree: ObsVisuNode[] = [
      page('tief'),
      page('mitte', { page_config: { widgets: [toggle('w-m', 'dp-m')], includes: ['tief'] } }),
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['mitte'] } }),
    ];
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['tief', 'mitte', 'ziel']);
  });

  it('komponiert jede Seite höchstens einmal und hängt sich an einem Zyklus nicht auf', () => {
    const tree: ObsVisuNode[] = [
      page('a', { page_config: { widgets: [toggle('w-a', 'dp-a')], includes: ['b'] } }),
      page('b', { page_config: { widgets: [toggle('w-b', 'dp-b')], includes: ['a'] } }),
    ];
    expect(ids(composeLayers(tree, 'a'))).toEqual(['b', 'a']);
  });

  it('erzeugt für einen Selbst-Include keine zweite Ebene', () => {
    const tree: ObsVisuNode[] = [page('a', { page_config: { widgets: [toggle('w-a', 'dp-a')], includes: ['a'] } })];
    expect(ids(composeLayers(tree, 'a'))).toEqual(['a']);
  });

  it('komponiert ein Popup nicht in den Seitenfluss, auch wenn es in `includes` steht', () => {
    const tree: ObsVisuNode[] = [
      page('pop', { kind: 'popup' }),
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['pop'] } }),
    ];
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['ziel']);
  });

  it('reicht Autorenposition und Seitenlink der Include-Quelle durch (kein Datenfork)', () => {
    const tree: ObsVisuNode[] = [
      page('inc', {
        page_config: {
          widgets: [
            toggle('w-box', 'dp-box', { x: 1, y: 2, w: 3, h: 4 }),
            {
              ...toggle('w-link', 'dp-link'),
              config: { target_node_id: 'ziel', active_indicator: 'dot' },
            },
          ],
        },
      }),
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['inc'] } }),
    ];
    const [inc] = composeLayers(tree, 'ziel');
    expect(inc.items.map((i) => i.id)).toEqual(['w-box', 'w-link']);
    expect(inc.items[0].position).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(inc.items[1].link).toEqual({ targetNodeId: 'ziel', activeIndicator: 'dot' });
    // Gegenrichtung (Bestandstest aus der parent_id-Fassung, wiederhergestellt):
    // ein Widget OHNE Linkziel trägt kein `link`-Feld. `toBeUndefined()` allein
    // reicht dafür nicht — ein stets gesetztes `link: undefined` bestünde die
    // Probe —, also wird zusätzlich die Schlüsselmenge festgehalten.
    expect(inc.items[0].link).toBeUndefined();
    expect(Object.keys(inc.items[0])).toEqual(['id', 'position']);
  });
});

/* ----------------------------------------------------- R15 (Zugriffsgrenze) */

describe('R15: Include über eine Zugriffsgrenze: verdeckt bleibt verdeckt', () => {
  it('eine im Baum fehlende Quelle (verdeckt / 404) erzeugt keine Ebene und keinen Fehler', () => {
    const tree: ObsVisuNode[] = [
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['weg'] } }),
    ];
    expect(() => composeLayers(tree, 'ziel')).not.toThrow();
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['ziel']);
  });

  it('eine Quelle ohne `page_config` (403/401 beim Laden) erzeugt keine Ebene, keinen Platzhalter', () => {
    const tree: ObsVisuNode[] = [
      page('gesperrt', { page_config: null }),
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['gesperrt'] } }),
    ];
    const layers = composeLayers(tree, 'ziel');
    expect(ids(layers)).toEqual(['ziel']);
    expect(origins(layers)).toEqual(['own']);
  });

  it('eine Quelle, die keine Seite ist (400 „Knoten ist keine Seite"), wird still weggelassen', () => {
    // Der LOCATION trägt hier ausdrücklich Widgets: sonst scheiterte die Ebene
    // ohnehin an `items.length === 0` und die Typwache wäre unbelegt.
    const tree: ObsVisuNode[] = [
      {
        id: 'ordner',
        parent_id: null,
        name: 'Ordner',
        type: 'LOCATION',
        access: null,
        page_config: { widgets: [toggle('w-ordner', 'dp-ordner')] },
      },
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['ordner'] } }),
    ];
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['ziel']);
  });

  it('sperrt die Widgets einer readonly-Quelle (X-Source-Page-Readonly → writable=false)', async () => {
    // §2.1: der Antwort-Header von GET /visu/pages/{id} ist die einzige
    // verlässliche Readonly-Quelle; der Baum liefert `access` roh mit gekappter
    // Elternkette. Hier sagt der Baum nichts (access null = erben) und der
    // writable-Endpunkt sogar `true`; allein der Header darf sperren.
    const tree: ObsVisuNode[] = [
      page('src', { access: null, page_config: null }),
      page('ziel', {
        access: null,
        page_config: { widgets: [toggle('w-ziel', 'dp-ziel')], includes: ['src'] },
      }),
    ];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(tree), { status: 200 });
      if (u.includes('/visu/pages/src')) {
        return new Response(JSON.stringify({ widgets: [toggle('w-src', 'dp-src')] }), {
          status: 200,
          headers: { 'X-Source-Page-Readonly': 'true' },
        });
      }
      if (u.endsWith('/writable')) {
        return new Response(JSON.stringify({ writable: { 'dp-src': true, 'dp-ziel': true } }), {
          status: 200,
        });
      }
      if (u.endsWith('/value')) {
        return new Response(JSON.stringify({ value: null }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    const ds = new ObsDataSource(
      new ObsClient({ apiBase: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    const devices = await ds.list();

    // Die Quelle ist lesbar, also wird sie komponiert, aber gesperrt.
    expect(ids(ds.layersFor('ziel'))).toEqual(['src', 'ziel']);
    expect(devices.find((d) => d.id === 'w-src')?.writable).toBe(false);
    // Gegenprobe: die eigene, nicht-readonly Seite bleibt bedienbar.
    expect(devices.find((d) => d.id === 'w-ziel')?.writable).toBe(true);
  });

  /**
   * Ein Server, der `src` als Include-Quelle von `ziel` ausliefert und den
   * Readonly-Header je Anfrage frei setzen kann. `null` heisst: Header fehlt ganz.
   * Der writable-Endpunkt sagt für beide Datenpunkte `true` — allein der Header
   * darf sperren (§2.1).
   */
  function readonlySeam(header: () => string | null): ObsDataSource {
    const tree: ObsVisuNode[] = [
      page('src', { page_config: null }),
      page('ziel', {
        page_config: { widgets: [toggle('w-ziel', 'dp-ziel')], includes: ['src'] },
      }),
    ];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(tree), { status: 200 });
      if (u.includes('/visu/pages/src')) {
        const value = header();
        return new Response(JSON.stringify({ widgets: [toggle('w-src', 'dp-src')] }), {
          status: 200,
          ...(value === null ? {} : { headers: { 'X-Source-Page-Readonly': value } }),
        });
      }
      if (u.endsWith('/writable')) {
        return new Response(JSON.stringify({ writable: { 'dp-src': true, 'dp-ziel': true } }), {
          status: 200,
        });
      }
      if (u.endsWith('/value')) return new Response(JSON.stringify({ value: null }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    return new ObsDataSource(
      new ObsClient({ apiBase: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
  }

  it('Gegenrichtung: ein Header, der nicht „true" sagt, sperrt NICHT', async () => {
    // Die Wache ist `=== 'true'`, nicht „Header vorhanden": ein Server, der den
    // Header IMMER setzt (auch mit `false`), darf keine Seite stilllegen.
    for (const header of ['false', '0', '', null]) {
      const devices = await readonlySeam(() => header).list();
      expect(devices.find((d) => d.id === 'w-src')?.writable).toBe(true);
    }
  });

  it('invalidiert den Readonly-Cache bei jedem `list()` (readonly → wieder bedienbar)', async () => {
    // Der Cache lebt über den Lauf hinaus; ohne Invalidierung bliebe eine Seite,
    // die nach PIN/Login nicht mehr readonly ist, für immer gesperrt.
    let readonly = true;
    const ds = readonlySeam(() => (readonly ? 'true' : 'false'));
    expect((await ds.list()).find((d) => d.id === 'w-src')?.writable).toBe(false);
    readonly = false;
    expect((await ds.list()).find((d) => d.id === 'w-src')?.writable).toBe(true);
  });

  it('verwirft eine PIN-geschützte Quelle nicht still, sondern bietet sie als Gate an', async () => {
    // §2.1: 401 „PIN-Authentifizierung erforderlich" ist KEINE Verdeckung,
    // sondern eine auflösbare Aufforderung; stilles Weglassen wäre hier ein
    // Bedienfehler. Die Quelle bleibt also im Gate-Angebot des Hosts, und nach
    // der PIN komponiert das nächste list() ihre Ebene.
    const tree: ObsVisuNode[] = [
      page('src', { access: 'protected', page_config: null }),
      page('ziel', {
        access: null,
        page_config: { widgets: [toggle('w-ziel', 'dp-ziel')], includes: ['src'] },
      }),
    ];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const token = (init?.headers as Record<string, string> | undefined)?.['X-Session-Token'];
      if (u.endsWith('/visu/tree')) return new Response(JSON.stringify(tree), { status: 200 });
      if (u.endsWith('/visu/nodes/src/auth')) {
        return new Response(JSON.stringify({ session_token: 'sess-1', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (u.includes('/visu/pages/src')) {
        if (token !== 'sess-1') {
          // Der `detail`-Text steht hier nur zur Anschauung: Host und Test
          // entscheiden am Statuscode. Teil E hat belegt, dass
          // `spa_404_handler` (obs/main.py) das `detail` jedes 404 unterhalb
          // von /api/ durch „Not found" ersetzt, die Texte aus §2.1 also nicht
          // auf der Leitung ankommen.
          return new Response(JSON.stringify({ detail: 'PIN-Authentifizierung erforderlich' }), {
            status: 401,
          });
        }
        return new Response(JSON.stringify({ widgets: [toggle('w-src', 'dp-src')] }), {
          status: 200,
          headers: { 'X-Source-Page-Readonly': 'false' },
        });
      }
      if (u.endsWith('/writable')) {
        return new Response(JSON.stringify({ writable: { 'dp-src': true, 'dp-ziel': true } }), {
          status: 200,
        });
      }
      if (u.endsWith('/value')) return new Response(JSON.stringify({ value: null }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    const ds = new ObsDataSource(
      new ObsClient({ apiBase: '/api/v1', fetchImpl: fetchImpl as unknown as typeof fetch }),
    );

    await ds.list();
    // Noch keine Ebene, aber die Quelle ist als lösbares PIN-Gate sichtbar,
    // nicht spurlos verschwunden (das unterscheidet 401-PIN von 403/404).
    expect(ids(ds.layersFor('ziel'))).toEqual(['ziel']);
    expect(ds.pageGates().map((g) => g.pageId)).toContain('src');

    await ds.authenticatePage('src', '1234');
    await ds.list();
    expect(ids(ds.layersFor('ziel'))).toEqual(['src', 'ziel']);
    expect(ds.pageGates().map((g) => g.pageId)).not.toContain('src');
  });
});

describe('includeSourceIds: die Include-Stelle bleibt benennbar, auch wenn ihre Ebene fehlt', () => {
  // §2.1 verlangt für eine PIN-geschützte Quelle die PIN-Abfrage AN der
  // Include-Stelle. `composeLayers` lässt die Quelle (zu Recht) weg — es gibt
  // nichts zu zeichnen —, sie muss aber weiter benennbar bleiben, sonst kann der
  // Host das Gate nicht dieser Seite zuordnen.
  const TREE: ObsVisuNode[] = [
    page('g', { kind: 'globalInclude', order: 1 }),
    page('gesperrt', { access: 'protected', page_config: null }),
    page('tief'),
    page('mitte', { page_config: { widgets: [toggle('w-m', 'dp-m')], includes: ['tief'] } }),
    page('ziel', {
      page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['gesperrt', 'mitte'] },
    }),
  ];

  it('nennt globale und individuelle Quellen in Stapelreihenfolge, die eigene Seite nie', () => {
    expect(includeSourceIds(TREE, 'ziel')).toEqual(['g', 'gesperrt', 'tief', 'mitte']);
    // Gegenprobe: als Ebene taucht die gesperrte Quelle NICHT auf (R15).
    expect(ids(composeLayers(TREE, 'ziel'))).toEqual(['g', 'tief', 'mitte', 'ziel']);
  });

  it('liefert für eine Seite ohne Includes, ein Popup und eine unbekannte Id nichts', () => {
    const tree: ObsVisuNode[] = [page('allein'), page('pop', { kind: 'popup' })];
    expect(includeSourceIds(tree, 'allein')).toEqual([]);
    expect(includeSourceIds(tree, 'pop')).toEqual([]);
    expect(includeSourceIds(tree, 'nix')).toEqual([]);
  });
});

/* ------------------------------------------ Popup-Deskriptor (R2, R3, R6, R8) */

describe('composePopup: Popup-Seiten liefern einen PopupDescriptor statt einer Ebene', () => {
  it('übernimmt Box, Auto-Close und die Darstellungs-Flags aus `page_config.popup`', () => {
    const tree: ObsVisuNode[] = [
      page('pop', {
        kind: 'popup',
        page_config: {
          widgets: [toggle('w-pop', 'dp-pop')],
          popup: {
            x: 10,
            y: 20,
            w: 300,
            h: 200,
            auto_close_ms: 5000,
            modal: true,
            animate: true,
            shadow: true,
            dim_backdrop: true,
          },
        },
      }),
    ];
    expect(composePopup(tree, 'pop')).toEqual({
      id: 'pop',
      position: { x: 10, y: 20, w: 300, h: 200 },
      autoCloseMs: 5000,
      modal: true,
      animate: true,
      shadow: true,
      dimBackdrop: true,
    });
  });

  it('R2: fehlt eine Koordinate, bleibt `position` undefiniert (der Host zentriert)', () => {
    const tree: ObsVisuNode[] = [
      page('pop', {
        kind: 'popup',
        page_config: { widgets: [], popup: { y: 20, w: 300, h: 200 } },
      }),
    ];
    expect(composePopup(tree, 'pop')?.position).toBeUndefined();
  });

  it('ein Popup ohne `popup`-Block liefert den nackten Deskriptor (alles Default)', () => {
    const tree: ObsVisuNode[] = [page('pop', { kind: 'popup' })];
    expect(composePopup(tree, 'pop')).toEqual({ id: 'pop' });
  });

  it('liefert null für eine normale Seite, eine globale Includeseite und ein unbekanntes Ziel', () => {
    const tree: ObsVisuNode[] = [page('normal'), page('g', { kind: 'globalInclude' })];
    expect(composePopup(tree, 'normal')).toBeNull();
    expect(composePopup(tree, 'g')).toBeNull();
    expect(composePopup(tree, 'nix')).toBeNull();
  });

  it('R4-Wache: `auto_close_ms` 0 oder negativ ist KEIN Auto-Close', () => {
    // 0 hiesse in Edomi „kein Auto-Close"; ein durchgereichtes `autoCloseMs: 0`
    // liefe im Host auf `setTimeout(..., 0)` hinaus, das Popup schlösse sich also
    // sofort wieder. Ein negativer Wert ist gar keine Dauer.
    const tree: ObsVisuNode[] = [
      page('p0', { kind: 'popup', page_config: { widgets: [], popup: { auto_close_ms: 0 } } }),
      page('pneg', { kind: 'popup', page_config: { widgets: [], popup: { auto_close_ms: -5 } } }),
    ];
    expect(composePopup(tree, 'p0')).toEqual({ id: 'p0' });
    expect(composePopup(tree, 'pneg')).toEqual({ id: 'pneg' });
  });

  it('R8: verschiedene Popups liefern verschiedene, unabhängige Deskriptoren', () => {
    const tree: ObsVisuNode[] = [
      page('p1', { kind: 'popup', page_config: { widgets: [], popup: { modal: true } } }),
      page('p2', { kind: 'popup', page_config: { widgets: [], popup: { auto_close_ms: 1000 } } }),
    ];
    expect(composePopup(tree, 'p1')).toEqual({ id: 'p1', modal: true });
    expect(composePopup(tree, 'p2')).toEqual({ id: 'p2', autoCloseMs: 1000 });
  });
});

/* ------------------------------------------------------------ Grundverhalten */

describe('composeLayers: Grundverhalten', () => {
  it('eine Seite ohne Includes hat genau eine eigene Ebene (die parent_id-Näherung entfällt)', () => {
    const tree: ObsVisuNode[] = [page('eltern'), page('kind', { parent_id: 'eltern' })];
    const layers = composeLayers(tree, 'kind');
    expect(ids(layers)).toEqual(['kind']);
    expect(origins(layers)).toEqual(['own']);
  });

  it('lässt Ebenen ohne abbildbare Widgets weg (leere Seite)', () => {
    const tree: ObsVisuNode[] = [
      page('leer', { page_config: { widgets: [] } }),
      page('ziel', { page_config: { widgets: [toggle('w-z', 'dp-z')], includes: ['leer'] } }),
    ];
    expect(ids(composeLayers(tree, 'ziel'))).toEqual(['ziel']);
  });

  it('liefert einen leeren Stapel für eine unbekannte Seiten-Id (wirft nie)', () => {
    expect(composeLayers([page('a')], 'nope')).toEqual([]);
  });

  it('liefert einen leeren Stapel für einen LOCATION-Knoten, auch mit Widgets daran', () => {
    // Die Wache prüft den KNOTENTYP, nicht die Widget-Zahl. Ein LOCATION ohne
    // `page_config` würde auch ohne sie an `items.length === 0` scheitern — der
    // Fall belegte sie also nicht. Mit Widgets (Restore/DB-Zugriff am API vorbei)
    // ist die Wache das Einzige, was die Ebene verhindert.
    const withWidgets: ObsVisuNode[] = [
      {
        id: 'loc',
        parent_id: null,
        name: 'EG',
        type: 'LOCATION',
        access: null,
        page_config: { widgets: [toggle('w-loc', 'dp-loc')] },
      },
    ];
    expect(composeLayers(withWidgets, 'loc')).toEqual([]);
    const bare: ObsVisuNode[] = [
      { id: 'loc', parent_id: null, name: 'EG', type: 'LOCATION', access: null, page_config: null },
    ];
    expect(composeLayers(bare, 'loc')).toEqual([]);
  });
});

/* --------------------------------------------------------------- Navigation */

describe('buildNavTree: die sichtbare PAGE/LOCATION-Hierarchie', () => {
  const TREE: ObsVisuNode[] = [page('nav'), page('eg', { parent_id: 'nav' }), page('bad', { parent_id: 'eg' })];

  it('verschachtelt Kinder unter ihrem Elternknoten in Baumreihenfolge', () => {
    const nav = buildNavTree(TREE);
    expect(nav.map((n) => n.id)).toEqual(['nav']);
    expect(nav[0].children.map((n) => n.id)).toEqual(['eg']);
    expect(nav[0].children[0].children.map((n) => n.id)).toEqual(['bad']);
    expect(nav[0].children[0].children[0].access).toBe('public');
  });

  it('behandelt einen Knoten mit weggefiltertem Elternknoten als Wurzel', () => {
    const nav = buildNavTree(TREE.filter((n) => n.id !== 'nav'));
    expect(nav.map((n) => n.id)).toEqual(['eg']);
    expect(nav[0].children.map((n) => n.id)).toEqual(['bad']);
  });

  it('trägt den Seitentyp `kind` mit, damit ein Skin globale Includes und Popups ausblendet', () => {
    // Host-internes Feld: `NavNode.kind` steht erst für Contract 1.14 an (§2.3),
    // 1.13 hängt in PR #153; deshalb hier und (noch) nicht im Vertrag.
    const tree: ObsVisuNode[] = [
      page('normal'),
      page('g', { kind: 'globalInclude' }),
      page('pop', { kind: 'popup' }),
      { id: 'loc', parent_id: null, name: 'EG', type: 'LOCATION', access: null, page_config: null },
    ];
    expect(buildNavTree(tree).map((n) => n.kind)).toEqual(['normal', 'globalInclude', 'popup', 'normal']);
  });
});
