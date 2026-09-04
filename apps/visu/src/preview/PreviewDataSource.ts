/**
 * preview/PreviewDataSource - der Entwurf als Datenquelle (C4, Issue #171).
 *
 * **Warum es diese Quelle gibt (die Falle).** `MockDataSource` kann kein
 * Layering: `navTree()` und `layersFor()` fehlen ihr, also liefert der Store
 * einem seitenbesitzenden Skin einen leeren Baum und eine leere Layerliste - und
 * der Skin rendert **stumm leer**. Kein Fehler, kein Hinweis, nur eine weisse
 * Flaeche. Eine Vorschau, die so gebaut waere, zeigte fuer jeden Entwurf
 * dasselbe Nichts (CONTRIBUTING-visu-m5.md §2.4).
 *
 * Diese Quelle schliesst genau diese Luecke: sie implementiert dieselben
 * optionalen Faehigkeiten wie die echte `ObsDataSource`
 * (`LayeringCapableDataSource` · `PositionCapableDataSource` ·
 * `LinkCapableDataSource`) und leitet sie mit **denselben** Funktionen aus dem
 * Entwurf ab, mit denen die echte Visu ihre Serverantwort ableitet:
 * `mapTree` (Widgets -> Geraete), `buildNavTree` (Baum) und `composeLayers`
 * (Layerstapel). Keine zweite Modellform, kein zweiter Renderer - deshalb zeigt
 * die Vorschau dasselbe wie die spaeter gespeicherte Seite (Messlatte **E3**).
 *
 * Goldene Regeln: der Entwurf fliesst ueber den HOST (diese Quelle -> Store ->
 * `PageHost`) in den Skin, nie direkt hinein; der Skin besitzt keinen Zustand.
 * Werte kommen vom Backend, nicht aus dem Entwurf - die Vorschau zeigt echte
 * Datenpunkte, keine erfundenen.
 */

import type { Device, PageLayer, PageLink, WidgetAction, WidgetPosition } from '@obs/visu-contract';
import type { DataSource, DevicePatch, PatchListener } from '../core/datasource';
import type { LinkCapableDataSource, PositionCapableDataSource } from '../core/datasource';
import {
  applyDp,
  mapTree,
  planWrite,
  type MappedWidget,
  type ObsVisuNode,
} from '../core/obs/mapping';
import {
  buildNavTree,
  composeLayers,
  type LayeringCapableDataSource,
  type NavNode,
} from '../core/obs/compose';
import type { PreviewDraft } from './protocol';

/**
 * Woher die Vorschau ihre Werte bekommt. Absichtlich schmal: die Vorschau LIEST
 * seitenbezogen (`X-Page-Id`) und schreibt eine kanonische Aktion zurueck - mehr
 * braucht sie nicht, und mehr soll sie nicht koennen (sie speichert keinen
 * Entwurf).
 */
export interface PreviewValueBackend {
  /** Werte der genannten Datenpunkte, seitenbezogen gelesen. */
  read(datapointIds: readonly string[], pageId: string): Promise<ReadonlyMap<string, unknown>>;
  /** Einen Wert seitenbezogen schreiben. */
  write(datapointId: string, value: unknown, pageId: string): Promise<void>;
}

/** Ein Backend, das nichts kann - die Vorschau zeigt dann Struktur ohne Werte. */
const OFFLINE_BACKEND: PreviewValueBackend = {
  read: () => Promise.resolve(new Map()),
  write: () => Promise.resolve(),
};

