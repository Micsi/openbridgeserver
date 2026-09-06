import { test, expect } from '@playwright/test';

// Definition of Done (#103, MIGRATION.md §8): „App startet als PWA".
//
// Die Vitest-Suite belegt, dass die Dateien da sind und zusammenpassen. Ob die
// App daraus auch bootet, sagt sie nicht — ein Bundle kann vollständig sein und
// beim Start trotzdem sofort werfen. Dieser Lauf lädt den Produktionsbuild in
// einem echten Browser.

test.describe('PWA-Boot aus dem Produktionsbuild', () => {
  test('mountet die App und registriert den Service Worker', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.goto('/', { waitUntil: 'load' });

    // 1. Die App bootet: der Mount-Punkt ist nicht mehr leer.
    const app = page.locator('#app');
    await expect(app, 'kein #app-Mountpunkt in der ausgelieferten Seite').toHaveCount(1);
    await expect
      .poll(async () => (await app.innerHTML()).trim().length, {
        message: '#app bleibt leer — die App bootet aus dem Produktionsbuild nicht',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // 2. Sie läuft als PWA: der Service Worker ist beim Browser registriert.
    //    `registerSW.js` registriert erst auf `window load`, daher pollen.
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null), {
        message: 'kein Service Worker registriert — die Seite läuft nicht als PWA',
        timeout: 20_000,
      })
      .toBeTruthy();

    // 3. Der Boot war fehlerfrei — eine geworfene Exception darf nicht als
    //    „gemountet" durchgehen.
    expect(pageErrors, 'JS-Fehler beim Start des Produktionsbuilds').toEqual([]);
  });
});
