import { test, expect } from '@playwright/test';
import { adminHeaders, api, seeded, userHeaders, type NodeSummary, type PageConfigResponse } from './fixtures';

/**
 * M5 Messlatte — Regeltabelle R15 (CONTRIBUTING-visu-m5.md §1): ein Include quer
 * über eine Zugriffsgrenze. Genau EIN Szenario, der Testname ist das Kriterium.
 *
 * Läuft HEUTE: §2.1 nennt die vollständige Signalliste, die eine Include-Quelle
 * liefern kann, und Teil A (#166) hat sie samt der Naht
 * `X-Source-Page-Readonly` geliefert. Teil B baut gegen genau diese Liste, nicht
 * gegen „404 allein" — deshalb prüft dieses Szenario jede Lage der Liste an der
 * API (200 lesbar, 200 readonly, 401 Anmeldung, 401 PIN, 403 Zugriff verweigert,
 * 404 nicht vorhanden, 400 kein-Seite), dazu die Verdeckung auf der
 * Navigationsebene und die dokumentierte GRENZE der Verdeckung (rohe `includes`
 * auf einer lesbaren Wirtsseite). Eine Abweichung des 404-Textes vom Plan ist im
 * Schritt selbst belegt und festgeschrieben.
 *
 * Die Reaktion des Hosts auf diese Signale (stilles Weglassen bzw. sichtbar
 * „gesperrt") ist Teil B (#167) und wird über R16 nachgewiesen.
 */

const NONEXISTENT_PAGE_ID = '00000000-0000-4000-8000-000000000000';

