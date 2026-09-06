import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';

import { useIdleReturnHome, IDLE_INTERACTION_EVENTS } from './useIdleReturnHome';

/**
 * app/useIdleReturnHome — the host's single idle timer (A7, Issue #144).
 *
 * Kiosk behaviour, tested on the clock rather than on the wall: fake timers stand
 * in for real waiting, but the sequence is the real one — the timer runs, an
 * interaction resets it, the span elapses, the host acts. The composable itself
 * knows nothing about pages or routers; it only reports "nobody has touched this
 * for N seconds", which is what makes it testable in isolation.
 */

/**
 * Every wrapper mounted in a test, so it can be torn down afterwards. The
 * composable listens on `document`: a wrapper left mounted would keep reacting
 * to the NEXT test's interactions and re-arm its timer there.
 */
const mounted: { unmount(): void }[] = [];

/** Mount a throwaway host component around the composable. */
function mountIdle(seconds: number) {
  const onReturnHome = vi.fn();
  const secondsRef: Ref<number> = ref(seconds);
  const wrapper = mount(
    defineComponent({
      name: 'IdleHost',
      setup() {
        useIdleReturnHome(secondsRef, onReturnHome);
        return () => h('div', { class: 'idle-host' }, h('button', { class: 'deep' }, 'x'));
      },
    }),
    { attachTo: document.body },
  );
  mounted.push(wrapper);
  return { wrapper, onReturnHome, secondsRef };
}

/** Dispatch a real, bubbling interaction event from an element. */
function interact(type: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
}

/**
 * The idle SPANS this composable armed — deliberately NOT a leak check.
 *
 * It answers one question: "was the idle timer started, and with which handle".
 * The filter is the delay (the span is always seconds, never milliseconds), which
 * is what makes the answer unambiguous among the timers jsdom and the runner
 * schedule themselves — and which also makes it blind to anything short. A stray
 * `setTimeout(…, 500)` armed next to the span passes it without a mark. So
 * "nothing leaked" is measured separately and by COUNT, in the unmount test
 * below; do not read a green here as an absence of leaks.
 */
function idleSpansArmed(spy: any): { delay: number; id: unknown }[] {
  return spy.mock.calls
    .map((call: unknown[], i: number) => ({ delay: Number(call[1]), id: spy.mock.results[i]?.value }))
    .filter((c: { delay: number }) => Number.isFinite(c.delay) && c.delay >= 1000);
}

