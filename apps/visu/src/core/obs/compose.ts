/**
 * core/obs/compose: page-layer composition + navigation tree (Edomi-Seitentypen, M5).
 *
 * Layering is a SKIN capability (CONTRIBUTING-visu-layering.md): the host turns
 * the backend visu tree into skin-consumable DATA (an ordered layer stack per
 * page, a popup descriptor per popup page, and a navigation tree), and the skin
 * decides HOW to render it (a pixel skin overlays layers absolutely; the
 * responsive ionic skin ignores this data and keeps its burger-nav + room-grouped
 * floor).
 *
 * Pure functions over the (already server-filtered) tree. No I/O, no state.
 *
 * ## Die Regeln (CONTRIBUTING-visu-m5.md §1, Edomi-Seitenhilfe als Referenz)
 *
 * Bis M5 war der Stapel eine Näherung über die `parent_id`-Kette, weil das
 * Backend die Seitentypen noch nicht kannte. Teil A liefert sie jetzt aus
 * (`VisuNode.kind`/`order`, `page_config.includes`/`ignore_global_includes`/
 * `popup`), also komponiert dieses Modul nach den echten Regeln:
 *
 * - **R9**  Jede Seite mit `kind === 'globalInclude'` wird in JEDE normale Seite
 *           einkomponiert; nie in ein Popup.
 * - **R10** Mehrere globale Includes stapeln aufsteigend nach Knoten-`order`,
 *           kleinste zuunterst (§2.2: bewusste Abweichung von Edomis ID-Folge,
 *           denn `order` ist vom Autor steuerbar und im Editor sichtbar). Gleiche
 *           `order` behält die Baumreihenfolge (stabile Sortierung).
 * - **R11** Der Direktaufruf einer globalen Includeseite zeigt die *anderen*
 *           globalen nicht: sie steht dann allein als `own`-Ebene.
 * - **R12** Globale Includeseiten inkludieren selbst nichts (eine Ebene). Das
 *           Backend validiert das mit 400; verlassen darf sich der Host nicht
 *           darauf (Restore/Migration/DB-Zugriff), also ignoriert er `includes`
 *           auf einer globalen Includeseite hier noch einmal ausdrücklich.
 * - **R13** `page_config.ignore_global_includes` unterdrückt die globalen
 *           Includes dieser einen Seite; die individuellen bleiben.
 * - **R14** `page_config.includes` wird in Listenreihenfolge als je eigene Ebene
 *           einkomponiert; ein Include darf selbst inkludieren (§2.1: die
 *           Zyklusprüfung des Backends folgt der Kette), das tiefere liegt unten.
 * - **R15** Verdeckung: eine Include-Quelle, die der Principal nicht lesen darf,
 *           fehlt entweder schon im (server-gefilterten) Baum oder trägt kein
 *           `page_config` (401/403 beim Laden). Beides ergibt keine Ebene, keinen
 *           Platzhalter, keinen Fehler. Der readonly-Teil von R15 sitzt nicht
 *           hier, sondern im Transport: `GET /visu/pages/{id}` beantwortet ihn
 *           per `X-Source-Page-Readonly` (§2.1), und die ObsDataSource setzt
 *           daraus `Device.writable = false`.
 *
 *           Ausdrücklich NICHT unter R15 fällt das 401 „PIN-Authentifizierung
 *           erforderlich" (§2.1): das ist keine Verdeckung, sondern eine
 *           auflösbare Aufforderung, und ein stilles Weglassen wäre ein
 *           Bedienfehler. Die Quelle verschwindet hier zwar (ohne `page_config`
 *           gibt es nichts zu zeichnen), sie bleibt aber im Gate-Angebot des
 *           Hosts (`ObsDataSource.pageGates()`) sichtbar und lösbar; nach der PIN
 *           komponiert das nächste `list()` ihre Ebene. Eine Markierung direkt
 *           AN der Include-Stelle bräuchte eine Vertragsergänzung (eine gesperrte
 *           Ebene ist im `PageLayer` heute nicht ausdrückbar) und wartet daher
 *           auf dieselbe Runde wie `NavNode.kind`.
 *
 *           Wichtig zur Signalliste: der Host unterscheidet diese Fälle
 *           ausschliesslich am **Statuscode**, nie am `detail`-Text. Teil E hat
 *           belegt, dass `spa_404_handler` (obs/main.py) das `detail` jedes 404
 *           unterhalb von `/api/` durch „Not found" ersetzt, die in §2.1
 *           genannten Texte also gar nicht auf der Leitung ankommen. Der
 *           ObsClient wirft entsprechend nach Status (401/403/404), und diese
 *           Komposition sieht ohnehin nur das Ergebnis: Knoten da oder nicht,
 *           `page_config` da oder nicht.
 * - **R2-R6/R8** Popups werden NICHT in den Seitenfluss komponiert; sie liefern
 *           über {@link composePopup} einen `PopupDescriptor`. Offen-Zustand und
 *           Auto-Close-Timer (R7) gehören weiterhin dem Host (SkinHost), nicht
 *           dem Skin und nicht diesem Modul.
 *
 * Stapelreihenfolge (Host-Entscheid, deterministisch, unten → oben):
 * globale Includes → individuelle Includes → eigene Ebene.
 *
 * ## Offene Vertragsergänzung
 *
 * `kind` wandert bewusst NICHT in den Vertrag: `NavNode.kind?: PageKind` ist für
 * Contract **1.14** vorgesehen (CONTRIBUTING-visu-m5.md §2.3), aber 1.13 hängt in
 * einem offenen PR der Parallel-Session (#153) und ein Bump hier würde die
 * skins-first-Kaskade (`targetsContract` in ionic/terminal/edomi) losbrechen.
 * Bis dahin trägt der Host das Feld selbst: {@link HostNavNode}. Sobald 1.14
 * steht, kann {@link HostNavNode} ersatzlos gegen `NavNode` getauscht werden,
 * denn die Form ist identisch. `PageKind`, `PageLayer.origin` und `PopupDescriptor`
 * stehen bereits seit 1.9/1.10/1.12 im Vertrag, hier fehlt nur die Nav-Naht.
 *
 * Golden rules honoured: no data fork (layers reference the same devices by id);
 * order is deterministic; additive (a skin that ignores layers/nav/popups is
 * unaffected); the skin owns no state.
 */

