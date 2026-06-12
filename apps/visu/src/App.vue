<script setup lang="ts">
/**
 * App — the application root. Mounts the Ionic shell ONCE (#118).
 *
 * The single `ion-app` shell (AppShell) wraps the router outlet here at app
 * level, so every routed page renders its body INSIDE the one shell — no nested
 * `ion-app`/`ion-page` per page. The routed page (SkinPage) fills the shell's
 * per-page context (title · active nav · theme tweaks) through the shared
 * shellContext, which the shell reads to draw the page-dependent chrome.
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