export class PreviewDataSource
  implements
    DataSource,
    LayeringCapableDataSource,
    PositionCapableDataSource,
    LinkCapableDataSource
{
  private draft: PreviewDraft | null = null;
  /** Gemappte Widgets, nach Geraete-id - der einzige Besitzer dieses Zustands. */
  private mapped = new Map<string, MappedWidget>();
  /** Zuletzt gelesene Datenpunktwerte (leer, bis `list()` gelaufen ist). */
  private values: ReadonlyMap<string, unknown> = new Map();
  private readonly listeners = new Set<PatchListener>();

  constructor(private readonly backend: PreviewValueBackend = OFFLINE_BACKEND) {}

  /**
   * Einen neuen Entwurf uebernehmen. Rein lokal: nichts wird gespeichert, nichts
   * gesendet. Der naechste `list()` holt die Werte dazu.
   */
  setDraft(draft: PreviewDraft): void {
    this.draft = draft;
    this.values = new Map();
    this.remap();
  }

  /** Die Knoten des Entwurfs in Backend-Form (leer ohne Entwurf). */
  private nodes(): readonly ObsVisuNode[] {
    return this.draft?.nodes ?? [];
  }

  private remap(): void {
    const next = new Map<string, MappedWidget>();
    for (const m of mapTree(this.nodes(), this.values)) {
      if (m.device.id) next.set(m.device.id, m);
    }
    this.mapped = next;
  }

  /* ------------------------------------------------------------ DataSource */

  async list(): Promise<Device[]> {
    if (!this.draft) return [];
    // Die zu lesenden Datenpunkte je SEITE sammeln: der Server autorisiert
    // seitenbezogen, also wird auch seitenbezogen gelesen - wie in der Visu.
    const byPage = new Map<string, Set<string>>();
    for (const m of mapTree(this.nodes())) {
      const pageId = m.pageId;
      if (!pageId) continue;
      let dps = byPage.get(pageId);
      if (!dps) {
        dps = new Set<string>();
        byPage.set(pageId, dps);
      }
      for (const read of m.binding.reads) dps.add(read.dp);
    }

    const values = new Map<string, unknown>();
    for (const [pageId, dps] of byPage) {
      if (dps.size === 0) continue;
      try {
        for (const [dp, v] of await this.backend.read([...dps], pageId)) values.set(dp, v);
      } catch {
        // Verdeckt, gesperrt oder unerreichbar: die Vorschau zeigt dann die
        // Struktur ohne Wert. Ein Entwurf darf nicht daran scheitern, dass ein
        // Datenpunkt (noch) nicht lesbar ist.
      }
    }
    this.values = values;
    this.remap();
    return [...this.mapped.values()].map((m) => m.device);
  }

  subscribe(cb: PatchListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async dispatch(id: string, action: WidgetAction, payload?: unknown): Promise<void> {
    const m = this.mapped.get(id);
    if (!m) throw new Error(`preview: unknown device "${id}"`);
    const plan = planWrite(m.device, m.writes, action, payload);
    const pageId = m.pageId ?? this.draft?.pageId ?? '';
    await this.backend.write(plan.dp, plan.value, pageId);
    // Optimistisch zurueckspiegeln, damit die Vorschau reagiert wie die Visu.
    const values = new Map(this.values);
    values.set(plan.dp, plan.value);
    this.values = values;
    const changes = applyDp(m.binding, m.device, plan.dp, plan.value);
    if (!changes) return;
    this.mapped.set(id, { ...m, device: { ...m.device, ...changes } as Device });
    this.emit({ id, changes });
  }

  private emit(patch: DevicePatch): void {
    for (const cb of this.listeners) {
      try {
        cb(patch);
      } catch {
        /* ein fehlerhafter Zuhoerer ist seine eigene Sache */
      }
    }
  }

  /* ------------------------------------------- Layering (die Kernfaehigkeit) */

  /** Der Navigationsbaum DES ENTWURFS - nicht der gespeicherte Baum. */
  navTree(): NavNode[] {
    return buildNavTree(this.nodes());
  }

  /** Der Layerstapel einer Entwurfsseite, komponiert wie in der echten Visu. */
  layersFor(pageId: string): PageLayer[] {
    return composeLayers(this.nodes(), pageId, this.values);
  }

  /** Die Autorenkoordinaten des Entwurfs (x/y/w/h), fuer pixelgenaue Skins. */
  positions(): ReadonlyMap<string, WidgetPosition> {
    const out = new Map<string, WidgetPosition>();
    for (const [id, m] of this.mapped) if (m.position) out.set(id, m.position);
    return out;
  }

  /** Die Sprungziele des Entwurfs; der Host loest sie auf, nicht der Skin. */
  links(): ReadonlyMap<string, PageLink> {
    const out = new Map<string, PageLink>();
    for (const [id, m] of this.mapped) if (m.link) out.set(id, m.link);
    return out;
  }
}
