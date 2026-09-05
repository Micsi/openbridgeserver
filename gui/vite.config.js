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
  // Ziele und Port sind ueber die Umgebung umlegbar (Vorgabe unveraendert): der
  // Browser-E2E des Messlatten-Harness faehrt einen eigenen Portstapel, damit
  // parallele Laeufe sich nicht die Instanz wegnehmen (apps/visu/e2e/README.md).
  //
  // BEIDE Schreibweisen der Ziel-Variablen werden gelesen, `VITE_`-praefigiert
  // (C1/C4-Rezept) und unpraefigiert (C2-Rezept): die beiden Teile haben ihre
  // Harness-Anleitungen unabhaengig geschrieben, und `apps/visu/e2e/README.md`
  // fuehrt seither beide auf. Wer nur eine setzt, bekommt sie; wer beide setzt,
  // bekommt die `VITE_`-Variante.
  server: {
    port: Number(process.env.GUI_DEV_PORT) || 5173,
    proxy: {
      '/api': {
        target:
          process.env.VITE_OBS_PROXY_TARGET || process.env.OBS_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true,            // WebSocket proxy
      },
      // ALS REGEX, nicht als Praefix: ein blosses '/visu' verschluckt auch
      // '/visu-editor' (Vite matcht Proxy-Schluessel als Praefix), und der neue
      // Admin-Bereich landete im Dev-Server bei der V1-Visu statt in der SPA -
      // gemessen: 502 Bad Gateway, leere Seite. Nur '/visu' selbst und alles
      // UNTER '/visu/' gehoert der Visu.
      //
      // '/visu-v2' steht mit dabei (M5 C2, Issue #169), weil dort die
      // eingebettete VORSCHAU liegt: `VISU_PREVIEW_URL` in
      // `utils/visuEditorAccess.js` faellt auf `/visu-v2/preview` zurueck. Ohne
      // diesen Zweig faellt die Vorschau im Dev-Server in den SPA-Rueckfall und
      // zeigt die Admin-GUI in sich selbst statt der Visu (E3/E19 rot). Wer die
      // Vorschau woanders ausliefert, setzt `VITE_VISU_PREVIEW_URL` und braucht
      // den Zweig nicht.
      '^/visu(-v2)?(/|$)': {
        target:
          process.env.VITE_VISU_PROXY_TARGET || process.env.VISU_PROXY_TARGET || 'http://localhost:5174',
        changeOrigin: true,
      },
      '/help': {
        target:
          process.env.VITE_OBS_PROXY_TARGET || process.env.OBS_PROXY_TARGET || 'http://localhost:8080',
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
