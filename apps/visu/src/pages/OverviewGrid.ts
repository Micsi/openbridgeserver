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
import { useRouter } from 'vue-router';

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
 *
 * Exported because the page-link policy depends on it: `linksDeliverable`
 * (core/links) treats an undeclared `tap` as deliverable, which is only true
 * while this default IS {@link LINK_TAP_TARGET}. The two literals live in two
 * files, so a test pins them together rather than trusting they stay in step.
 */
export const DEFAULT_GESTURES = { tap: 'action', longPress: 'openDetail' } as const;

/** Resolve the device id a DOM target belongs to (its enclosing tile cell). */
function tileIdFor(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('.skin-host-cell');
  return cell?.dataset.id ?? null;
}

/**
 * The page-link target the enclosing tile cell carries (#1194), or null. The host
 * stamped `data-link` on the cell (SkinHost → decorateLink); the skin only drew
 * the tile inside it, so a link is never skin state.
 */
function linkTargetFor(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest<HTMLElement>('.skin-host-cell');
  // A cell the host marked as an undeliverable link (the skin binds `tap` to
  // something other than `action`) never fires — the gap is declared on the
  // cell, and honouring it here keeps the two halves from disagreeing.
  if (!cell || cell.dataset.linkUnsupported === 'true') return null;
  return cell.dataset.link ?? null;
}

/**
 * Does the tapped element sit inside a control the SKIN marked with an action
 * (#1194)? This is the "has a click function of its own" test, and it is
 * deliberately NOT `parseIntent() !== null`: a marker the host does not (yet)
 * dispatch — the camera's `refresh`, a media transport — is still the tile's own
 * control, and a page link must never steal its tap. A marked-but-undispatched
 * action stays the host's existing no-op.
 */
function marksOwnAction(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-action]') !== null;
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
    /** The page this grid renders, for the link active-indicator (#1194). Only
     *  the static/routed floor passes one; with an external floor the host's own
     *  `store.currentPageId` decides. */
    currentPage: { type: String, default: undefined },
  },
  setup(props) {
    const store = useDeviceStore();
    const actionStore = store as unknown as ActionStore;
    const host = inject(HOST_KEY, null);
    // The router is the second half of the host's navigation: `store.navigate`
    // owns the state, and a statically routed page also has to move the URL. A
    // standalone mount (unit test) has no router — links then move state only.
    const router = useRouter();

    // The interaction model is the skin's declaration merged onto the default
    // (author-time decision – no runtime skin switch). A skin that declares no
    // `gestures` keeps the backward-compatible DEFAULT_GESTURES.
    const skin = resolveSkin(props.skin);
    const gestures: SkinGestures = { ...DEFAULT_GESTURES, ...(skin.manifest.gestures ?? {}) };

    /** Tile under the current long-press (resolved on pointerdown). */
    let pressedId: string | null = null;

    /**
     * Follow the page link a cell carries (#1194) — the host action behind a tap
     * on a tile that has NO click function of its own (the author's example: a
     * small camera tile). The store resolves it exactly like the V1 link widget
     * (access along the `parent_id` chain, PIN gate on a `protected` target,
     * LOCATION → first visible page) and owns the resulting state; here we only
     * add the routed half for the statically routed pages.
     *
     * Returns true when the link was handled, so the caller can stop.
     */
    function followLink(targetNodeId: string): boolean {
      const outcome = store.followLink({ targetNodeId });
      // A gated target stays gated (the PIN path), an unknown one is a no-op —
      // in neither case do we move the URL onto the target page.
      if (outcome.kind !== 'navigate') return true;
      if (router?.hasRoute(outcome.pageId)) {
        void router.push({ name: outcome.pageId });
      }
      return true;
    }

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
          if (!intent) {
            // #1194: nothing marked here, so this element has no click function of
            // its own — if it carries a page link, jump. A tile control that DOES
            // mark an action keeps winning even when the host dispatches nothing
            // for it, and without a link this stays the previous no-op.
            if (marksOwnAction(ev.target)) return;
            const linkTarget = linkTargetFor(ev.target);
            if (linkTarget) followLink(linkTarget);
            return;
          }
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

    /**
     * Keyboard equivalent of a tap on a linked tile (#1194). The host made the
     * cell focusable with `role="link"`, and a `div` does not fire a click on
     * Enter/Space by itself — so the host maps the key here. Only cells that
     * actually carry a link react; everything else keeps its previous behaviour.
     */
    function onKeydown(ev: KeyboardEvent): void {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      // A control inside the tile (a marked action) owns its own key handling.
      if (marksOwnAction(ev.target)) return;
      const linkTarget = linkTargetFor(ev.target);
      if (!linkTarget) return;
      ev.preventDefault();
      followLink(linkTarget);
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
          onKeydown,
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
            currentPage: props.currentPage,
          }) as VNode,
        ],
      );
  },
});
