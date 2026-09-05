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
  // Die Ziele sind ueber Umgebungsvariablen umlegbar (Vorgabe unveraendert): der
  // Browser-E2E des Messlatten-Harness faehrt einen eigenen Portstapel, damit
  // parallele Laeufe sich nicht die Instanz wegnehmen (apps/visu/e2e/README.md).
  server: {
    port: Number(process.env.GUI_DEV_PORT || 5173),
    proxy: {
      '/api': {
        target: process.env.VITE_OBS_PROXY_TARGET || 'http://localhost:8080',
        changeOrigin: true,
        ws: true,            // WebSocket proxy
      },
      // ALS REGEX, nicht als Praefix: ein blosses '/visu' verschluckt auch
      // '/visu-editor' (Vite matcht Proxy-Schluessel als Praefix), und der neue
      // Admin-Bereich landete im Dev-Server bei der V1-Visu statt in der SPA -
      // gemessen: 502 Bad Gateway, leere Seite. Nur '/visu' selbst und alles
      // UNTER '/visu/' gehoert der Visu.
      '^/visu(/|$)': {
        target: process.env.VITE_VISU_PROXY_TARGET || 'http://localhost:5174',
        changeOrigin: true,
      },
      '/help': {
        target: process.env.VITE_OBS_PROXY_TARGET || 'http://localhost:8080',
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
