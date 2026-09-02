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

import type { Device, NavNode, PageHost, PopupDescriptor } from '@obs/visu-contract';
import { makeTokens, type Theme } from '../core/tokens';
import { activeCtx } from '../core/ctx';
import { useDeviceStore } from '../core/store';
import { rooms as modelRooms, type RoomGroup } from '../core/model';
import { ROOM_DIVIDER_KEY } from '../app/shell/roomDivider';

import { resolveSkin } from './skins';
import { resolveLayout, clampColumns } from './layout';
import { selectTile } from './dispatch';

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
  },
  setup(props) {
    const store = useDeviceStore();

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
    const { navTree } = storeToRefs(store);
    const currentPage = ref<string | null>(null);
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
    function navigate(pageId: string): void {
      currentPage.value = pageId;
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
      return h('div', { class: 'skin-host-cell', 'data-id': deviceId }, [body]);
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
          currentPageId: currentPage.value ?? firstPageId(navTree.value),
          navigate,
          layersFor: (id) => store.layersFor(id),
          renderTile,
          openPopups: openPopups.value,
          openPopup,
          closePopup,
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
            // Placement: a position-honouring skin (layering W4) gets an absolute
            // box from the author's x/y/w/h, scaled by `--vz-pos-unit` (the skin
            // sets the unit: 1px for pixel-exact Edomi, a cell size for a grid).
            // Else a role-honouring grid gets its span footprint; a plain list none.
            style:
              lay.honorsPosition && item.position
                ? {
                    position: 'absolute',
                    left: `calc(var(--vz-pos-unit, 8px) * ${item.position.x})`,
                    top: `calc(var(--vz-pos-unit, 8px) * ${item.position.y})`,
                    width: `calc(var(--vz-pos-unit, 8px) * ${item.position.w})`,
                    height: `calc(var(--vz-pos-unit, 8px) * ${item.position.h})`,
                  }
                : lay.honorsRole
                  ? { gridColumn: `span ${item.span.c}`, gridRow: `span ${item.span.r}` }
                  : undefined,
          },
          [body],
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