test.describe('M5 Regeltabelle R15 · Zugriffsgrenze (läuft gegen das echte Backend)', () => {
  test('R15 Include quer über eine Zugriffsgrenze: nicht lesbare Quelle wird verdeckt, readonly-Quelle → Widgets gesperrt', async ({
    request,
  }) => {
    const fx = seeded();
    const ids = fx.m5.node_ids;

    await test.step('die Wirtsseite inkludiert alle drei Grenzfälle', async () => {
      const headers = await adminHeaders(request);
      const host = (await (await request.get(api(`/visu/pages/${ids.guard_host}`), { headers })).json()) as PageConfigResponse;
      expect(host.includes).toEqual([ids.guard_user, ids.guard_readonly, ids.guard_pin]);
    });

    await test.step('Verdeckung entsteht auf der Navigationsebene: der Gast sieht die user-Seite nicht im Baum', async () => {
      const res = await request.get(api('/visu/tree'));
      expect(res.status()).toBe(200);
      const tree = (await res.json()) as NodeSummary[];
      const visible = new Set(tree.map((n) => n.id));
      expect(visible.has(ids.guard_host)).toBe(true);
      expect(visible.has(ids.guard_readonly)).toBe(true);
      expect(visible.has(ids.guard_user)).toBe(false);
    });

    await test.step('readonly-Quelle: lesbar, aber X-Source-Page-Readonly=true → Widgets gesperrt', async () => {
      const res = await request.get(api(`/visu/pages/${ids.guard_readonly}`));
      expect(res.status()).toBe(200);
      expect(res.headers()['x-source-page-readonly']).toBe('true');
      const cfg = (await res.json()) as PageConfigResponse;
      expect(cfg.widgets.map((w) => w.name)).toContain(fx.m5.widgets.guard_readonly);
    });

    await test.step('schreibbare Quelle: derselbe Header sagt ausdrücklich false', async () => {
      const res = await request.get(api(`/visu/pages/${ids.include_ind}`));
      expect(res.status()).toBe(200);
      expect(res.headers()['x-source-page-readonly']).toBe('false');
    });

    await test.step('401 „Anmeldung erforderlich": verdeckt, solange kein Login vorliegt', async () => {
      const res = await request.get(api(`/visu/pages/${ids.guard_user}`));
      expect(res.status()).toBe(401);
      expect((await res.json()).detail).toBe('Anmeldung erforderlich');
    });

    await test.step('403 „Zugriff verweigert": angemeldet, aber nicht in der Zielgruppe', async () => {
      const headers = await userHeaders(request, fx.operator);
      const res = await request.get(api(`/visu/pages/${ids.guard_user}`), { headers });
      expect(res.status()).toBe(403);
      expect((await res.json()).detail).toBe('Zugriff verweigert');
    });

    await test.step('die Zielgruppe selbst liest dieselbe Quelle — die Grenze trennt Rollen, nicht Seiten', async () => {
      const headers = await userHeaders(request, fx.resident);
      const res = await request.get(api(`/visu/pages/${ids.guard_user}`), { headers });
      expect(res.status()).toBe(200);
      expect(res.headers()['x-source-page-readonly']).toBe('false');
      const cfg = (await res.json()) as PageConfigResponse;
      expect(cfg.widgets.map((w) => w.name)).toContain(fx.m5.widgets.guard_user);
    });

    await test.step('401 „PIN-Authentifizierung erforderlich": KEINE Verdeckung, sondern eine auflösbare Aufforderung', async () => {
      const res = await request.get(api(`/visu/pages/${ids.guard_pin}`));
      expect(res.status()).toBe(401);
      expect((await res.json()).detail).toBe('PIN-Authentifizierung erforderlich');

      // Auflösbar heißt: der PIN liefert ein Session-Token, das genau diese
      // Seite lesbar macht. Ein stilles Weglassen wäre hier ein Bedienfehler.
      const auth = await request.post(api(`/visu/nodes/${ids.guard_pin}/auth`), { data: { pin: fx.m5.pin } });
      expect(auth.status()).toBe(200);
      const token = (await auth.json()).session_token as string;
      const unlocked = await request.get(api(`/visu/pages/${ids.guard_pin}`), { headers: { 'X-Session-Token': token } });
      expect(unlocked.status()).toBe(200);
      expect((await unlocked.json()).widgets.map((w: { name: string }) => w.name)).toContain(fx.m5.widgets.guard_pin);
    });

    await test.step('404: die Quelle existiert nicht (mehr)', async () => {
      const res = await request.get(api(`/visu/pages/${NONEXISTENT_PAGE_ID}`));
      expect(res.status()).toBe(404);
      // BELEGTE ABWEICHUNG vom Plan: §2.1 notiert für diese Lage das `detail`
      // „Knoten nicht gefunden". Auf der Leitung steht es nie: der globale
      // 404-Handler in `obs/main.py` (`spa_404_handler`) ersetzt das `detail`
      // JEDES 404 unter `/api/` durch „Not found" — `_get_node_or_404` schreibt
      // die deutsche Meldung, der Handler überschreibt sie. Für Teil B heißt
      // das: diese Lage am STATUS erkennen, nie am Text. Hier festgeschrieben,
      // damit die Abweichung nicht wieder still verloren geht.
      expect((await res.json()).detail).toBe('Not found');
    });

    await test.step('400 „Knoten ist keine Seite": das Ziel ist ein Ordner', async () => {
      const res = await request.get(api(`/visu/pages/${ids.location}`));
      expect(res.status()).toBe(400);
      expect((await res.json()).detail).toBe('Knoten ist keine Seite');
    });

    await test.step('dokumentierte GRENZE der Verdeckung: eine lesbare Wirtsseite gibt die IDs ihrer Quellen roh preis', async () => {
      // §2.1: Verdeckung gilt für die Existenz IN DER NAVIGATION, nicht für die
      // ID in einer fremden Seiten-Konfiguration. Das hier festzuschreiben ist
      // Absicht: ändert sich die Zusage, muss sie im Plan geändert werden — sie
      // darf nicht still zwischen Teil B und dem Backend auseinanderlaufen.
      const res = await request.get(api(`/visu/pages/${ids.guard_host}`));
      expect(res.status()).toBe(200);
      const cfg = (await res.json()) as PageConfigResponse;
      expect(cfg.includes).toContain(ids.guard_user);
    });
  });
});
