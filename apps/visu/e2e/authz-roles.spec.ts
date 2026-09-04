import { test, expect, type Page } from '@playwright/test';
import { noteBrowserLogin } from './fixtures';

/**
 * Visu × authz role E2E — the real security verification (CONTRIBUTING-visu-authz.md
 * §5, Welle 4). These specs drive the Visu against a LIVE, authz-seeded obs server
 * (see e2e/README.md + e2e/seed.py) and assert the authz TRUTH the client must
 * honour, not a green mock:
 *
 *   - Concealment: a node the server filtered out of `GET /visu/tree` simply never
 *     renders — and it is silent (no red error wall), per the frontend/-blueprint.
 *   - PIN AccessGate: a `protected` page renders a PIN prompt; the correct PIN
 *     unlocks it, a wrong PIN shows an inline note (never a global failure).
 *   - Role scope: a JWT login (LoginPanel) re-scopes the tree — a `user`-page
 *     device that a guest could not see appears once signed in, and disappears on
 *     logout.
 *
 * The constants below MUST match apps/visu/e2e/seed.py.
 */

const PIN = '2468';
const RESIDENT = { username: 'e2e_resident', password: 'e2e-resident-pw' };
const OPERATOR = { username: 'e2e_operator', password: 'e2e-operator-pw' };

const WIDGET = {
  public: 'Public Lamp', // on a `public` page → visible to everyone
  readonly: 'Readonly Sensor', // on a `readonly` page → visible, non-writable
  protected: 'Protected Switch', // on a `protected` (PIN) page
  private: 'Private Blind', // on a `user` page → hidden from guests
  room: 'Room Dimmer', // room_local on a public page
};
const PROTECTED_PAGE = 'E2E Protected';

// The seeded server is opted into via VITE_USE_OBS=1 (see README). Force the UI
// language to English so the auth.*/access.* strings asserted below are stable.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('obs-visu-locale', 'en');
    } catch {
      /* private mode — the app falls back to its default locale */
    }
  });
});

function tile(page: Page, name: string) {
  return page.getByText(name, { exact: false }).first();
}

async function openMenu(page: Page) {
  // LoginPanel lives inside the shell's ion-menu; open it via the menu controller
  // so the flow does not depend on a particular menu-button placement.
  await page.locator('ion-menu').first().evaluate((m: HTMLElement & { open: () => Promise<void> }) => m.open());
}

async function login(page: Page, user: { username: string; password: string }) {
  await openMenu(page);
  await page.locator('.login-open').click();
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Password').fill(user.password);
  await page.locator('.login-submit').click();
  // Diese Anmeldung läuft durch die echte Maske und hinterlässt deshalb kein
  // Token im Zwischenspeicher. Gebucht wird sie trotzdem: `POST /auth/login`
  // erlaubt 5 Anmeldungen pro Minute, und `global-setup.ts` rechnet vor dem
  // nächsten Lauf aus, wie viel davon noch frei ist (e2e/README.md).
  noteBrowserLogin();
  await expect(page.getByText(`Signed in as ${user.username}`)).toBeVisible();
}

async function logout(page: Page) {
  await openMenu(page);
  await page.locator('.login-logout').click();
  await expect(page.locator('.login-open')).toBeVisible();
}

test.describe('Visu authz roles (live server)', () => {
  test('guest sees public devices but the user-page device is concealed, with no error wall', async ({ page }) => {
    await page.goto('/');

    // public device is discoverable without any credential
    await expect(tile(page, WIDGET.public)).toBeVisible();
    await expect(tile(page, WIDGET.readonly)).toBeVisible();

    // the `user`-page device is filtered out of the guest tree → never renders
    await expect(page.getByText(WIDGET.private, { exact: false })).toHaveCount(0);

    // concealment is SILENT: no shell-level error wall (frontend/-blueprint)
    await expect(page.locator('.shell-error')).toHaveCount(0);
  });

  test('protected page shows a PIN gate; a wrong PIN is inline, the correct PIN unlocks it', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.access-gate')).toBeVisible();
    await expect(page.getByText(`PIN required for ${PROTECTED_PAGE}`)).toBeVisible();

    // Since M5 the seeded world holds more than one PIN-protected page (the
    // include source behind an access boundary, seed.py `guard_pin`), so the
    // gate strip renders several PIN forms. Scope every interaction to THIS
    // page's form — that is also the sharper assertion the component promises:
    // the inline note appears at that item only, not somewhere in the strip.
    const gate = page.locator('.access-gate-pin').filter({ hasText: `PIN required for ${PROTECTED_PAGE}` });
    await expect(gate).toHaveCount(1);

    // wrong PIN → inline note, not a global failure
    await gate.getByLabel('Enter PIN').fill('0000');
    await gate.locator('.access-gate-unlock').click();
    await expect(gate.getByText('Wrong PIN')).toBeVisible();
    await expect(page.locator('.shell-error')).toHaveCount(0);

    // correct PIN → the gate for this page disappears (session token cached)
    await gate.getByLabel('Enter PIN').fill(PIN);
    await gate.locator('.access-gate-unlock').click();
    await expect(page.getByText(`PIN required for ${PROTECTED_PAGE}`)).toHaveCount(0);
  });

  test('resident login reveals the user-page device; logout conceals it again', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(WIDGET.private, { exact: false })).toHaveCount(0);

    await login(page, RESIDENT);
    // re-scoped tree after login → the assigned `user`-page device now renders
    await expect(tile(page, WIDGET.private)).toBeVisible();
    // public devices remain visible under the wider scope
    await expect(tile(page, WIDGET.public)).toBeVisible();

    await logout(page);
    // back to guest scope → the user-page device is concealed again
    await expect(page.getByText(WIDGET.private, { exact: false })).toHaveCount(0);
  });

  test('operator login also gains the user-page and room devices', async ({ page }) => {
    await page.goto('/');
    await login(page, OPERATOR);

    await expect(tile(page, WIDGET.private)).toBeVisible();
    await expect(tile(page, WIDGET.room)).toBeVisible();
    // still no error wall while operating under the elevated scope
    await expect(page.locator('.shell-error')).toHaveCount(0);
  });
});
