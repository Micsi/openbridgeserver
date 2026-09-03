/**
 * skin-host/SkinHost — the host render component (A1 + A4, Issues #97 + #100).
 *
 * This is the single place the app turns a page's `skin` key + ordered, grouped
 * items into rendered tiles. It wires the three host responsibilities together:
 *
 *   1. resolve the skin from the registry         (skins.ts)
 *   2. resolve the layout from the manifest        (layout.ts — A4)
 *   3. dispatch each item to its type's renderer    (dispatch.ts — A1)
 *
 * Goldene Regeln honoured:
 *   - The skin owns no state: the host reads live device state from the core
 *     store and hands each renderer the read-only `(device, tokens, ctx)` triple
 *     (golden rule 1/4). Gestures are the host's job (a later workstream); this
 *     component is pure render dispatch + layout.
 *   - Renderer addressed by type; a missing, non-unsupported type throws a gap
 *     (golden rule 2/3) — surfaced loudly, never a silent default lamp.
 *   - Order + grouping are the floor; role/span are additive (golden rule 5):
 *     the layout drives the item order and the grid footprint per item.
 *   - AA tokens come from the core `makeTokens` (golden rule 6).
 *
 * Implemented as a `defineComponent` render function (not an SFC) because the
 * skin renderers already return VNodes — a render function composes them
 * directly and stays trivially unit-testable.
 */

import {
  defineComponent,
  h,
  computed,
  inject,
  ref,
  onBeforeUnmount,
  Fragment,
  type PropType,
  type VNode,
} from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

import type { Device, NavNode, PageHost, PageLink, PopupDescriptor } from '@obs/visu-contract';
import { makeTokens, type Theme } from '../core/tokens';
import { activeCtx } from '../core/ctx';
import { useDeviceStore } from '../core/store';
import { isLinkActive, linksDeliverable } from '../core/links';
import deMessages from '../locales/de.json';
import './link-affordance.css';
import { rooms as modelRooms, type RoomGroup } from '../core/model';
import { ROOM_DIVIDER_KEY } from '../app/shell/roomDivider';

import { resolveSkin } from './skins';
import { resolveLayout, clampColumns } from './layout';
import { selectTile } from './dispatch';

/**
 * The V1 link widget's active colour (`frontend/src/widgets/Link/Widget.vue`).
 * Kept identical so a linked tile reads the same as the V1 link it replaces.
 * Used only as a marker (dot/bar/outline), never as text on a background.
 */
const LINK_ACTIVE_COLOR = '#D6A800';

/** The plain name of a nav-tree node, or null when the tree does not hold it. */
function navNodeName(nodes: readonly NavNode[], id: string): string | null {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    const inner = navNodeName(n.children, id);
    if (inner) return inner;
  }
  return null;
}

/** The DOM decoration a page link (#1194) adds to a host cell. */
interface LinkDecoration {
  readonly attrs: Record<string, unknown>;
  readonly style: Record<string, string>;
  readonly extra: VNode[];
}

/**
 * Decorate a host cell for a page link (#1194). The cell carries `data-link` so
 * the gesture seam (OverviewGrid) can resolve the target, becomes focusable so
 * the jump is keyboard-operable, and shows a pointer cursor; when the link is
 * active — the target IS the current page or an ancestor of it — the host draws
 * the author's chosen indicator (V1 `active_indicator`: dot · bar · border).
 *
 * Host chrome, not skin markup: the skin owns the tile, the host owns the
 * navigation affordance and its state (golden rule 4).
 *
 * `deliverable === false` (the skin binds `tap` to something other than
 * `action`, see core/links → linksDeliverable) WITHHOLDS the affordance: no
 * cursor, not focusable, and the cell is stamped `data-link-unsupported`. A link
 * that cannot fire must not look like one — the gap is declared and inspectable
 * rather than a dead-looking tile (golden rule 3).
 *
 * a11y — the "stretched link" pattern (review round 3):
 *  - The CELL is never the link. It carries no role and is not a tab stop; it is
 *    only the pointer hit-area the host's click delegation already owns. A bare
 *    focusable div would be a focus stop with neither name nor role (WCAG 4.1.2),
 *    and `role="link"` on the cell would drag the tile's own control text into
 *    the link's name-from-content and leave two overlapping activation targets.
 *  - Instead the host places ONE real, NAMED link inside the cell, stretched over
 *    the tile (see link-affordance.css). Assistive tech then announces a link
 *    *and* the tile's own button, with no nesting and one clean tab stop.
 *  - The name is the host's to own: golden rule 4 makes the navigation affordance
 *    a host concern, so its label is too. It comes from the host's own locale
 *    files plus the target's plain name out of the nav tree.
 *  - The active `border` is drawn with an inset `box-shadow`, never `outline`,
 *    so `outline` stays free for the link's focus ring.
 */
