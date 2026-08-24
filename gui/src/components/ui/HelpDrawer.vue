<template>
  <Teleport to="body">
    <Transition
      enter-from-class="opacity-0" enter-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"   leave-active-class="transition-opacity duration-150"
    >
      <div
        v-if="helpStore.isOpen"
        class="fixed inset-0 z-50 flex justify-end"
        @mousedown.self="close"
        data-testid="help-drawer-overlay"
      >
        <div class="absolute inset-0 bg-black/40" />

        <Transition
          enter-from-class="translate-x-full" enter-active-class="transition-transform duration-200"
          leave-to-class="translate-x-full"   leave-active-class="transition-transform duration-150"
        >
          <div
            v-if="helpStore.isOpen"
            class="relative card shadow-2xl h-full flex flex-col pointer-events-auto rounded-none border-l"
            :style="{ width: width + 'px', maxWidth: '90vw' }"
          >
            <div
              class="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-sky-400/40"
              @pointerdown="startResize"
              data-testid="help-drawer-resize-handle"
            />

            <div class="card-header shrink-0">
              <h3 class="text-base font-semibold text-slate-800 dark:text-slate-100">
                {{ $t('help.title') }}
              </h3>
              <button class="btn-icon" :aria-label="$t('common.close')" @click="close">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div class="flex-1 min-h-0">
              <iframe
                v-if="helpStore.currentUrl"
                :src="helpStore.currentUrl"
                class="w-full h-full border-0"
                :title="$t('help.title')"
                data-testid="help-drawer-iframe"
              />
              <div v-else class="card-body text-sm text-slate-500 dark:text-slate-400">
                {{ $t('help.unavailable') }}
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { useHelpStore } from '@/stores/help'
import { useResizablePanel } from '@/composables/useResizablePanel'

const helpStore = useHelpStore()
const { width, startResize } = useResizablePanel({
  storageKey: 'obs-help-drawer-width',
  defaultWidth: Math.round(window.innerWidth * 0.4),
  min: 320,
  max: 960,
})

function close() {
  helpStore.close()
}

function onKeyDown(event) {
  if (event.key === 'Escape' && helpStore.isOpen) close()
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
</script>
