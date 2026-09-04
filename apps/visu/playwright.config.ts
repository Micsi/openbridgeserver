import { defineConfig, devices } from '@playwright/test';
import { VISU_BASE } from './e2e/fixtures';

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
const baseURL = VISU_BASE;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Einmal-Kosten raus statt Decke hoch: `e2e/global-setup.ts` faehrt vor dem
  // Lauf einen Warmlauf gegen den Visu-Dev-Server. GEMESSEN ist der Kostentreiber
  // der ersten Browser-Szenarien das On-Demand-Transpilieren von Vite beim
  // allerersten Seitenaufruf (26-48 s), NICHT die auf rund 20 Seiten gewachsene
  // M5-Beispielwelt: dieselben vier Szenarien brauchen gegen einen bereits
  // warmgelaufenen Dev-Server 1,0-2,9 s, die 20 Seiten-Configs kosten ueber alle
  // vier zusammen deutlich unter einer Sekunde. Deshalb bleiben die 30 s stehen:
  // ein Szenario, das mit warmem Server 30 s braucht, hat ein echtes Problem und
  // soll rot werden. Die Einzel-Erwartung bleibt bei 7 s.
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Pin the browser UI language so the seeded English i18n strings the specs
    // assert on (auth.* / access.*) are deterministic regardless of host locale.
    locale: 'en-US',
  },
  // Der Warmlauf + das Vorabholen der Tokens (5 Anmeldungen/Minute!) liegen
  // ausserhalb jedes Test-Timeouts, siehe Datei-Kopf dort.
  globalSetup: './e2e/global-setup.ts',
  projects: [
    {
      name: 'chromium',
      // Narrow (mobile) viewport so Ionic renders the openable ion-menu drawer
      // (the LoginPanel/AccessGate live in it); at desktop widths the shell uses a
      // split-pane and the drawer never opens. Keep desktop click semantics (no
      // touch emulation) so the .login-*/.access-gate* clicks stay deterministic.
      use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 851 } },
      // E14 braucht das Gegenteil (echte Touch-Eingabe) und laeuft deshalb im
      // eigenen Projekt unten, hier ausgenommen, damit die Datei nicht zweimal
      // faehrt und die Zuordnung „eine Zeile, ein Szenario" heil bleibt.
      testIgnore: '**/m5-editor-touch.spec.ts',
    },
    {
      // E14 (Touch-Drag) verlangt `page.touchscreen`, und Playwright verweigert
      // das ohne `hasTouch` im Kontext („hasTouch must be enabled on the browser
      // context before using the touchscreen.", nachgemessen). Ein
      // `fixme`, das auch nach Lieferung von Teil C5 nur an der Harness-Konfig
      // scheitert, nimmt nichts ab, deshalb dieses zweite Projekt. Es faehrt
      // NUR die Touch-Datei; alle uebrigen Szenarien behalten die Maus-Semantik
      // des Projekts oben.
      name: 'chromium-touch',
      testMatch: '**/m5-editor-touch.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 851 }, hasTouch: true },
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
