/**
 * core/store - the Pinia host store for the obs Visu mobile app (CO3, Issue #93).
 *
 * CONTRACT-v1 §6: **the host owns the device state.** This store is that single
 * owner. It seeds itself from a {@link DataSource}, subscribes to live feedback,
 * and exposes the canonical actions (toggle · setDim · setPosition · setSlat ·
 * lock · unlock · activateScene; alarm arm/disarm as a v1.1 stub).
 *
 * Each action follows the same seam (MIGRATION §4): it sends the canonical
 * intent through `dataSource.dispatch` **and** applies an optimistic local
 * update; the `subscribe` stream then writes the real backend Rückmeldungen
 * back into the same state. Today the MockDataSource resolves instantly and the
 * optimistic value is the truth; later a real transport confirms or corrects it.
 *
 * Goldene Regeln honoured here:
 *  - **State lives in core.** The reactive `byId` map is the single source of
 *    truth for live device state; renderers/skins never touch it directly.
 *  - **No mutation outside the actions.** Every write to the map happens inside
 *    a store action (or the subscribe handler the store installs); callers send
 *    intents, they never mutate a `Device`.
 *  - **Renderer rein:** this module imports no skin/renderer - only the model,
 *    the data/type contract, and the data source.
 *
 * Data and behaviour are kept apart: the seed data comes from the data source
 * (ultimately `model.ts`); the only code here is the action layer + the gesture
 * semantics the tiles need (`widgets.js → tap`/`stepBlind` lift the "dim===0 ⇒
 * 60 on enable" and the "locked blockiert die Kachel" rules here, not in skins).
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  Device,
  LightDevice,
  PageLink,
  PopupDescriptor,
  WidgetAction,
  WidgetPosition,
  PageLayer,
} from '@obs/visu-contract';
import type { DataSource, DevicePatch, PageGate } from './datasource';
import {
  MockDataSource,
  supportsAuth,
  supportsLinks,
  supportsPageAuth,
  supportsPositions,
} from './datasource';
import { firstNormalPageId, supportsLayering, type HostNavNode } from './obs/compose';
import { resolveLink, type LinkOutcome } from './links';

/** Brightness a light jumps to when switched on from a dimmed-to-zero state. */
const DEFAULT_ON_DIM = 60;

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

/** Narrowing helpers - read-only, no mutation. */
function isLockable(d: Device | undefined): d is Device & { locked: boolean } {
  return !!d && (d.type === 'blind' || d.type === 'jalousie');
}

/**
 * The host store. Keyed by device id; `devices` is the source-order list, `byId`
 * the lookup screens use. All writes go through the actions below.
 */