import type {
  LayerItem,
  NavNode,
  PageKind,
  PageLayer,
  PopupDescriptor,
  WidgetPosition,
} from '@obs/visu-contract';
import type { DataSource } from '../datasource';
import { mapWidget, type ObsPageConfig, type ObsVisuNode } from './mapping';

// Re-export the contract nav node so existing importers (datasource/store) keep
// their `./compose` import site while the type is the shared, skin-facing one.
export type { NavNode } from '@obs/visu-contract';

/**
 * The host's navigation node: the contract {@link NavNode} plus the page `kind`.
 *
 * A `HostNavNode` IS a `NavNode` (structurally), so everything typed against the
 * contract keeps working and a skin that ignores `kind` is unaffected. The extra
 * field exists so a skin can hide global include pages and popups from its
 * navigation (the badge/filter Teil C needs), without the host handing out a
 * second tree. See the module note above for the pending contract 1.14 addition.
 */
export interface HostNavNode extends NavNode {
  readonly kind: PageKind;
  readonly children: readonly HostNavNode[];
}

/**
 * A source that exposes the composed layering DATA (layering W3c): the navigation
 * tree, the per-page layer stack and the popup descriptor of a popup page. Only a
 * tree-backed source (the ObsDataSource) has these; the mock has none, so a skin
 * that renders nav/layers simply gets an empty tree there and falls back to its
 * responsive floor.
 */
export interface LayeringCapableDataSource extends DataSource {
  /** The visible PAGE/LOCATION navigation hierarchy. */
  navTree(): NavNode[];
  /** The ordered layer stack for a page (global + individual includes + own). */
  layersFor(pageId: string): PageLayer[];
  /**
   * The popup descriptor of a popup page, or null for any other page (M5 R2-R6).
   * Optional so an older layering source stays assignable; callers check first.
   */
  popupFor?(pageId: string): PopupDescriptor | null;
}

