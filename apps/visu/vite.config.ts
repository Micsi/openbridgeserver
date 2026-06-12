import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

// The obs Visu app defaults to the in-app MockDataSource, so no server is needed
// for demo/dev. When the real ObsDataSource is opted in (VITE_USE_OBS=1 /
// VITE_OBS_API), its `/api` REST + WebSocket calls are proxied to the obs
// server — mirroring frontend/vite.config. The target is configurable via
// VITE_OBS_PROXY_TARGET (default http://localhost:8080).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_OBS_PROXY_TARGET || 'http://localhost:8080';
  return {
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
