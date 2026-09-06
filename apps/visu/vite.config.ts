import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// The obs Visu app defaults to the in-app MockDataSource, so no server is needed
// for demo/dev. When the real ObsDataSource is opted in (VITE_USE_OBS=1 /
// VITE_OBS_API), its `/api` REST + WebSocket calls are proxied to the obs
// server — mirroring frontend/vite.config. The target is configurable via
// VITE_OBS_PROXY_TARGET (default http://localhost:8080).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_OBS_PROXY_TARGET || 'http://localhost:8080';

  // EINE Quelle für den Auslieferungspfad. Vite leitet daraus index.html,
  // Asset-URLs und die SW-Registrierung ab — die Manifest-Felder aber nicht:
  // `start_url`, `scope` und die Icon-`src` schreiben wir selbst. Werden sie
  // als Literal `/` gepflegt, installiert der Browser unter einem Unterpfad
  // (obs serviert die Visu heute unter `/visu`) eine App mit falschem Scope
  // und toten Icons, ohne dass irgendetwas 404 wirft. Deshalb hier ableiten.
  // Muss auf `/` enden. Bewacht von tests/pwa-build.test.ts.
  const base = '/';
  const underBase = (path: string) => `${base}${path}`;
  return {
    base,
    plugins: [
      vue(),
      // PWA-Hälfte von Issue #103 (M4). Derselbe `dist/`-Build ist zugleich das
      // `webDir` der Capacitor-Hülle (capacitor.config.ts) — ein Code-Stand für
      // Web, iOS und Android.
      //
      // Die Icons unter `public/icons/` sind aus `logo/obs_icon_light.svg`
      // gerastert (macOS: `qlmanage -t -s 512`, dann `sips -z <n> <n>`); die
      // maskable-Variante trägt den vollflächigen Grund und das Motiv auf 70 %
      // skaliert, damit Androids Safe Zone nichts abschneidet.
      VitePWA({
        // Der Nutzer soll nie auf einem alten Bundle festhängen: ein neuer
        // Service Worker übernimmt beim nächsten Laden, ohne Update-Prompt-UI.
        registerType: 'autoUpdate',
        // Registrierung als eigenes Script in der gebauten index.html — die App
        // importiert `virtual:pwa-register` nicht, verzichtet also bewusst auf
        // eine eigene Update-UI.
        injectRegister: 'script-defer',
        // Der Service Worker ist im Dev-Server AUS (Default von vite-plugin-pwa,
        // hier explizit): ein Precache vor dem HMR-Transport liefert sonst alte
        // Module aus und lässt Änderungen scheinbar verschwinden. Er wird damit
        // ausschliesslich am Produktionsbuild gemessen — so, wie ihn
        // tests/pwa-build.test.ts prüft.
        devOptions: { enabled: false },
        manifest: {
          name: 'open bridge server Visu',
          short_name: 'obs Visu',
          description: 'open bridge server – Visualisierung',
          lang: 'de',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#085041',
          theme_color: '#085041',
          icons: [
            { src: underBase('icons/pwa-192x192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: underBase('icons/pwa-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: underBase('icons/maskable-512x512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // SPA-Deep-Links (z. B. /page/kueche) auf die App-Shell zurückfallen
          // lassen — aber niemals die obs-API, die kein Bundle ausliefert.
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5175,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
