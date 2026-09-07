import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

// The obs Visu app defaults to the in-app MockDataSource, so no server is needed
// for demo/dev. When the real ObsDataSource is opted in (VITE_USE_OBS=1 /
// VITE_OBS_API), its `/api` REST + WebSocket calls are proxied to the obs
// server — mirroring frontend/vite.config. The target is configurable via
// VITE_OBS_PROXY_TARGET (default http://localhost:8080).
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_OBS_PROXY_TARGET || 'http://localhost:8080';
  return {
    // AUSGELIEFERT liegt die V2-Visu unter /visu-v2/ (M5 Teil D, Issue #174):
    // `obs/main.py` mountet `visu_v2_dist/` dort, NEBEN der unveraenderten V1
    // unter /visu (Regel R17). Von diesem Praefix kommt auch der Vorschau-Modus,
    // den der V2-Editor der Admin-GUI einbettet - `VISU_PREVIEW_URL` in
    // `gui/src/utils/visuEditorAccess.js` faellt genau darauf zurueck.
    //
    // WER DIESES BUENDEL BAUT: NICHT die Packer selbst. `package.json` haengt
    // ueber drei `link:`-Pfade an einem Repo ausserhalb dieses Baums
    // (obs-visu-skins), das in Docker-Abbild und LXC-Builder nicht existiert.
    // `visu_v2_dist/` entsteht deshalb VORGEBAUT (`tools/build-visu-v2.sh`) und
    // wird den Packern als Artefakt gereicht: lokal ruft `tools/build-local.sh`
    // das vor jedem Paketbau auf (`Dockerfile` Stufe `visu-v2` und
    // `tools/_lxc-inner.sh` uebernehmen das Ergebnis), in CI tun das
    // `.github/workflows/release.yml`, `lxc-template.yml` und
    // `nightly-docker.yml` selbst (Checkout von obs-visu-skins plus Bau, bevor
    // das jeweilige Paket entsteht). Micsi/openbridgeserver#191 beschreibt die
    // vorherige Luecke.
    //
    // IM DEV-SERVER bleibt die Wurzel. Vite serviert seine Modul-Adressen
    // (`/src/...`, `/@vite/client`) NICHT unter der Basis; ein Praefix hier
    // wuerde die Laufanleitung des Messlatten-Harness umschreiben
    // (`apps/visu/e2e/README.md` faehrt gegen `/edomi`, `/preview`), ohne dass
    // die Auslieferung davon etwas haette.
    base: command === 'build' ? '/visu-v2/' : '/',
    build: {
      // Geschwister von gui_dist/, frontend_dist/ und help_dist/ - dieselbe
      // Ordnung, dieselbe Stelle, von der `obs/main.py` liest.
      outDir: '../../visu_v2_dist',
      emptyOutDir: true,
    },
    plugins: [vue()],
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
