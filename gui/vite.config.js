import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [vue()],

  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') }
  },

  // Dev server: proxy /api and /help to backend, /visu to the Visu frontend dev server (port 5174).
  //
  // Ziel und Port sind ueber die Umgebung setzbar (M5 C2, Issue #169): der
  // E2E-Harness faehrt Backend und Dev-Server auf einem eigenen Portstapel,
  // damit mehrere Laeufe nebeneinander stehen koennen, ohne sich die 8080/5173
  // wegzunehmen. Ohne gesetzte Variablen bleibt alles wie bisher.
  server: {
    port: Number(process.env.GUI_DEV_PORT) || 5173,
    proxy: {
      '/api': {
        target: process.env.OBS_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true,            // WebSocket proxy
      },
      // Regulaerer Ausdruck statt Praefix (M5 C2, Issue #169): ein
      // Zeichenketten-Schluessel trifft in Vite JEDEN Pfad, der so ANFAENGT -
      // `/visu-editor/<id>` landete damit im Proxy zur Visu (Port 5174) und kam
      // als 502 zurueck, der Admin-Bereich war im Dev-Server also gar nicht
      // erreichbar. `^/visu(/|$)` trifft `/visu` und `/visu/...`, aber nicht
      // `/visu-editor`.
      '^/visu(/|$)': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      '/help': {
        target: process.env.OBS_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    }
  },

  build: {
    outDir: '../gui_dist',   // output next to gui/ directory, served by FastAPI
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  }
})
