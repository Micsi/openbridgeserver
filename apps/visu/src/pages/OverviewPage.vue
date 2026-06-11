<script setup lang="ts">
/**
 * pages/OverviewPage — the room-grouped mobile overview (the first Ionic page).
 *
 * Since A5 (Issue #101) the overview is just the `overview` {@link PageDef}
 * rendered by the generic, page-definition-driven {@link SkinPage}: the page def
 * names the `ionic` skin and the full core room set. This thin wrapper keeps the
 * stable `/` route + the M2 overview regression suite pointed at one component
 * while the actual rendering (shell · host · ionic skin · tweaks) lives in
 * SkinPage, shared with the terminal page.
 */
import SkinPage from './SkinPage.vue';
</script>

<template>
  <SkinPage page-id="overview" />
</template>
