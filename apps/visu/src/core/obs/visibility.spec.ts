import { describe, it, expect } from 'vitest';

import {
  evaluateVisibility,
  isWidgetVisible,
  mapTree,
  mapWidget,
  readVisibilityRule,
  visibilityReads,
  VISIBILITY_OPS,
  type ObsVisuNode,
  type ObsWidget,
} from './mapping';
import { composeLayers } from './compose';

/**
 * Bedingte Sichtbarkeit im HOST (Messlatte **E16**, M5 C3, Issue #170).
 *
 * Die Regel ist DATEN am Widget (`config.visible_when`, Teil der `PageConfig`,
 * die das Backend als JSON durchreicht); die Auswertung ist CODE, und sie steht
 * HIER - in derselben Uebersetzung, aus der die ausgelieferte Visu UND die
 * Editor-Vorschau ihre Geraete und Ebenen beziehen.
 *
 * Warum das der Ort ist und nicht der Editor: Messlatte **E3** sagt, die
 * Vorschau IST die Visu ("0 abweichende Pixel"). Filterte der Editor die
 * geregelten Elemente aus seinem Entwurf heraus, waehrend der Host die Regel
 * nicht kennt, zeigte die Vorschau fuer genau diese Elemente etwas anderes als
 * die spaeter ausgelieferte Seite - ein eingebauter Auseinanderlauf.
 */

function widget(id: string, extra: Partial<ObsWidget> = {}): ObsWidget {
  return {
    id,
    name: id,
    type: 'Toggle',
    datapoint_id: 'dp-w',
    status_datapoint_id: null,
    config: {},
    ...extra,
  } as ObsWidget;
}

/** Ein Widget mit Regel - die Form, die der Editor speichert. */
function geregelt(id: string, rule: unknown, extra: Partial<ObsWidget> = {}): ObsWidget {
  return widget(id, { ...extra, config: { ...(extra.config ?? {}), visible_when: rule } });
}

function page(id: string, widgets: readonly ObsWidget[]): ObsVisuNode {
  return {
    id,
    parent_id: null,
    name: id,
    type: 'PAGE',
    kind: 'normal',
    page_config: { widgets, includes: [], ignore_global_includes: true },
  } as ObsVisuNode;
}

describe('visible_when - die Regel aus den Daten lesen', () => {
  it('nimmt nur vollstaendige Regeln (halbe waeren stumm „immer sichtbar")', () => {
    expect(readVisibilityRule(geregelt('w', { datapoint_id: 'dp-1', op: 'gt', value: 30 }))).toEqual({
      datapoint_id: 'dp-1',
      op: 'gt',
      value: 30,
    });
    // Ohne Datenpunkt, ohne bekannten Vergleich, ohne Schwelle: keine Regel.
    expect(readVisibilityRule(geregelt('w', { op: 'gt', value: 30 }))).toBeNull();
    expect(readVisibilityRule(geregelt('w', { datapoint_id: 'dp-1', op: 'zwischen', value: 1 }))).toBeNull();
    expect(readVisibilityRule(geregelt('w', { datapoint_id: 'dp-1', op: 'gt' }))).toBeNull();
    expect(readVisibilityRule(geregelt('w', { datapoint_id: '  ', op: 'truthy' }))).toBeNull();
    // `truthy`/`falsy` brauchen keine Schwelle.
    expect(readVisibilityRule(geregelt('w', { datapoint_id: 'dp-1', op: 'truthy' }))).toEqual({
      datapoint_id: 'dp-1',
      op: 'truthy',
    });
    // Kein Widget, keine Konfig, gar keine Regel: sichtbar, nie ein Absturz.
    expect(readVisibilityRule(widget('w'))).toBeNull();
  });

  it('liest die Schwelle mit derselben Lesart wie die Abbildung (Zahl aus Text)', () => {
    expect(readVisibilityRule(geregelt('w', { datapoint_id: 'dp-1', op: 'eq', value: '30' }))).toEqual({
      datapoint_id: 'dp-1',
      op: 'eq',
      value: 30,
    });
    // Nicht-numerischer Text bleibt Text - der Textvergleich unten braucht ihn.
    expect(readVisibilityRule(geregelt('w', { datapoint_id: 'dp-1', op: 'eq', value: 'auf' }))).toEqual({
      datapoint_id: 'dp-1',
      op: 'eq',
      value: 'auf',
    });
  });
});