/** Does the source expose the layering DATA (nav tree + per-page layer stack)? */
export function supportsLayering(ds: DataSource): ds is LayeringCapableDataSource {
  const cand = ds as Partial<LayeringCapableDataSource>;
  return typeof cand.navTree === 'function' && typeof cand.layersFor === 'function';
}

/** A node's page type. A pre-M5 tree (no `kind`) is all-`normal`, the backend default. */
function kindOf(node: ObsVisuNode): PageKind {
  return node.kind ?? 'normal';
}

/** Map a page's widgets to layer items (id + optional author position). Pure. */
function itemsOf(
  config: ObsPageConfig | null,
  room: string,
  values: ReadonlyMap<string, unknown>,
): LayerItem[] {
  const items: LayerItem[] = [];
  for (const w of config?.widgets ?? []) {
    const mapped = mapWidget(w, room, values);
    if (!mapped) continue; // an undeclared type contributes nothing to the layer
    const id = mapped.device.id;
    if (!id) continue;
    items.push({
      id,
      ...(mapped.position ? { position: mapped.position } : {}),
      // The page link (#1194) rides along on the placed element; additive, so a
      // skin that ignores it renders exactly as before.
      ...(mapped.link ? { link: mapped.link } : {}),
    });
  }
  return items;
}

/** One planned layer before its items are mapped: which node, and why it is here. */
interface PlannedLayer {
  readonly node: ObsVisuNode;
  readonly origin: PageLayer['origin'];
}

/**
 * The global include pages of a tree, bottom-first: ascending by node `order`
 * (R10), ties keeping tree order. `Array.prototype.sort` is stable (ES2019), so
 * two pages with the same `order` never swap between two calls.
 */
function globalIncludes(nodes: readonly ObsVisuNode[]): ObsVisuNode[] {
  return nodes
    .filter((n) => n.type === 'PAGE' && kindOf(n) === 'globalInclude')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Compose the ordered layer stack for a page from the Edomi page types.
 *
 * The result is bottom-first: global include pages (R9/R10, unless the page opts
 * out per R13 or is a popup / a global include itself), then the page's own
 * `includes` in author order with nested ones underneath (R14), then the target
 * page as the `own` layer on top. Layers with no mappable widgets (a bare
 * LOCATION, an empty page, a page whose config stayed concealed) drop out, so a
 * concealed include source leaves no trace at all (R15).
 *
 * Never throws: an unknown id, a LOCATION, a dangling include, a cyclic include
 * chain and a self-include all yield a well-formed (possibly empty) stack.
 */
export function composeLayers(
  nodes: readonly ObsVisuNode[],
  pageId: string,
  values: ReadonlyMap<string, unknown> = new Map(),
): PageLayer[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const target = byId.get(pageId);
  // A LOCATION (or an unknown id) owns no content: never a stack, never a throw.
  if (!target || target.type !== 'PAGE') return [];

  const targetKind = kindOf(target);
  // Every page is composed at most once; the set doubles as the cycle guard for
  // include chains and swallows a self-include (R14) without a special case.
  const seen = new Set<string>([pageId]);
  const planned: PlannedLayer[] = [];

  // R9/R10/R13: the global include pages sit beneath every NORMAL page. Not
  // beneath a popup (R9), not beneath a global include page itself (R11), and
  // not beneath a page that opted out (R13).
  if (targetKind === 'normal' && target.page_config?.ignore_global_includes !== true) {
    for (const g of globalIncludes(nodes)) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      planned.push({ node: g, origin: 'global' });
    }
  }

  // R14: the page's own include list, in author order, nested-first so a deeper
  // source ends up under the page that includes it.
  const collect = (node: ObsVisuNode): void => {
    // R12: a global include page includes nothing; the backend rejects it with
    // 400, but a row restored/written past the API could still carry a list.
    if (kindOf(node) === 'globalInclude') return;
    for (const id of node.page_config?.includes ?? []) {
      if (seen.has(id)) continue; // already composed / cycle / self-include
      const src = byId.get(id);
      // R15 + §2.1 signal list: missing from the (server-filtered) tree = 404 or
      // concealed; a LOCATION = 400 "Knoten ist keine Seite". Both: drop silently.
      if (!src || src.type !== 'PAGE') continue;
      // A popup never joins the page flow, however it got into the list.
      if (kindOf(src) === 'popup') continue;
      seen.add(id);
      collect(src);
      planned.push({ node: src, origin: 'include' });
    }
  };
  collect(target);

  planned.push({ node: target, origin: 'own' });

  const layers: PageLayer[] = [];
  let order = 0;
  for (const { node, origin } of planned) {
    const items = itemsOf(node.page_config, node.name, values);
    // No widgets → no layer: an empty page and a concealed source (page_config
    // stayed null after a 401/403) are indistinguishable to the skin (R15).
    if (items.length === 0) continue;
    layers.push({ id: node.id, origin, order: order++, items });
  }
  return layers;
}

