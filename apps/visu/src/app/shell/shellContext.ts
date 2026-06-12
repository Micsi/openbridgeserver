/**
 * app/shell/shellContext — the per-page context the app-level shell reads (#118).
 *
 * The AppShell is mounted ONCE at app level (App.vue) around the router outlet,
 * so the single `ion-app` shell wraps every routed page (no nested `ion-app`).
 * But the chrome it draws is page-dependent: the header title, the active nav
 * key, the themed root bindings (skin tweaks), and the error/empty flags all come
 * from the page that is currently routed. This tiny reactive seam carries that
 * per-page context from the active page up to the app-level shell.
 *
 * The routed page (SkinPage) writes its computed context here via {@link
 * useShellContext}; the shell reads the same reactive object. When no provider is
 * present (a page mounted standalone in a test), {@link useShellContext} returns a
 * local context so the page still works in isolation.
 *
 * Daten=JSON, Verhalten=Code: this is plain reactive view state + setters, no
 * device state — the device store stays the single owner of device state.
 */

import { reactive, inject, provide, type InjectionKey } from 'vue';
import type { ShellStateOptions } from './useShellState';
import type { RootTweakStyle } from '@obs-visu-skins/ionic';

/** The per-page context the app-level shell renders its chrome from. */
export interface ShellContext {
  /** The active page's resolved (localised) header title. */
  title?: string;
  /** Seed the shell state (active nav section) from the active page. */
  state?: ShellStateOptions;
  /** The active page's skin root bindings (data-theme + tweak CSS vars). */
  rootBind?: RootTweakStyle;
  /** A hard error to surface in the shell's `error` slot. */
  error?: string | null;
  /** Whether the active page body is empty (drives the `empty` slot fallback). */
  empty?: boolean;
}

/** Inject key for the shared, reactive shell context. */
export const SHELL_CONTEXT_KEY: InjectionKey<ShellContext> = Symbol('obs-visu-shell-context');

/** Create + provide the reactive shell context (called once at app level). */
export function provideShellContext(): ShellContext {
  const ctx = reactive<ShellContext>({});
  provide(SHELL_CONTEXT_KEY, ctx);
  return ctx;
}

/**
 * Get the shared shell context. When the app provided one (the running app), the
 * page writes its per-page context into it for the app-level shell to read. With
 * no provider (a page mounted standalone, e.g. in a unit test) a fresh local
 * context is returned so the page still resolves without an app shell.
 */
export function useShellContext(): ShellContext {
  return inject(SHELL_CONTEXT_KEY, null) ?? reactive<ShellContext>({});
}