export const useDeviceStore = defineStore('devices', () => {
  /** Live state, keyed by id (state lives in core). */
  const state = ref(new Map<string, Device>());
  /** Active data source + its unsubscribe handle. */
  let source: DataSource = new MockDataSource();
  let unsubscribe: (() => void) | null = null;

  /** Devices in source order (read-only view). */
  const devices = ref<Device[]>([]);

  /**
   * Whether the active source brings its OWN device floor (a real backend tree),
   * as opposed to the {@link MockDataSource} whose floor is the static demo model
   * (`pages/pages` → `rooms`, with its mock ids + span/row hints). True for any
   * non-mock source (the {@link ObsDataSource}): the overview then derives its
   * room blocks from the live devices instead of the static model, so a real
   * backend (different ids) mounts instead of tripping the layout resolver.
   */
  const externalFloor = ref(false);

  /**
   * Per-device author positions (x/y/w/h, CONTRACT-v1.9 → layering W3). Empty for
   * a source without positions (the mock); populated from an external source that
   * carries them. A pixel-honouring skin reads these; the responsive skin ignores
   * them and lays out by room/role. The host owns this like the rest of the state.
   */
  const positions = ref<ReadonlyMap<string, WidgetPosition>>(new Map());

  /**
   * Per-device page links (CONTRACT-v1.11 → #1194). Empty for a source without
   * links (the mock, whose links live on the static layout entries). A tile whose
   * device appears here jumps to another visu page when it is tapped and has no
   * click function of its own. The host owns this like the rest of the state.
   */
  const links = ref<ReadonlyMap<string, PageLink>>(new Map());

  /**
   * Navigation tree (layering W3c): the visible PAGE/LOCATION hierarchy the active
   * source exposes. Empty for a source without layering (the mock). A skin renders
   * its own nav from this; the responsive skin ignores it.
   *
   * Typed as {@link HostNavNode}, so the page `kind` the source composed survives
   * up to here and {@link navigate} / {@link firstPageId} can act on it. `kind` is
   * optional, so a plain contract `NavNode` tree still fits (the mock, a test
   * fixture, and — once contract 1.14 lands — the contract type itself).
   */
  const navTree = ref<HostNavNode[]>([]);

  /**
   * The page the host currently shows (#1194 / layering W4). The HOST owns this,
   * never a skin (golden rule 4): a page-owning skin reads it through `PageHost`,
   * and the link action ({@link followLink}) is the only other writer besides the
   * routed page announcing itself. Null until something navigates — wer die
   * gezeigte Seite braucht (auch VOR der ersten Navigation), liest
   * {@link shownPageId}.
   */
  const currentPageId = ref<string | null>(null);

  /**
   * The popups the host currently has open (M5 R2-R8) and their auto-close timers.
   *
   * The HOST owns this, not a skin (golden rule 4) and not the render component:
   * a page-owning skin reads {@link openPopups} through its `PageHost` and calls
   * {@link openPopup}/{@link closePopup}, while {@link navigate} opens a popup
   * page here — both navigation paths (nav click and page link) therefore end in
   * the same state. Re-opening an already-open popup does NOT restart its timer
   * (R7); different popups are independent (R8).
   */
  const openPopups = ref<PopupDescriptor[]>([]);
  const popupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * The page a link tried to reach but which needs a PIN first (#1194). Set by
   * {@link followLink} INSTEAD of navigating, so a `protected` target lands on the
   * PIN path (the AccessGate entry for that page) and never blindly on the page.
   * Cleared on a successful navigation or once the PIN unlocked it.
   */
  const pendingGate = ref<string | null>(null);

  /**
   * Auth state (Welle L, guest-by-default). `authenticated` is false until a JWT
   * login succeeds; `username` is the name the login was submitted with (null
   * for a guest or a session restored from storage without a remembered name).
   * The host owns this state; the login UI only reads it and calls the actions.
   */
  const authenticated = ref(false);
  const username = ref<string | null>(null);

  /**
   * Page gates (Welle 3b, guest-by-default). The PIN-`protected` / `user`-level
   * pages that currently need a gate decision, as the active source reports them.
   * Empty for a guest-only source (the mock) and for a source without page auth.
   * The gate UI reads this and calls {@link authenticatePage}; the host owns it.
   */
  const pageGates = ref<PageGate[]>([]);

  function syncList(): void {
    devices.value = [...state.value.values()];
  }

  /** Apply a field patch to a device in the map. The ONLY place state is merged. */
  function merge(id: string, changes: Partial<Device>): void {
    const current = state.value.get(id);
    if (!current) return;
    const next = { ...current, ...changes } as Device;
    state.value.set(id, next);
    syncList();
  }

  /** Resolve a device by id (read-only). */
  function byId(id: string): Device | undefined {
    return state.value.get(id);
  }

  /**
   * Seed from a data source and subscribe to its live feedback. Idempotent:
   * a second call swaps the source and re-subscribes.
   */
  async function init(ds: DataSource = new MockDataSource()): Promise<void> {
    if (unsubscribe) unsubscribe();
    source = ds;
    // The mock's floor is the static demo model; any other source brings its own
    // device set (a real tree) → derive the overview floor from those devices.
    externalFloor.value = !(ds instanceof MockDataSource);
    const seed = await source.list();
    const map = new Map<string, Device>();
    for (const d of seed) {
      if (d.id) map.set(d.id, d);
    }
    state.value = map;
    syncList();
    // subscribe trägt echte Rückmeldungen ein (CONTRACT-v1 §6 / MIGRATION §4).
    unsubscribe = source.subscribe((patch: DevicePatch) => {
      merge(patch.id, patch.changes as Partial<Device>);
    });
    // Reflect the source's auth state (a restored session shows as logged in;
    // a guest/mock source is never authenticated). Never clears a name we hold
    // while still authenticated.
    authenticated.value = supportsAuth(source) ? source.isAuthenticated() : false;
    if (!authenticated.value) username.value = null;
    // Reflect the source's page gates (protected-without-PIN / user-while-guest);
    // a guest/mock source reports none, so the gate UI shows nothing.
    pageGates.value = supportsPageAuth(source) ? [...source.pageGates()] : [];
    // Author positions (layering W3): populated after list() built the map.
    positions.value = supportsPositions(source) ? source.positions() : new Map();
    // Navigation tree (layering W3c): the visible page hierarchy for skin-owned nav.
    navTree.value = supportsLayering(source) ? source.navTree() : [];
    // Page links (#1194): the jump targets the backend widgets declare.
    links.value = supportsLinks(source) ? source.links() : new Map();
  }

  /**
   * The ordered layer stack for a page (layering W3c): ancestors + own, root-first.
   * A skin overlays it; the mock/responsive path returns none. Read-through to the
   * active source — not reactive state, so a nav-driven skin queries on demand.
   */
  function layersFor(pageId: string): PageLayer[] {
    return supportsLayering(source) ? source.layersFor(pageId) : [];
  }

  /**
   * The popup descriptor of a popup page (M5 R2-R6), or null for anything else:
   * a normal page, a global include page, a LOCATION, an unknown id, or a source
   * that composes no popups at all. Read-through like {@link layersFor}.
   */
  function popupFor(pageId: string): PopupDescriptor | null {
    if (!supportsLayering(source) || !source.popupFor) return null;
    return source.popupFor(pageId);
  }

  /** The first NORMAL page of the nav tree — the page a page-owning skin starts on. */
  function firstPageId(): string | null {
    return firstNormalPageId(navTree.value);
  }

  /**
   * Die Seite, die der Host ZEIGT — von Anfang an bestimmt, nicht erst nach der
   * ersten Navigation.
   *
   * {@link currentPageId} haelt nur, was jemand ausdruecklich angesteuert hat,
   * und ist bis dahin null; gezeigt wird trotzdem schon eine Seite, naemlich die
   * erste normale des Baums ({@link firstPageId}), auf der ein seitenbesitzender
   * Skin startet. Wer die gezeigte Seite braucht — der `SkinHost` fuer den
   * `PageHost`, der Zugriffs-Hinweis fuer die Include-Stelle (M5 R15c, §2.1) —
   * liest DIESEN Wert. Mit `currentPageId` wirkte die Include-Zuordnung genau
   * auf der Startseite nicht, also im haeufigsten Zustand ueberhaupt: direkt
   * nach jedem Laden der App.
   *
   * Ein Popup wechselt die Seite nicht ({@link navigate}), also bewegt es diesen
   * Wert auch nicht — die Seite darunter bleibt die gezeigte.
   *
   * Grenze: ohne Baum (Mock, statischer Boden) ist der Wert null. Ein Skin OHNE
   * Seitenbesitz (der Boden) ueber einem Baum bekommt trotzdem die erste normale
   * Seite genannt; er zeichnet zwar keine Seite des Baums, aber es ist die Seite,
   * auf der die App startet — ungenauer als beim seitenbesitzenden Skin, nie auf
   * eine Seite verweisend, die es nicht gibt.
   */
  const shownPageId = computed(() => currentPageId.value ?? firstPageId());

  /**
   * The gates (PIN / login) that belong to the include SOURCES of `pageId`
   * (M5 R15, §2.1). The same entries are already in {@link pageGates}; what this
   * adds is the RELATION: „diese Seite enthält eine gesperrte Ebene" instead of a
   * PIN field for a page name the user never asked for. The gate UI uses it to
   * word the prompt at the include site.
   *
   * The second half of §2.1 — marking the locked layer at its place IN the stack
   * — is not expressible today: `PageLayer` has no `locked` flag (see the pending
   * 1.14 note in core/obs/compose).
   */
  function gatedIncludesFor(pageId: string): PageGate[] {
    if (!supportsLayering(source) || !source.includeSourcesFor) return [];
    const sources = new Set(source.includeSourcesFor(pageId));
    return pageGates.value.filter((g) => sources.has(g.pageId));
  }

  /* -------------------------------------------------- popups (M5 R2-R8, W4) */

  /** Close a popup and drop its auto-close timer. Idempotent. */
  function closePopup(id: string): void {
    openPopups.value = openPopups.value.filter((p) => p.id !== id);
    const t = popupTimers.get(id);
    if (t) {
      clearTimeout(t);
      popupTimers.delete(id);
    }
  }

  /**
   * Open a popup from its descriptor. A re-open of an already-open popup is a
   * no-op, so its auto-close deadline is NOT extended (R7, Edomi rule); any
   * number of DIFFERENT popups can be open at once (R8).
   */
  function openPopup(descriptor: PopupDescriptor): void {
    if (openPopups.value.some((p) => p.id === descriptor.id)) return;
    openPopups.value = [...openPopups.value, descriptor];
    if (descriptor.autoCloseMs && descriptor.autoCloseMs > 0) {
      popupTimers.set(
        descriptor.id,
        setTimeout(() => closePopup(descriptor.id), descriptor.autoCloseMs),
      );
    }
  }

  /** Close every open popup and clear the timers (the host render seam unmounts). */
  function closeAllPopups(): void {
    for (const t of popupTimers.values()) clearTimeout(t);
    popupTimers.clear();
    openPopups.value = [];
  }

  /* --------------------------------------------------- page links (#1194) */

  /**
   * Whether a valid PIN session is held for `nodeId` — the node that DEFINES the
   * access (the backend scopes the session there, mapping → `accessNodeId`). A
   * source without page auth reports "no session", which GATES rather than leaks.
   */
  function hasPageSession(nodeId: string): boolean {
    return supportsPageAuth(source) && source.hasPageSession ? source.hasPageSession(nodeId) : false;
  }

  /**
   * Switch the page the host shows (the canonical navigation action). The HOST
   * owns this state; a skin only marks intent, it never navigates itself.
   */
  function navigate(pageId: string): void {
    // M5 R2-R6: a POPUP page is not a page you go to, it is an overlay you open
    // over the page you are on. This is the single place both navigation paths
    // pass (a nav click via `PageHost.navigate` and a page link via
    // {@link followLink}), so the popup descriptor reaches the skin either way —
    // and the page underneath stays where it is.
    const popup = popupFor(pageId);
    if (popup) {
      openPopup(popup);
      pendingGate.value = null;
      return;
    }
    currentPageId.value = pageId;
    pendingGate.value = null;
  }

  /**
   * Resolve a page link WITHOUT acting on it (#146): what a jump WOULD do, given
   * the host's live state. The read-only half of {@link followLink} — a
   * page-owning skin asks this to decide the affordance (reachable · PIN-gated ·
   * unknown) before anything is clicked, so it never has to descend the navTree
   * itself (golden rule 4). Changes no state.
   */
  function linkOutcome(link: PageLink): LinkOutcome {
    return resolveLink(link, {
      navTree: navTree.value,
      isLoggedIn: authenticated.value,
      hasSessionToken: hasPageSession,
    });
  }

  /**
   * Follow a page link (#1194) — the host action behind a tap on a tile that has
   * no click function of its own. The resolution mirrors the V1 link widget
   * (`frontend/src/widgets/Link/Widget.vue`): the access is resolved along the
   * `parent_id` chain, a `protected` target without a session token goes to the
   * PIN path instead of the page, and a LOCATION descends to its first visible
   * page. An unknown target is a no-op — never a jump to the wrong page.
   *
   * Returns the outcome so the caller (the routed host layer) can also move the
   * router for a statically routed page; the state changes happen here.
   */
  function followLink(link: PageLink): LinkOutcome {
    const outcome = linkOutcome(link);
    if (outcome.kind === 'navigate') navigate(outcome.pageId);
    else if (outcome.kind === 'gate') pendingGate.value = outcome.pageId;
    return outcome;
  }

  /**
   * Re-seed from the current source (re-run `list()` + re-`subscribe()`). Called
   * after login/logout so the now-writable devices and the re-scoped live feed
   * take effect - the same seam `main.ts` uses to seed the store initially.
   */
  async function refresh(): Promise<void> {
    await init(source);
  }

  /**
   * JWT login (Welle L, opt-in). Forwards the credentials to the source's auth
   * surface; on success remembers the name, marks the session authenticated and
   * re-fetches so writable devices/scope take effect. A bad credential (or a
   * source without auth) rejects - the caller shows it inline; the guest state
   * is untouched (no refresh, still not authenticated).
   */
  async function login(user: string, pass: string): Promise<void> {
    if (!supportsAuth(source)) {
      throw new Error('store.login: the active data source does not support login');
    }
    await source.login(user, pass);
    username.value = user;
    authenticated.value = true;
    await refresh();
  }

  /**
   * Log out → back to guest. Drops the session on the source (if any), clears the
   * name and re-fetches so the guest-scoped devices/feed take over.
   */
  async function logout(): Promise<void> {
    if (supportsAuth(source)) await source.logout();
    username.value = null;
    authenticated.value = false;
    await refresh();
  }

  /**
   * PIN-unlock a protected page (Welle 3b, opt-in). Forwards the PIN to the
   * source's page-auth surface; on success re-fetches (the same `init` seam as
   * login) so the now-readable/operable devices, the re-scoped live feed and the
   * recomputed {@link pageGates} take effect, dropping the unlocked page off the
   * gate list. A wrong PIN rejects (the source surfaces it) so the caller can show
   * an INLINE "PIN falsch" without a crash; nothing is re-fetched and the gate
   * stays. A source without page auth is a programming error (guarded).
   */
  async function authenticatePage(pageId: string, pin: string): Promise<void> {
    if (!supportsPageAuth(source)) {
      throw new Error('store.authenticatePage: the active data source does not support PIN auth');
    }
    await source.authenticatePage(pageId, pin);
    await refresh();
    // #1194: a link that was stopped by this gate now completes — the PIN path
    // ends on the page the link asked for, not on a dead end.
    if (pendingGate.value === pageId && !pageGates.value.some((g) => g.pageId === pageId)) {
      navigate(pageId);
    }
  }

  /**
   * Send a canonical action to the source and optimistically apply the changes
   * locally. The single dispatch seam shared by every action below.
   */
  async function dispatch(
    id: string,
    action: WidgetAction,
    optimistic: Partial<Device>,
    payload?: unknown,
  ): Promise<void> {
    // Optimistic update first (the tile reacts immediately) …
    if (state.value.has(id)) merge(id, optimistic);
    // … then forward the intent; subscribe() will confirm/correct.
    await source.dispatch(id, action, payload);
  }

  /* ----------------------------------------------------- canonical actions */

  /**
   * Tap: switch a light/switch on/off. For a light that is off with `dim===0`,
   * switching on jumps to {@link DEFAULT_ON_DIM} via the canonical `setDim`
   * (widgets.js → tap); otherwise a plain `toggle`.
   */
  async function toggle(id: string): Promise<void> {
    const d = byId(id);
    if (!d || (d.type !== 'light' && d.type !== 'switch')) return;
    if (d.type === 'light' && !d.on && (d as LightDevice).dim === 0) {
      await setDim(id, DEFAULT_ON_DIM);
      return;
    }
    await dispatch(id, 'toggle', { on: !d.on } as Partial<Device>);
  }

  /** Set a light's brightness (0..100); on when > 0, off at 0. */
  async function setDim(id: string, pct: number): Promise<void> {
    const d = byId(id);
    if (!d || d.type !== 'light') return;
    const dim = clamp(pct);
    await dispatch(id, 'setDim', { dim, on: dim > 0 } as Partial<Device>, { value: dim });
  }

  /** Move a blind/jalousie to an absolute position (0=auf,100=zu). Locked tiles ignore it. */
  async function setPosition(id: string, pct: number): Promise<void> {
    const d = byId(id);
    if (!d || (d.type !== 'blind' && d.type !== 'jalousie')) return;
    if (isLockable(d) && d.locked) return; // locked blockiert die Kachel
    const position = clamp(pct);
    await dispatch(id, 'setPosition', { position } as Partial<Device>, { value: position });
  }

  /** Set a jalousie slat angle (0..100 ⇒ 0–90°). Locked tiles ignore it. */
  async function setSlat(id: string, pct: number): Promise<void> {
    const d = byId(id);
    if (!d || d.type !== 'jalousie') return;
    if (d.locked) return; // locked blockiert die Kachel
    const slat = clamp(pct);
    await dispatch(id, 'setSlat', { slat } as Partial<Device>, { value: slat });
  }

  /** Lock a blind/jalousie (blocks tile operation; unlock only in the detail). */
  async function lock(id: string): Promise<void> {
    const d = byId(id);
    if (!isLockable(d)) return;
    await dispatch(id, 'lock', { locked: true } as Partial<Device>);
  }

  /** Unlock a blind/jalousie. Allowed even though the locked tile is otherwise blocked. */
  async function unlock(id: string): Promise<void> {
    const d = byId(id);
    if (!isLockable(d)) return;
    await dispatch(id, 'unlock', { locked: false } as Partial<Device>);
  }

  /** Activate a scene (stateless intent - no local field changes). */
  async function activateScene(id: string): Promise<void> {
    const d = byId(id);
    if (!d || d.type !== 'scene') return;
    await dispatch(id, 'activateScene', {} as Partial<Device>);
  }

  /* --------------------------------------------- alarm arm/disarm (v1.1 stub) */
  // CONTRACT-v1 §6 reserves `alarm` for v1.1. No alarm device exists in the v1
  // core model, so these forward the canonical intent to the source without a
  // local optimistic field - a deliberate seam for when the type stabilises.

  async function arm(id: string): Promise<void> {
    await source.dispatch(id, 'arm');
  }

  async function disarm(id: string): Promise<void> {
    await source.dispatch(id, 'disarm');
  }

  return {
    devices,
    externalFloor,
    positions,
    links,
    navTree,
    currentPageId,
    shownPageId,
    pendingGate,
    openPopups,
    navigate,
    linkOutcome,
    followLink,
    hasPageSession,
    layersFor,
    popupFor,
    firstPageId,
    gatedIncludesFor,
    openPopup,
    closePopup,
    closeAllPopups,
    authenticated,
    username,
    pageGates,
    byId,
    init,
    refresh,
    login,
    logout,
    authenticatePage,
    toggle,
    setDim,
    setPosition,
    setSlat,
    lock,
    unlock,
    activateScene,
    arm,
    disarm,
  };
});