/**
 * The author's popup box, or undefined when any of x/y/w/h is missing (R2: the
 * host then centres it). The contract's {@link WidgetPosition} is all-or-nothing,
 * so a partial box is no box; the same rule the widget mapper applies.
 */
function popupBox(cfg: NonNullable<ObsPageConfig['popup']>): WidgetPosition | undefined {
  const { x, y, w, h } = cfg;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number'
  ) {
    return undefined;
  }
  return { x, y, w, h };
}

/**
 * The {@link PopupDescriptor} of a popup page (M5 R2-R6, R8), or null for any
 * other node: a normal page, a global include page, a LOCATION, an unknown id.
 *
 * Pure data handed to the skin: WHERE and HOW LARGE (R2/R3), how long until it
 * closes itself (R4), and the presentation flags (R5/R6). The open-state and the
 * auto-close timer stay with the host (SkinHost), which is why re-opening does
 * not extend the timer (R7) and why arbitrarily many DIFFERENT popups can be
 * open at once (R8): each page yields its own, independent descriptor.
 *
 * A popup page without a `popup` block still yields a bare descriptor: all
 * defaults, i.e. centred, non-modal, no auto-close.
 */
export function composePopup(
  nodes: readonly ObsVisuNode[],
  pageId: string,
): PopupDescriptor | null {
  const node = nodes.find((n) => n.id === pageId);
  if (!node || node.type !== 'PAGE' || kindOf(node) !== 'popup') return null;

  const cfg = node.page_config?.popup;
  if (!cfg) return { id: node.id };
  const position = popupBox(cfg);
  const autoCloseMs =
    typeof cfg.auto_close_ms === 'number' && cfg.auto_close_ms > 0 ? cfg.auto_close_ms : undefined;
  return {
    id: node.id,
    // Every flag is additive: absent means "the skin's default", so a descriptor
    // stays as small as the author's configuration.
    ...(position ? { position } : {}),
    ...(autoCloseMs !== undefined ? { autoCloseMs } : {}),
    ...(cfg.modal ? { modal: true } : {}),
    ...(cfg.animate ? { animate: true } : {}),
    ...(cfg.shadow ? { shadow: true } : {}),
    ...(cfg.dim_backdrop ? { dimBackdrop: true } : {}),
  };
}

/**
 * Build the navigation tree (the visible PAGE/LOCATION hierarchy) from the flat
 * `/visu/tree`. Root nodes (`parent_id === null`) first; children in tree order.
 * The tree is already principal-filtered by the server, so concealed nodes are
 * simply absent. A parent that is not present (filtered out) is treated as a root.
 *
 * Each node carries its page `kind` ({@link HostNavNode}) so a skin can keep
 * global include pages and popups out of its navigation. The host does NOT filter
 * them here: they stay addressable (a global include page can be called directly,
 * R11), the skin decides what it shows.
 */
export function buildNavTree(nodes: readonly ObsVisuNode[]): HostNavNode[] {
  const present = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, ObsVisuNode[]>();
  for (const n of nodes) {
    // A parent filtered out of the tree makes this node an effective root.
    const key = n.parent_id !== null && present.has(n.parent_id) ? n.parent_id : null;
    const arr = byParent.get(key);
    if (arr) arr.push(n);
    else byParent.set(key, [n]);
  }
  const build = (parentId: string | null): HostNavNode[] =>
    (byParent.get(parentId) ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      access: n.access ?? null,
      kind: kindOf(n),
      children: build(n.id),
    }));
  return build(null);
}