/** Drive `document.hidden` + the visibilitychange event jsdom does not fire itself. */
function setVisibility(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useIdleReturnHome', () => {
  let setTimeoutSpy: any;
  let clearTimeoutSpy: any;

  beforeEach(() => {
    // `requestAnimationFrame` is NOT in vitest's default `toFake` list
    // (setTimeout/clearTimeout/setInterval/clearInterval/setImmediate/
    // clearImmediate/Date), so `vi.getTimerCount()` is blind to an rAF loop
    // unless it is faked here — measured: a self-rescheduling rAF that is never
    // cancelled passed the leak test unnoticed. Faked explicitly rather than in
    // vitest.config.ts so the guarantee lives next to the test that claims it.
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
    setVisibility(false);
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
  });
  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns home after the configured span of no interaction', () => {
    const { onReturnHome } = mountIdle(60);

    vi.advanceTimersByTime(59_999);
    expect(onReturnHome).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when disabled (0) — the timer is never even started', () => {
    const { onReturnHome } = mountIdle(0);

    expect(idleSpansArmed(setTimeoutSpy)).toHaveLength(0);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onReturnHome).not.toHaveBeenCalled();
  });

  it.each([...IDLE_INTERACTION_EVENTS])('a %s resets the timer', (type) => {
    const { onReturnHome } = mountIdle(60);

    vi.advanceTimersByTime(50_000);
    interact(type);
    vi.advanceTimersByTime(50_000);
    expect(onReturnHome).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('counts the interactions listed for A7 and nothing accidental', () => {
    expect([...IDLE_INTERACTION_EVENTS]).toEqual([
      // raw input …
      'pointerdown',
      'keydown',
      'touchstart',
      'wheel',
      // … plus the seams the host dispatches its canonical actions from
      // (DetailModalHost: onClick/onInput/ionInput/ionChange; OverviewGrid:
      // onClick/onKeydown/onPointerdown).
      'click',
      'input',
      'ionChange',
    ]);
    // The two exclusions, both for the same reason — the host itself can cause
    // them, so counting them would let the panel feed its own timer:
    //   `scroll`   — AccessGate.vue:64 calls `form.scrollIntoView?.(…)`.
    //   `ionInput` — @ionic/core's ion-range emits it from its `value` PROP
    //                watcher, so every backend-driven value change fires one.
    // (`wheel` and `ionChange` never fire host-caused, hence their place above.)
    expect([...IDLE_INTERACTION_EVENTS]).not.toContain('scroll');
    expect([...IDLE_INTERACTION_EVENTS]).not.toContain('ionInput');
  });

  it('a programmatic ionInput does NOT reset the timer — it is not a person', () => {
    // `ion-range` emits `ionInput` from its `value` PROP WATCHER, not only from a
    // gesture. Verified in the shipped @ionic/core 8.8.9 `components/ion-range.js`:
    //   static get watchers(){ … value:[{valueChanged:0}] }
    //   valueChanged(e,t){ this.compareValues(e,t) && this.ionInput.emit({value:this.value}), … }
    //   ionInput = a(this,"ionInput",7)      // 7 = bubbles|cancelable|composed
    // The ionic skin binds the live value as that prop (LightDetail.ts:92
    // `h("ion-range", { value: dim, … })`), and the host re-renders the open
    // detail on every store patch (DetailModalHost.vue:96 is a computed over
    // `store.byId`). So a wall panel polling a backend every 4 s
    // (obs-datasource.ts:109 POLL_INTERVAL_MS = 4000) fed its own idle timer
    // with the LIGHT changing by itself and never returned home.
    //
    // `ionChange` is a different animal and stays: `emitValueChange()` is its only
    // emitter, reached only from `handleKeyboard`, `onStart` and `onEnd`.
    const { wrapper, onReturnHome } = mountIdle(60);
    const deep = wrapper.find('.deep').element;

    vi.advanceTimersByTime(50_000);
    interact('ionInput', deep);
    vi.advanceTimersByTime(10_000);

    // The span must have run out regardless of the machine-made event.
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('a wheel is a user interaction and resets the timer', () => {
    // Desktop browser or a panel with a mouse: somebody reads a long page and
    // scrolls with the wheel only — no pointerdown, no key. Unlike `scroll`,
    // `wheel` is STRICTLY user input (nothing the host does fires it), so it can
    // be counted without the timer ever feeding itself.
    const { onReturnHome } = mountIdle(60);

    vi.advanceTimersByTime(50_000);
    interact('wheel');
    vi.advanceTimersByTime(50_000);
    expect(onReturnHome).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('a plain element.click() resets the timer — the AT/voice-control path', () => {
    // `HTMLElement.click()` is what a screen reader invoke, a voice command and
    // every programmatic dispatch produce: a real `click`, with NO preceding
    // `pointerdown`. It runs the canonical action (DetailModalHost/OverviewGrid
    // both hang their dispatch on `onClick`), so it MUST also reset the timer —
    // otherwise half the acceptance criterion holds only for a mouse.
    const { wrapper, onReturnHome } = mountIdle(60);
    const button = wrapper.find('.deep').element as HTMLElement;

    vi.advanceTimersByTime(50_000);
    button.click();
    vi.advanceTimersByTime(50_000);
    expect(onReturnHome).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it.each(['input', 'ionChange'])('a canonical action delivered as %s resets the timer', (type) => {
    // The other dispatch seams of DetailModalHost.vue: `onInput` for native
    // controls and the exact-cased `ionChange` an ion-range emits on release.
    // Assistive tech can drive a slider without ever firing `pointerdown`.
    // (`ionInput` is deliberately absent — see the ionInput test above.)
    const { wrapper, onReturnHome } = mountIdle(60);
    const deep = wrapper.find('.deep').element;

    vi.advanceTimersByTime(50_000);
    interact(type, deep);
    vi.advanceTimersByTime(50_000);
    expect(onReturnHome).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('sees an interaction a canonical action swallowed (capture phase, deep target)', () => {
    // Pins the CAPTURE phase. No control WE ship stops propagation (`grep -rn
    // "stopPropagation" apps/visu/src packages/` finds no production call), but
    // Ionic's do: `ion-toggle.js` has `onDivLabelClick = t => { t.stopPropagation() }`
    // and `ion-input.js` an `onClickCapture` that stops it — and this app renders
    // both. On top of that, skins are pluggable third-party code. Dropping
    // `capture` from the listener options fails exactly here.
    const { wrapper, onReturnHome } = mountIdle(60);
    const deep = wrapper.find('.deep').element;
    deep.addEventListener('pointerdown', (ev) => ev.stopPropagation());

    vi.advanceTimersByTime(50_000);
    interact('pointerdown', deep);
    vi.advanceTimersByTime(50_000);
    expect(onReturnHome).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm itself after returning home — the next interaction does', () => {
    const { onReturnHome } = mountIdle(60);

    vi.advanceTimersByTime(60_000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
    // No self-rescheduling loop on a panel that is already resting.
    expect(idleSpansArmed(setTimeoutSpy)).toHaveLength(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onReturnHome).toHaveBeenCalledTimes(1);

    interact('pointerdown');
    vi.advanceTimersByTime(60_000);
    expect(onReturnHome).toHaveBeenCalledTimes(2);
  });

  it('pauses while the document is hidden and restarts fresh when it is shown', () => {
    const { onReturnHome } = mountIdle(60);

    vi.advanceTimersByTime(30_000);
    const armedBeforeHiding = idleSpansArmed(setTimeoutSpy);
    setVisibility(true);
    // The pending span is dropped, and no new one is armed while hidden.
    expect(clearTimeoutSpy).toHaveBeenCalledWith(armedBeforeHiding[0].id);
    expect(idleSpansArmed(setTimeoutSpy)).toHaveLength(armedBeforeHiding.length);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onReturnHome).not.toHaveBeenCalled();

    setVisibility(false);
    // fresh span, not the 30 s remainder
    vi.advanceTimersByTime(59_999);
    expect(onReturnHome).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('arms nothing when it mounts into an ALREADY hidden document', () => {
    // A panel whose app starts in a background tab: `visibilitychange` never
    // fires, so only the arming check itself can keep the span from running down
    // unseen. The first span must begin when the document becomes visible.
    setVisibility(true);
    const { onReturnHome } = mountIdle(60);
    expect(idleSpansArmed(setTimeoutSpy)).toHaveLength(0);

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onReturnHome).not.toHaveBeenCalled();

    setVisibility(false);
    vi.advanceTimersByTime(59_999);
    expect(onReturnHome).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('clears a pending timer when the setting is switched off', async () => {
    const { onReturnHome, secondsRef } = mountIdle(60);

    vi.advanceTimersByTime(30_000);
    const armed = idleSpansArmed(setTimeoutSpy);
    secondsRef.value = 0;
    await nextTick();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(armed[0].id);
    expect(idleSpansArmed(setTimeoutSpy)).toHaveLength(armed.length);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onReturnHome).not.toHaveBeenCalled();
  });

  it('restarts with a fresh span when the setting changes', async () => {
    const { onReturnHome, secondsRef } = mountIdle(60);

    vi.advanceTimersByTime(50_000);
    secondsRef.value = 20;
    await nextTick();
    vi.advanceTimersByTime(19_999);
    expect(onReturnHome).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReturnHome).toHaveBeenCalledTimes(1);
  });

  it('leaks nothing it can see — one pending timer while mounted, none after unmount', () => {
    // COUNTED, not filtered by delay. A delay filter answers "was the idle span
    // armed" and stays green next to a stray short timer (a debounce, a retry) —
    // precisely the kind of leak that keeps a torn-down panel alive.
    //
    // SCOPE, stated honestly rather than overclaimed: this sees every timer
    // vitest is faking for this file — which, thanks to the `toFake` list in
    // `beforeEach`, includes `requestAnimationFrame`. It does NOT see a leak on
    // some other axis, so the listener half is asserted separately below rather
    // than assumed: a `window` listener left behind would keep this count at zero
    // and still keep the panel reacting after unmount.
    const windowListeners = vi.spyOn(window, 'addEventListener');
    const baseline = vi.getTimerCount();
    const { wrapper } = mountIdle(60);
    expect(vi.getTimerCount()).toBe(baseline + 1);

    // Everything it subscribes to sits on `document`, which `onUnmounted` cleans
    // symmetrically. Nothing is parked on `window` — the one place the unmount
    // path does not touch and the timer count cannot report.
    expect(windowListeners).not.toHaveBeenCalled();

    // Re-arming REPLACES the span; it never stacks a second timer beside it.
    interact('pointerdown');
    interact('keydown');
    interact('click');
    expect(vi.getTimerCount()).toBe(baseline + 1);

    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('removes its listeners on unmount — a later interaction re-arms nothing', () => {
    const { wrapper, onReturnHome } = mountIdle(60);
    const armed = idleSpansArmed(setTimeoutSpy);
    expect(armed).toHaveLength(1);

    wrapper.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(armed[0].id);

    // A stray interaction after unmount must not re-arm the removed listener.
    interact('pointerdown');
    expect(idleSpansArmed(setTimeoutSpy)).toHaveLength(1);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(onReturnHome).not.toHaveBeenCalled();
  });
});
