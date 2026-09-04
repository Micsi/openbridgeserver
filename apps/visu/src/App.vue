<script setup lang="ts">
/**
 * App — the application root. Mounts the Ionic shell ONCE (#118).
 *
 * The single `ion-app` shell (AppShell) wraps the router outlet here at app
 * level, so every routed page renders its body INSIDE the one shell: exactly one
 * `ion-app`, one header, one menu, one outlet for the whole app. What #118 ruled
 * out is a second CHROME per page — the `IonApp › RouterOutlet › IonApp › IonPage`
 * chain it removed. The routed page (SkinPage) fills the shell's per-page context
 * (title · active nav · theme tweaks · the skin's root class) through the shared
 * shellContext, which the shell reads to draw the page-dependent chrome.
 *
 * The routed BODY is nevertheless a `div.ion-page` (SkinPage renders an `IonPage`).
 * That is not a second chrome — an `IonPage` is a bare `<div class="ion-page">`
 * whose only job is to call `registerIonPage`, the callback through which
 * `ion-router-outlet` identifies a view. Without it the outlet never finds the
 * LEAVING view, never marks it `ion-page-hidden`, and every in-app route change
 * leaves the previous page stacked visibly under the new one. So: chrome exactly
 * once, and one `div.ion-page` per routed page as the outlet's handle on it.
 */
import AppShell from './app/AppShell.vue';
import { provideShellContext } from './app/shell/shellContext';

const ctx = provideShellContext();
</script>

<template>
  <AppShell
    with-router-outlet
    :title="ctx.title"
    :state="ctx.state"
    :root-bind="ctx.rootBind"
    :error="ctx.error"
    :empty="ctx.empty"
  />
</template>
