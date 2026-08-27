/**
 * pages/OverviewGrid — the host-API-aware grid descendant of the overview page.
 *
 * It must be a *child* of DetailModalHost so it can reach the host API via
 * `inject(HOST_KEY)` (DetailModalHost `provide`s it to its slot subtree). The
 * grid is the single seam that turns a gesture on a skin tile into a canonical
 * action. The gesture Zielmodell is now *skin-manifest-getrieben* (Contract
 * v1.7): the skin declares which gesture maps to which {@link GestureTarget},
 * and the host applies it. A skin that declares nothing keeps the backward-
 * compatible {@link DEFAULT_GESTURES} (tap → action, long-press → openDetail).
 * The three targets are: `action` (dispatch the tile's marked `data-action`),
 * `openDetail` (open the detail surface), `presets` (open the position-preset
 * quick menu, falling back to the detail when the device has no presets). The
 * skin tiles only *mark* `data-action`; the host owns the mapping and the state
 * (Goldene Regel 4 – the skin owns no state; Daten=JSON, Verhalten=Code).
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
import { useDoubleTap } from '../core/useDoubleTap';
import { HOST_KEY } from '../app/DetailModalHost.vue';
import { resolveSkin } from '../skin-host/skins';
import type { RoomGroup } from '../core/model';
import type { Theme } from '../core/tokens';
import type { SkinGestures, GestureTarget } from '@obs/visu-contract';

/**
 * Backward-compatible default interaction model: a skin that declares no
 * `gestures` in its manifest keeps the pre-v1.7 behaviour – a single tap
 * dispatches the marked action, a long-press opens the detail. No `doubleTap`
 * and no `presets` unless a skin opts in by declaring them.
 */
const DEFAULT_GESTURES = { tap: 'action', longPress: 'openDetail' } as const;

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

    // The interaction model is the skin's declaration merged onto the default
    // (author-time decision – no runtime skin switch). A skin that declares no
    // `gestures` keeps the backward-compatible DEFAULT_GESTURES.
    const skin = resolveSkin(props.skin);
    const gestures: SkinGestures = { ...DEFAULT_GESTURES, ...(skin.manifest.gestures ?? {}) };

    /** Tile under the current long-press (resolved on pointerdown). */
    let pressedId: string | null = null;

    /**
     * Apply the {@link GestureTarget} a gesture is mapped to for a device. The
     * host owns the mapping and the state (golden rule 4 – the skin owns none).
     * `undefined` (a gesture the skin does not declare) is a no-op.
     */
    function applyGesture(target: GestureTarget | undefined, id: string, ev: Event): void {
      // A gesture the skin does not declare (undefined) is a no-op.
      if (!target) return;
      switch (target) {
        case 'action': {
          // Dispatch the tile's marked data-action. openDetail is a shell
          // concern (the host owns the modal), not a store write; every other
          // action is a canonical core write forwarded to the store.
          const intent = parseIntent(ev.target);
          if (!intent) return;
          if (intent.action === 'openDetail') host?.openDetail(id);
          else dispatchIntent(actionStore, id, intent);
          return;
        }
        case 'openDetail':
          host?.openDetail(id);
          return;
        case 'presets':
          // The preset quick menu applies only to a device that carries presets
          // (blind/jalousie) with a host that can open them; otherwise it falls
          // back to the detail surface (the fallback policy lives in the host).
          {
            const dev = store.byId(id);
            if (dev && 'presets' in dev && dev.presets?.length && host?.openPresets) {
              host.openPresets(id, ev);
            } else {
              host?.openDetail(id);
            }
          }
          return;
      }
    }

    const longPress = useLongPress((ev) => {
      if (pressedId !== null) applyGesture(gestures.longPress, pressedId, ev);
      ev.preventDefault?.();
    });

    const doubleTap = useDoubleTap((ev) => {
      // Double-tap applies the skin's doubleTap target. The default model
      // declares none, so applyGesture(undefined) makes it a no-op there.
      const id = tileIdFor(ev.target);
      if (id !== null) applyGesture(gestures.doubleTap, id, ev);
    });

    function onClick(ev: MouseEvent): void {
      // A completed long-press or double-tap already handled this gesture; do not
      // also dispatch the coinciding single tap.
      if (longPress.fired || doubleTap.fired) return;
      const id = tileIdFor(ev.target);
      if (id === null) return;
      // Single-tap applies the skin's `tap` target. With tap:'action' a tap on
      // an openDetail-marked element (e.g. the display-only Rolladen tile) now
      // opens the detail directly for mouse, touch AND keyboard – the old
      // detail===0 keyboard-only special case is gone, because keyboard
      // Enter/Space takes the same `action` path and so keeps working.
      applyGesture(gestures.tap, id, ev);
    }

    function onPointerdown(ev: PointerEvent): void {
      pressedId = tileIdFor(ev.target);
      longPress.onPointerdown(ev);
      doubleTap.onPointerdown(ev);
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
          onPointercancel: longPress.onPointercancel,
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
