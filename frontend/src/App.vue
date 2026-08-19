<script setup lang="ts">
import { onMounted } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { getJwt } from '@/api/client'
import { useThemeStore } from '@/stores/theme'
import { useFormatStore } from '@/stores/format'

const ws = useWebSocket()
// Theme-Store initialisieren (setzt dark-Klasse auf <html>)
useThemeStore()
// Regionalformat für Zahlen/Währung/Datum laden (Issue #1073) — öffentliche Route,
// damit auch anonyme und PIN-Nutzer die konfigurierte Formatierung sehen.
const format = useFormatStore()

onMounted(() => {
  format.load()
  // WebSocket nur starten wenn JWT vorhanden (Live-Werte für eingeloggte User)
  if (getJwt()) {
    ws.connect()
  }
})
</script>

<template>
  <RouterView />
</template>
