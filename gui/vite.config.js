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
      // erreichbar. `^/visu(-v2)?(/|$)` trifft `/visu`, `/visu/...` und
      // `/visu-v2/...`, aber nicht `/visu-editor`.
      //
      // `/visu-v2` steht mit dabei, weil dort die eingebettete VORSCHAU liegt
      // (`VISU_PREVIEW_URL` in `utils/visuEditorAccess.js`). Ohne diesen Zweig
      // faellt sie im Dev-Server in den SPA-Rueckfall und zeigt die Admin-GUI in
      // sich selbst statt der Visu. Wer die Vorschau woanders ausliefert, setzt
      // `VITE_VISU_PREVIEW_URL` und braucht diesen Zweig nicht.
      //
      // Das Ziel ist wie `/api` und `/help` ueber die Umgebung setzbar
      // (`VISU_PROXY_TARGET`): der E2E-Harness faehrt einen eigenen Portstapel,
      // und ein fest verdrahtetes 5174 haette genau diesen einen Zweig davon
      // ausgenommen.
      '^/visu(-v2)?(/|$)': {
        target: process.env.VISU_PROXY_TARGET || 'http://localhost:5174',
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