function decorateLink(
  link: PageLink | undefined,
  active: boolean,
  deliverable: boolean,
  label: string,
): LinkDecoration {
  if (!link) return { attrs: {}, style: {}, extra: [] };
  const indicator = link.activeIndicator ?? 'none';
  if (!deliverable) {
    // Declared gap: the target is still readable in the DOM for tooling/tests,
    // but nothing pretends to be operable.
    return {
      attrs: { 'data-link': link.targetNodeId, 'data-link-unsupported': 'true' },
      style: {},
      extra: [],
    };
  }
  const attrs: Record<string, unknown> = {
    'data-link': link.targetNodeId,
    'data-link-indicator': indicator,
  };
  const style: Record<string, string> = { cursor: 'pointer' };
  // The stretched link: the one named, focusable, announced navigation element.
  const extra: VNode[] = [
    h('a', {
      class: 'skin-host-link',
      role: 'link',
      tabindex: 0,
      // The name is carried by `aria-label`, not by clipped text: a visually
      // hidden <span> did NOT produce an accessible name here (measured in
      // Chrome — the link came out nameless), and an unnamed focusable link is
      // exactly the WCAG 4.1.2 failure this pattern exists to remove.
      'aria-label': label,
      'data-testid': 'link-anchor',
      ...(active ? { 'aria-current': 'page' } : {}),
    }),
  ];
  if (active) {
    attrs['data-link-active'] = 'true';
    if (indicator === 'border') {
      // box-shadow, not outline: outline belongs to the focus ring.
      style.boxShadow = `inset 0 0 0 2px ${LINK_ACTIVE_COLOR}`;
      style.borderRadius = 'inherit';
    } else if (indicator === 'dot' || indicator === 'bar') {
      // dot/bar are absolutely placed inside the cell, so it must be a containing
      // block. `relative` is inert for a grid item and is already implied by the
      // absolute placement of a position-honouring skin.
      if (!style.position) style.position = 'relative';
      extra.push(
        indicator === 'dot'
          ? h('span', {
              class: 'skin-host-link-dot',
              'data-testid': 'link-active-dot',
              'aria-hidden': 'true',
              style: {
                position: 'absolute',
                top: '6px',
                right: '6px',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: LINK_ACTIVE_COLOR,
                pointerEvents: 'none',
              },
            })
          : h('span', {
              class: 'skin-host-link-bar',
              'data-testid': 'link-active-bar',
              'aria-hidden': 'true',
              style: {
                position: 'absolute',
                left: '8px',
                right: '8px',
                bottom: '2px',
                height: '2px',
                borderRadius: '999px',
                background: LINK_ACTIVE_COLOR,
                pointerEvents: 'none',
              },
            }),
      );
    }
  }
  return { attrs, style, extra };
}

