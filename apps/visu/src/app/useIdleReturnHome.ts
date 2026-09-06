/**
 * app/useIdleReturnHome — the host's single idle timer (A7, Issue #144).
 *
 * For Wand-/Kiosk-Betrieb the Visu should fall back to a defined resting state
 * after a while without anybody touching it, instead of staying on whatever
 * detail page the last person left open. This composable is the timing half of
 * that: it knows nothing about pages, routers or dialogs — it only reports
 * "nobody has interacted for N seconds". What that MEANS is the caller's
 * (AppShell's) decision, which keeps the rule "the host owns navigation" in one
 * place and this piece testable on its own.
 *
 * Goldene Regel 4: the timer lives in the host, never in a skin. A skin knows
 * nothing about the timeout and holds no part of its state.
 *
 * Design decisions worth keeping:
 *
 *  - **ONE timer.** A single `setTimeout` that is cleared and re-armed, not an
 *    interval polling a "last interaction" timestamp. Nothing runs while the
 *    feature is off or the app is hidden, and nothing survives unmount.
 *  - **Interactions are listened for on `document`** — that is what reaches the
 *    teleported `ion-modal`/`ion-popover` bodies, which Ionic renders at `<body>`
 *    OUTSIDE the shell's subtree. This is the load-bearing half, and it is the
 *    document, not the phase, that carries it.
 *  - **…in the CAPTURE phase.** No FIRST-PARTY control stops propagation
 *    (`grep -rn "stopPropagation" apps/visu/src packages/` is empty), but a
 *    shipped dependency the app renders does: @ionic/core's `ion-toggle.js`
 *    carries `onDivLabelClick = t => { t.stopPropagation() }`. Add that skins are
 *    pluggable third-party code the host never reviews, and a bubble-phase
 *    listener would be at the mercy of every control in the tree. Capture runs
 *    before all of them on the way down. Pinned by a test ("sees an interaction a
 *    canonical action swallowed"), so removing `capture` fails the suite rather
 *    than quietly regressing.
 *  - **The canonical actions (A2 #98) need no second seam** because the events
 *    they are dispatched FROM are in {@link IDLE_INTERACTION_EVENTS} — see the
 *    list's own note; that is a property of the list, not of the capture phase.
 *  - **No self-rescheduling after firing.** Once the host is back at its resting
 *    state there is nothing left to return from; the next interaction re-arms the
 *    timer. A panel nobody touches therefore holds no timer at all.
 */

import { onMounted, onUnmounted, watch, type Ref } from 'vue';

