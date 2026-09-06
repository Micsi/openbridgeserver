import { defineConfig, devices } from '@playwright/test';

/**
 * M4 · Issue #103 — Gate für die Definition of Done „App startet als PWA".
 *
 * Bewusst GETRENNT von playwright.config.ts (dem authz-Rollen-E2E): jener Lauf
 * braucht ein laufendes, geseedetes obs-Backend und ist deshalb kein CI-Gate.
 * Dieser hier braucht nichts ausser dem Produktionsbuild — `vite preview`
 * serviert `dist/` so, wie es ausgeliefert wird, inklusive Service Worker.
 * (Der Dev-Server taugt dafür nicht: dort ist der SW per
 * `devOptions: { enabled: false }` aus, und es wird gar nichts precached.)
 *
 * Läuft ohne native Toolchain — die PWA-Hälfte von #103 ist hier voll prüfbar.
 */
const port = Number(process.env.PWA_PREVIEW_PORT ?? 4173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e-pwa',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      // Mobile Viewport: die Visu ist eine Mobile-App-Hülle, und derselbe Build
      // landet per `cap sync` in der iOS-/Android-WebView.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 851 } },
    },
  ],
  webServer: {
    // `vite preview` liest base/outDir aus derselben vite.config wie der Build.
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
