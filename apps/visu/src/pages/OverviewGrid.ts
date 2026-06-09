/**
 * pages/OverviewGrid — the host-API-aware grid descendant of the overview page.
 *
 * It must be a *child* of DetailModalHost so it can reach the host API via
 * `inject(HOST_KEY)` (DetailModalHost `provide`s it to its slot subtree). The
 * grid is the single seam that turns a gesture on a skin tile into a canonical
 * action: a tap dispatches the tile's `data-action` onto the core store, a
 * long-press calls `openDetail`. The skin tiles only *mark* `data-action`; the
 * host owns the mapping and the state (Goldene Regel 4 — the skin owns no state).
 *
 * Implemented as a render component (not an SFC) because SkinHost is itself a
 * render component returning VNodes, and the grid is pure event-capture + render
 * dispatch — trivially unit-testable without a template.
 */
import { defineComponent, h, inject, type PropType, type VNode } from 'vue';

import SkinHost from '../skin-host/SkinHost';
import { useDeviceStore } from '../core/store';
import { parseIntent, dispatchIntent, type ActionStore } from '../skin-host/actions';
import { useLongPress } from '../core/useLongPress';
import { HOST_KEY } from '../app/DetailModalHost.vue';
import type { RoomGroup } from '../core/model';
import type { Theme } from '../core/tokens';

/** Resolve the device id a DOM target belongs to (its enclosing tile cell). */
function tileIdFor(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('.skin-host-cell');
  return cell?.dataset.id ?? null;
}

export default defineComponent({
  name: 'OverviewGrid',
  props: {
    /** The page's chosen skin key (author's decision — no runtime switch). */
    skin: { type: String, required: true },
    /** The ordered, grouped room blocks to render (the floor). */
    groups: { type: Array as PropType<readonly RoomGroup[]>, required: true },
    /** Active theme for AA-safe tokens. */
    theme: { type: String as PropType<Theme>, default: 'light' },
    /** Requested column count (clamped into the skin's window by the host). */
    columns: { type: Number, default: undefined },
  },
  setup(props) {
    const store = useDeviceStore();
    const actionStore = store as unknown as ActionStore;
    const host = inject(HOST_KEY, null);

    /** Tile under the current long-press (resolved on pointerdown). */
    let pressedId: string | null = null;

    const longPress = useLongPress((ev) => {
      if (pressedId !== null && host) host.openDetail(pressedId);
      ev.preventDefault?.();
    });

    function onClick(ev: MouseEvent): void {
      if (longPress.fired) return; // the long-press already handled this gesture
      const id = tileIdFor(ev.target);
      if (id === null) return;
      const intent = parseIntent(ev.target);
      if (!intent) return;
      // openDetail is a shell concern (the host owns the modal), not a store write.
      if (intent.action === 'openDetail') {
        if (host) host.openDetail(id);
        return;
      }
      dispatchIntent(actionStore, id, intent);
    }

    function onPointerdown(ev: PointerEvent): void {
      pressedId = tileIdFor(ev.target);
      longPress.onPointerdown(ev);
    }

    return () =>
      h(
        'div',
        {
          class: 'overview-grid',
          onClick,
          onPointerdown,
          onPointermove: longPress.onPointermove,
          onPointerup: longPress.onPointerup,
          onPointerleave: longPress.onPointerleave,
          onContextmenu: longPress.onContextmenu,
        },
        [
          h(SkinHost, {
            skin: props.skin,
            groups: props.groups,
            theme: props.theme,
            columns: props.columns,
          }) as VNode,
        ],
      );
  },
});