/**
 * The events that count as "somebody is using this panel" (A7 spec).
 *
 * Two groups, and the second one is not optional decoration — the acceptance
 * criterion names "Pointer/Touch/Keyboard **+ kanonische Aktionen**":
 *
 * *Raw input.* `pointerdown` covers mouse, pen and — in every browser with
 * Pointer Events — touch; `touchstart` is the fallback for engines that fire only
 * touch events; `keydown` covers keyboard and most remote controls; `wheel` is
 * the desktop/panel-with-a-mouse case (see below).
 *
 * *The canonical-action seams.* The host dispatches a canonical action from
 * `onClick`/`onInput`/`ionInput`/`ionChange` (DetailModalHost.vue) and
 * `onClick`/`onKeydown`/`onPointerdown` (pages/OverviewGrid.ts). Listing only the
 * raw-input half was a real gap, not a theoretical one: a bare `element.click()`
 * — which is what a screen-reader invoke, a voice command and every programmatic
 * dispatch produce — runs the canonical action with NO preceding `pointerdown`,
 * so the action fired while the timer kept counting down. Same for a native
 * control an assistive technology drives: `input` without a pointer.
 *
 * **The seam list is NOT copied wholesale, and `ionInput` is the reason.** The
 * test for admission is not "does the host dispatch from it" but "can only a
 * PERSON cause it". Checked against the shipped @ionic/core 8.8.9 source rather
 * than assumed:
 *
 *  - `ionChange` — admitted. Its only emitter is `emitValueChange()`, reached
 *    only from `handleKeyboard`, `onStart` and `onEnd` (ion-range.js); `ion-toggle`
 *    likewise emits it only from `toggleChecked()`, reachable only from
 *    `onClick`/`onKeyDown`/drag. User-only.
 *  - `ionInput` — REJECTED, and it used to be in this list. `ion-range` declares
 *    `value` as a watched prop (`static get watchers(){ … value:[{valueChanged:0}] }`)
 *    and `valueChanged(e,t){ this.compareValues(e,t) && this.ionInput.emit(…) }`,
 *    created as `a(this,"ionInput",7)` — 7 = bubbles|cancelable|composed, so it
 *    reaches this document listener through the shadow boundary. The ionic skin
 *    binds the live device value straight to that prop (LightDetail.ts:92,
 *    `h("ion-range", { value: dim, … })`) and the host re-renders the open detail
 *    on every store patch (DetailModalHost.vue:96 is a computed over
 *    `store.byId`). A wall panel polling a real backend every 4 s
 *    (obs-datasource.ts:109 `POLL_INTERVAL_MS = 4000`) with a light detail open
 *    therefore fed its own idle timer with the LIGHT CHANGING BY ITSELF and never
 *    returned home — the acceptance criterion broken in precisely the kiosk case
 *    A7 was written for. Pinned twice: "a programmatic ionInput does NOT reset the
 *    timer" here, and the hour-long unattended-panel test in AppShell.idle.spec.ts.
 *    Nothing is lost by dropping it — a pointer drag on a slider already brings
 *    `pointerdown` plus `ionChange` on release, and keyboard/AT operation brings
 *    `keydown` plus `ionChange` from `handleKeyboard`. (`event.isTrusted` is no
 *    substitute: the USER-triggered `ionChange` is a synthetic `CustomEvent` too,
 *    so it is `false` for both.)
 *
 * A native `input` event stays in: it is not emitted for a programmatic
 * `.value =` write, so a host-driven update cannot produce one.
 *
 * `scroll` is out for the same "only a person may cause it" reason, and it has a
 * real callsite to prove it (AccessGate.vue:64 `form.scrollIntoView?.(…)`), plus
 * momentum after the finger has left. `wheel`, by contrast, never fires for
 * host-caused scrolling — it is strictly user input — and it closes a real case
 * the spec's literal list misses: the Visu in a desktop browser or on a panel
 * with a mouse, somebody reading a long page and scrolling with the wheel only,
 * sent back to the start page mid-sentence.
 */
export const IDLE_INTERACTION_EVENTS = [
  'pointerdown',
  'keydown',
  'touchstart',
  'wheel',
  'click',
  'input',
  'ionChange',
] as const;

/**
 * Run the idle timer for as long as the calling component is mounted.
 *
 * Returns nothing on purpose. It used to hand back a `reset()` handle "the host
 * can also call", which no caller ever did — the composable arms itself on mount
 * and every reset comes from a real interaction, so the handle only widened the
 * surface without a user for it.
 *
 * @param seconds  the configured span; `0` (or anything not positive) = disabled.
 * @param onReturnHome  what the host does when the span elapses. Called at most
 *   once per idle period; the host decides whether that means navigating,
 *   closing a dialog, or nothing at all.
 */
export function useIdleReturnHome(seconds: Ref<number>, onReturnHome: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  /** (Re)arm the timer — unless the feature is off or the app is not visible. */
  function reset(): void {
    clear();
    const span = seconds.value;
    if (!Number.isFinite(span) || span <= 0) return;
    // Paused while hidden: a panel in the background is not "idle in front of
    // someone", and the span should be measured from the moment it is seen again.
    if (typeof document !== 'undefined' && document.hidden) return;
    timer = setTimeout(fire, span * 1000);
  }

  function fire(): void {
    timer = undefined;
    onReturnHome();
    // No re-arm: the host is at its resting state now. The next interaction
    // starts a new span, so an untouched panel keeps no timer running.
  }

  function onVisibilityChange(): void {
    // Hidden → drop the pending timer; visible again → start a FRESH span
    // (`reset` does both, since it clears first and re-arms only when visible).
    reset();
  }

  onMounted(() => {
    for (const type of IDLE_INTERACTION_EVENTS) {
      document.addEventListener(type, reset, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    reset();
  });

  onUnmounted(() => {
    for (const type of IDLE_INTERACTION_EVENTS) {
      document.removeEventListener(type, reset, { capture: true });
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clear();
  });

  // A changed setting takes effect at once: switching it off clears the pending
  // timer (no leak), any other change restarts with the new span.
  watch(seconds, reset);
}
