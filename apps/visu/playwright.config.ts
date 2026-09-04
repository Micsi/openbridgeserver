import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Visu × authz role E2E (CONTRIBUTING-visu-authz.md §5,
 * Welle 4). This is the *real* security verification: the specs drive the Visu
 * against a live, authz-seeded obs server and assert the authz TRUTH the UI must
 * honour — a filtered tree (concealment, not a red error wall), the PIN
 * AccessGate, and role-scoped visibility after a JWT login.
 *
 * Deliberately a SEPARATE run from the visu-ci gates (`pnpm --filter
 * @obs/visu-app test` / lint / boundaries). It needs a browser, a running
 * backend and a seeded database, so it never blocks the mandatory client gates.
 *
 * The backend + Visu dev server are brought up MANUALLY per e2e/README.md; this
 * config does not own their lifecycle (no `webServer`). Point it at the running
 * Visu with PLAYWRIGHT_BASE_URL (default matches `vite`'s dev port 5175).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5175';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // 60 s statt der fruehreren 30 s: seit dem M5-Seed traegt die Beispielwelt rund
  // 20 Seiten (Seitentypen, Popups, Zugriffsgrenzen) statt fuenf, und die Visu
  // laedt jede Seiten-Config einzeln und page-scoped (`GET /visu/pages/{id}`).
  // Ein Browser-Szenario lief damit auf 30 s zu und waere aus Zeitgruenden rot
  // geworden statt aus einer Aussage heraus. Die Einzel-Erwartung bleibt bei 7 s,
  // damit eine echte Fehlaussage weiterhin schnell auffliegt.
  timeout: 60_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Pin the browser UI language so the seeded English i18n strings the specs
    // assert on (auth.* / access.*) are deterministic regardless of host locale.
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      // Narrow (mobile) viewport so Ionic renders the openable ion-menu drawer
      // (the LoginPanel/AccessGate live in it); at desktop widths the shell uses a
      // split-pane and the drawer never opens. Keep desktop click semantics (no
      // touch emulation) so the .login-*/.access-gate* clicks stay deterministic.
      use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 851 } },
    },
  ],

  // OPTIONAL self-managed Visu dev server. Left disabled because the backend it
  // proxies to must be up and seeded first (see e2e/README.md). To let Playwright
  // start only the Visu (backend already running + seeded), set
  // PLAYWRIGHT_MANAGE_WEBSERVER=1 and VITE_OBS_PROXY_TARGET.
  ...(process.env.PLAYWRIGHT_MANAGE_WEBSERVER === '1'
    ? {
        webServer: {
          command: 'pnpm --filter @obs/visu-app dev',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 60_000,
          env: {
            VITE_USE_OBS: '1',
            VITE_OBS_PROXY_TARGET: process.env.VITE_OBS_PROXY_TARGET ?? 'http://127.0.0.1:8080',
          },
        },
      }
    : {}),
});