export default defineComponent({
  name: 'SkinHost',
  props: {
    /** The page's chosen skin key (author's decision — no runtime switch). */
    skin: { type: String, required: true },
    /** The ordered, grouped room blocks to render (defaults to the core model). */
    groups: {
      type: Array as PropType<readonly RoomGroup[]>,
      default: () => modelRooms,
    },
    /** Active theme for AA-safe tokens. */
    theme: { type: String as PropType<Theme>, default: 'light' },
    /** Requested column count (clamped into the skin's declared window). */
    columns: { type: Number, default: undefined },
    /**
     * The page this host renders, for the link active-indicator (#1194). The
     * static/routed floor passes its routed page id (deterministic per mounted
     * page — the Ionic outlet can keep two alive during a transition); with an
     * external floor nothing is passed and the host's own `currentPageId` — the
     * state the link action and a page-owning skin's nav write — decides.
     */
    currentPage: { type: String, default: undefined },
    /**
     * Display names for link targets the nav tree does not carry (#1194). The
     * static/routed floor has no nav tree at all, so without this every link on
     * a shipped page would announce the same generic fallback — two neighbouring
     * links to different pages would be indistinguishable (WCAG 2.4.4). The page
     * layer owns the page definitions and their translated titles, so it passes
     * them down here, exactly like {@link currentPage}. The nav tree still wins
     * when it has the node.
     */
    pageNames: {
      type: Object as PropType<Readonly<Record<string, string>>>,
      default: undefined,
    },
  },
  setup(props) {
    const store = useDeviceStore();

    /**
     * Translator for the host's own chrome (the page-link label, #1194).
     *
     * vue-i18n is only installed when the app mounts this; a standalone unit
     * mount has no plugin, so fall back to the SOURCE-language messages that
     * ship in `locales/de.json`. The string still lives in a locale file either
     * way — never a literal in code (the i18n gate), and never an empty name on
     * a focusable link (WCAG 4.1.2).
     */
    const i18n = (() => {
      try {
        return useI18n({ useScope: 'global' });
      } catch {
        return null;
      }
    })();
    function translate(key: string, params: Record<string, unknown> = {}): string {
      if (i18n) return i18n.t(key, params);
      const fallback = (deMessages.links as Record<string, string>)[key.replace('links.', '')];
      if (!fallback) return '';
      return fallback.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ''));
    }

    // The shell provides the per-group divider renderer (the `#roomDivider` slot
    // override, or the default RoomDivider as fallback). When no shell is mounted
    // above (a standalone unit mount) there is no divider — the grouping gap is
    // still the floor signal. (#116)
    const roomDivider = inject(ROOM_DIVIDER_KEY, null);

    /** Live device for an id: store state (the host owns state), else undefined. */
    function liveDevice(id: string): Device | undefined {
      return store.byId(id);
    }

    const skin = computed(() => resolveSkin(props.skin));
    /**
     * Can a page link fire under this skin's declared gesture model (#1194)?
     * False when the skin binds `tap` to `openDetail`/`presets` — then every tile
     * already has a click function of its own and the link is a DECLARED gap
     * (core/links → LINK_TAP_TARGET), not a silently swallowed feature.
     */
    const linkable = computed(() => linksDeliverable(skin.value.manifest.gestures));
    /**
     * Does the SKIN own the page-link affordance (#146)? True for a page-owning
     * skin that DECLARES `honors: ['link']`: it then draws the jump itself
     * through the host's resolver members (`resolveLink`/`followLink`/
     * `isLinkActive`/`linkLabel`), so the host must not ALSO stretch its own
     * link over the cell — two overlapping affordances and two tab stops for one
     * jump. Without that declaration the host keeps its floor affordance, so a
     * skin that says nothing behaves exactly as before.
     */
    const skinOwnsLinks = computed(
      () => Boolean(skin.value.page) && (skin.value.manifest.layout.honors ?? []).includes('link'),
    );
    const layout = computed(() =>
      resolveLayout(skin.value.manifest.layout, props.groups, liveDevice),
    );

    const cols = computed(() =>
      clampColumns(layout.value.columns, props.columns ?? layout.value.columns.default),
    );

    /* ------------------------------------------- page-renderer host seam (W4) */
    // A skin that owns the page (nav + layers + popups) exports a `page` renderer;
    // the host owns the STATE (current page, open popups + auto-close timers) and
    // renders the content tiles, the skin owns the appearance (skin stays stateless).
    // The current page + the link state live in the STORE (the host's single state
    // owner, #1194): the link action writes them and a page-owning skin reads them
    // through the PageHost, so both navigation paths move the same state.
    const { navTree, currentPageId, links: deviceLinks } = storeToRefs(store);
    const openPopups = ref<PopupDescriptor[]>([]);
    const popupTimers = new Map<string, ReturnType<typeof setTimeout>>();

    function firstPageId(nodes: readonly NavNode[]): string | null {
      for (const n of nodes) {
        if (n.type === 'PAGE') return n.id;
        const inner = firstPageId(n.children);
        if (inner) return inner;
      }
      return null;
    }
    function closePopup(id: string): void {
      openPopups.value = openPopups.value.filter((p) => p.id !== id);
      const t = popupTimers.get(id);
      if (t) {
        clearTimeout(t);
        popupTimers.delete(id);
      }
    }
    function openPopup(descriptor: PopupDescriptor): void {
      // Re-opening an already-open popup does NOT extend its timer (Edomi rule).
      if (openPopups.value.some((p) => p.id === descriptor.id)) return;
      openPopups.value = [...openPopups.value, descriptor];
      if (descriptor.autoCloseMs && descriptor.autoCloseMs > 0) {
        popupTimers.set(
          descriptor.id,
          setTimeout(() => closePopup(descriptor.id), descriptor.autoCloseMs),
        );
      }
    }
    onBeforeUnmount(() => {
      for (const t of popupTimers.values()) clearTimeout(t);
      popupTimers.clear();
    });

    /** Render the host's content tile for a device id — the skin's own type
     *  renderer, wrapped in a cell carrying `data-id` so gestures still resolve.
     *  A missing/undeclared device degrades quietly (never throws for the seam). */
    function renderTile(deviceId: string): VNode {
      const device = store.byId(deviceId);
      if (!device) return h('div', { class: 'skin-host-missing', 'data-id': deviceId });
      const sk = skin.value;
      const selection = selectTile(sk.tiles, sk.manifest, device.type);
      const tokens = makeTokens(props.theme, device.accent);
      const body =
        selection.renderer === null
          ? h('div', { class: 'skin-host-unsupported', 'data-type': device.type }, '')
          : (selection.renderer(device, tokens, activeCtx()) as VNode);
      // #1194: a link on this device makes the host cell a navigation affordance —
      // unless the skin declared that it draws the jump itself (#146).
      const link = skinOwnsLinks.value ? undefined : deviceLinks.value.get(deviceId);
      const deco = decorateLink(link, linkActive(link), linkable.value, linkLabel(link));
      return h(
        'div',
        {
          // Styling hook for a skin is the `[data-link]` attribute the decoration
          // stamps — no extra class (a class nothing styles is dead markup).
          class: 'skin-host-cell',
          'data-id': deviceId,
          ...deco.attrs,
          style: Object.keys(deco.style).length > 0 ? deco.style : undefined,
        },
        [body, ...deco.extra],
      );
    }

    /**
     * The page the host currently SHOWS. Before anything has navigated, a
     * tree-backed source shows the first page of the tree — the same fallback
     * the {@link PageHost} reports as `currentPageId`. Both must read the same
     * value, or a link onto the page you are already on would announce itself as
     * inactive until the first navigation (#146).
     */
    function shownPageId(): string | null {
      if (props.currentPage) return props.currentPage;
      if (currentPageId.value) return currentPageId.value;
      // The floor has no "page shown" at all, so nothing is active there — only a
      // page-owning skin gets the tree's first page handed to it.
      return skin.value.page ? firstPageId(navTree.value) : null;
    }

    /** Is a link's target the current page or an ancestor of it? (host state) */
    function linkActive(link: PageLink | undefined): boolean {
      return link ? isLinkActive(link, shownPageId(), navTree.value) : false;
    }

    /**
     * The accessible name of a page link's stretched anchor (#1194). The host
     * owns the navigation affordance (golden rule 4), so it owns the label too:
     * the text comes from the host's locale files, the target's plain name from
     * the nav tree. Without a tree (the static floor) there is no name to show,
     * so the generic wording is used — never a raw node id.
     */
    function linkLabel(link: PageLink | undefined): string {
      if (!link) return '';
      // Live nav tree first (a real backend knows the node's own name), then the
      // page layer's translated titles, and only then the generic wording — so a
      // shipped static page still announces WHICH page a link goes to.
      const name =
        navNodeName(navTree.value, link.targetNodeId) ??
        props.pageNames?.[link.targetNodeId] ??
        null;
      return name ? translate('links.goToPage', { page: name }) : translate('links.goToLinkedPage');
    }


    return () => {
      const sk = skin.value;
      const lay = layout.value;

      // A skin that owns the whole page (nav + composed layers + popups) renders
      // it entirely; the host supplies state + services + content tiles. Live data
      // drives it — with no nav (the mock) the skin's page renderer gets an empty
      // tree and degrades. A skin without a page renderer falls through to the floor.
      if (sk.page) {
        const host: PageHost = {
          navTree: navTree.value,
          currentPageId: shownPageId(),
          navigate: store.navigate,
          layersFor: (id) => store.layersFor(id),
          renderTile,
          openPopups: openPopups.value,
          openPopup,
          closePopup,
          // Page links as a HOST service (contract v1.12, #146). Without these a
          // page-owning skin that wanted to honour `LayerItem.link` would have to
          // descend the navTree, read `access` and walk the ancestor chain itself
          // — exactly what golden rule 4 forbids. The skin asks; the host knows.
          resolveLink: (link) => store.linkOutcome(link),
          followLink: (link) => store.followLink(link),
          isLinkActive: (link) => linkActive(link),
          linkLabel: (link) => linkLabel(link),
        };
        return sk.page(host) as VNode;
      }

      // Render one cell: type-addressed dispatch + AA tokens + the role/group
      // data the skin's CSS honours. Order is the array order (the floor).
      const renderCell = (item: (typeof lay.items)[number]): VNode => {
        // resolveLayout already proved the device exists; re-read it for render.
        const device = liveDevice(item.id) as Device;

        // A1: type-addressed dispatch. Throws a gap for an undeclared type.
        const selection = selectTile(sk.tiles, sk.manifest, device.type);

        // AA tokens + the renderer sandbox ctx (golden rules 4/6).
        const tokens = makeTokens(props.theme, device.accent);

        // A declared-unsupported type renders a quiet, labelled placeholder
        // (a declared gap, not a crash — golden rule 3).
        const body =
          selection.renderer === null
            ? h('div', { class: 'skin-host-unsupported', 'data-type': device.type }, '')
            : (selection.renderer(device, tokens, activeCtx()) as VNode);

        // #1194: an item carrying a page link becomes a navigation affordance —
        // the host stamps the target + the (author-chosen) active indicator; the
        // gesture seam turns a tap on an otherwise non-interactive tile into
        // `navigate`. Without a link this is inert and the cell is unchanged.
        const deco = decorateLink(item.link, linkActive(item.link), linkable.value, linkLabel(item.link));

        return h(
          'div',
          {
            key: item.id,
            class: 'skin-host-cell',
            // The host resolves the device id of a tapped tile from the cell
            // (OverviewGrid → tileIdFor → cell.dataset.id), so the gesture maps to
            // a canonical action. Without it, every tap resolves no id → no-op.
            'data-id': item.id,
            'data-group': item.group,
            'data-role': item.role,
            ...deco.attrs,
            // Placement: a position-honouring skin (layering W4) gets an absolute
            // box from the author's x/y/w/h, scaled by `--vz-pos-unit` (the skin
            // sets the unit: 1px for pixel-exact Edomi, a cell size for a grid).
            // Else a role-honouring grid gets its span footprint; a plain list none.
            style: {
              ...(lay.honorsPosition && item.position
                ? {
                    position: 'absolute',
                    left: `calc(var(--vz-pos-unit, 8px) * ${item.position.x})`,
                    top: `calc(var(--vz-pos-unit, 8px) * ${item.position.y})`,
                    width: `calc(var(--vz-pos-unit, 8px) * ${item.position.w})`,
                    height: `calc(var(--vz-pos-unit, 8px) * ${item.position.h})`,
                  }
                : lay.honorsRole
                  ? { gridColumn: `span ${item.span.c}`, gridRow: `span ${item.span.r}` }
                  : {}),
              ...deco.style,
            },
          },
          [body, ...deco.extra],
        );
      };

      // Positioned model (layering W4): one absolute canvas, each item placed by
      // its author box. Room grouping is not a spatial concern here — the author's
      // coordinates are the floor. The canvas height sizes to the lowest box so
      // the page scrolls. A skin without positions on its items degrades to the
      // top-left (no box → no absolute style), never broken.
      if (lay.honorsPosition) {
        const maxBottom = lay.items.reduce(
          (m, it) => (it.position ? Math.max(m, it.position.y + it.position.h) : m),
          0,
        );
        return h(
          'div',
          {
            class: ['skin-host', 'skin-host-model-positioned'],
            style: { position: 'relative', height: `calc(var(--vz-pos-unit, 8px) * ${maxBottom})` },
          },
          lay.items.map(renderCell),
        );
      }

      // List model (e.g. terminal): one flat column.
      if (lay.model !== 'grid') {
        return h('div', { class: ['skin-host', 'skin-host-model-list'] }, lay.items.map(renderCell));
      }

      // Grid model: one grid PER room block so each room lays out cleanly (uniform
      // rows within a block) and reads as a separate room via the gap between
      // blocks (A4 — order + grouping are the floor). The clamped column count is
      // exposed once on the host and inherited by every room grid.
      const blocks: { group: string; items: (typeof lay.items)[number][] }[] = [];
      for (const item of lay.items) {
        const last = blocks[blocks.length - 1];
        if (last && last.group === item.group) last.items.push(item);
        else blocks.push({ group: item.group, items: [item] });
      }

      return h(
        'div',
        {
          class: ['skin-host', 'skin-host-grouped'],
          style: { '--skin-host-columns': String(cols.value) },
        },
        blocks.map((blk) =>
          h(Fragment, { key: `block-${blk.group}` }, [
            // Per-group divider (shell-owned chrome): the `#roomDivider` slot
            // override, else the default RoomDivider. The grouping gap stays the
            // floor signal; the divider is the additive, ignorable label (#116).
            roomDivider ? roomDivider({ room: blk.group, count: blk.items.length }) : null,
            h(
              'div',
              { key: `grid-${blk.group}`, class: 'skin-host-model-grid', 'data-group': blk.group },
              blk.items.map(renderCell),
            ),
          ]),
        ),
      );
    };
  },
});