describe('visible_when - die Auswertung', () => {
  it('kennt jeden angebotenen Vergleich, in beide Richtungen', () => {
    const fall = (op: string, value: unknown, wert: unknown) =>
      evaluateVisibility({ datapoint_id: 'dp-1', op, value } as never, wert);

    expect(fall('eq', 30, 30)).toBe(true);
    expect(fall('eq', 30, 31)).toBe(false);
    expect(fall('ne', 30, 31)).toBe(true);
    expect(fall('ne', 30, 30)).toBe(false);
    expect(fall('lt', 30, 29)).toBe(true);
    expect(fall('lt', 30, 30)).toBe(false);
    expect(fall('lte', 30, 30)).toBe(true);
    expect(fall('lte', 30, 31)).toBe(false);
    expect(fall('gt', 30, 42)).toBe(true);
    expect(fall('gt', 30, 21.5)).toBe(false);
    expect(fall('gte', 30, 30)).toBe(true);
    expect(fall('gte', 30, 29)).toBe(false);
    expect(fall('truthy', undefined, 'on')).toBe(true);
    expect(fall('truthy', undefined, 0)).toBe(false);
    expect(fall('falsy', undefined, 'off')).toBe(true);
    expect(fall('falsy', undefined, 1)).toBe(false);

    // Die Liste, die das Formular anbietet, ist genau die hier gepruefte.
    expect([...VISIBILITY_OPS].sort()).toEqual(
      ['eq', 'falsy', 'gt', 'gte', 'lt', 'lte', 'ne', 'truthy'].sort(),
    );
  });

  it('vergleicht nicht-numerische Werte als Text - und nur auf Gleichheit', () => {
    const regel = { datapoint_id: 'dp-1', op: 'eq', value: 'auf' } as never;
    expect(evaluateVisibility(regel, 'auf')).toBe(true);
    expect(evaluateVisibility(regel, 'zu')).toBe(false);
    expect(evaluateVisibility({ datapoint_id: 'dp-1', op: 'gt', value: 'auf' } as never, 'zu')).toBe(false);
  });

  it('haelt ein Element mit unbekanntem Wert verborgen, statt es aufblitzen zu lassen', () => {
    const regel = { datapoint_id: 'dp-1', op: 'gt', value: 30 } as never;
    expect(evaluateVisibility(regel, undefined)).toBe(false);
    expect(evaluateVisibility(regel, null)).toBe(false);
    // Ohne Regel dagegen: sichtbar, ohne dass irgendein Wert vorliegen muss.
    expect(evaluateVisibility(null, undefined)).toBe(true);
    expect(isWidgetVisible(widget('w'), new Map())).toBe(true);
  });
});

describe('visible_when - die Regel wirkt im Host, nicht erst im Editor (E3/E16)', () => {
  const rule = { datapoint_id: 'dp-regel', op: 'gt', value: 30 };

  it('macht aus einem verborgenen Element KEIN Geraet', () => {
    const w = geregelt('w-1', rule);
    expect(mapWidget(w, 'Raum', new Map([['dp-regel', 21.5]]))).toBeNull();
    expect(mapWidget(w, 'Raum', new Map([['dp-regel', 42]]))).not.toBeNull();
    // Ohne jeden Wert bleibt es verborgen (dieselbe Regel wie oben).
    expect(mapWidget(w, 'Raum')).toBeNull();
  });

  it('nimmt es auch aus dem Ebenenstapel - derselbe Weg, den die Visu rendert', () => {
    const nodes = [page('p-1', [widget('w-frei'), geregelt('w-regel', rule)])];

    const verborgen = composeLayers(nodes, 'p-1', new Map([['dp-regel', 21.5]]));
    expect(verborgen.flatMap((l) => l.items.map((i) => i.id))).toEqual(['w-frei']);

    const sichtbar = composeLayers(nodes, 'p-1', new Map([['dp-regel', 42]]));
    expect(sichtbar.flatMap((l) => l.items.map((i) => i.id))).toEqual(['w-frei', 'w-regel']);
  });

  it('laesst ein Element ohne Regel unberuehrt', () => {
    const nodes = [page('p-1', [widget('w-frei')])];
    expect(mapTree(nodes).map((m) => m.device.id)).toEqual(['w-frei']);
    expect(mapTree(nodes, new Map()).map((m) => m.device.id)).toEqual(['w-frei']);
  });

  it('zeigt jedes Element, solange die Auswertung ausdruecklich uebergangen wird', () => {
    // Diesen Weg braucht die Datenquelle: der Lesesatz muss JEDES Element sehen,
    // auch das gerade verborgene - sonst laese niemand den Datenpunkt, an dem
    // seine Regel haengt, und die Regel koennte nie wieder umschlagen.
    const nodes = [page('p-1', [widget('w-frei'), geregelt('w-regel', rule)])];
    expect(mapTree(nodes, new Map(), { ignoreVisibility: true }).map((m) => m.device.id)).toEqual([
      'w-frei',
      'w-regel',
    ]);
  });
});

describe('visible_when - die Datenpunkte der Regeln gehoeren in den Lesesatz', () => {
  it('nennt jeden Regel-Datenpunkt mit der Seite, auf der er gelesen wird', () => {
    const nodes = [
      page('p-1', [geregelt('w-1', { datapoint_id: 'dp-a', op: 'truthy' })]),
      page('p-2', [
        geregelt('w-2', { datapoint_id: 'dp-b', op: 'gt', value: 1 }),
        geregelt('w-3', { datapoint_id: 'dp-b', op: 'lt', value: 9 }),
        widget('w-4'),
      ]),
    ];
    expect(visibilityReads(nodes)).toEqual([
      { pageId: 'p-1', dp: 'dp-a' },
      { pageId: 'p-2', dp: 'dp-b' },
    ]);
  });

  it('nennt nichts, wo keine Regel steht', () => {
    expect(visibilityReads([page('p-1', [widget('w-1')])])).toEqual([]);
    expect(visibilityReads([])).toEqual([]);
  });
});
