# Visu × Authorization-Epic — Integrationsdesign

> **Status:** Entwurf zum Review. Phase 0 (PoC-Merge) ausgeführt und belegt.
> Autz-Modell-Entscheidung: **frontend/-Modell 1:1** (page-scoped + PIN + JWT-user).
> Vorgehen: Design-Dok + PoC zuerst, dann gestufte Wellen.

## 1. Warum das nötig ist

Upstream `origin/main` enthält den **Authorization-Epic** (#583/#629): ein
hierarchisches, rollen-/scope-basiertes Berechtigungssystem mit expliziter
Durchsetzung **auch in der Visu**. Unsere mobile Visu (`apps/visu` +
`packages/contract` + Skins) wurde komplett **ohne** dieses System gebaut und ist
blind dafür. Ein reiner Merge ist mechanisch trivial, semantisch aber eine
verdeckte Sicherheitslücke.

## 2. Wie authz die Visu-Endpunkte verändert (belegt)

| Endpunkt (ObsDataSource) | Verhalten nach authz | Quelle |
|---|---|---|
| `GET /visu/tree` | pro Principal **gefiltert**; `user`-Knoten versteckt, Parent-Verweise auf Unsichtbares auf `null` gekappt (keine 403) | `obs/api/v1/visu.py` `_can_discover_node` |
| `GET /datapoints/{id}/value` | fehlt READ → **404 (Concealment)**; anonym nur mit `X-Page-Id` + DP liegt auf Seite + Seiten-Access | `obs/api/v1/datapoints.py` (~692) |
| `POST /datapoints/{id}/value` | fehlt WRITE → **403**; `central_plant` **immer 403** ohne `central_control`-Grant | `datapoints.py` (~771, ~846) |
| `WS /ws` | Subscriptions **READ-gefiltert** (`allowed_dp_ids`); Live-Entzug schneidet DPs; Close **4001** = auth-abgelehnt | `obs/api/v1/websocket.py` (~962, ~164) |
| `POST /auth/login` | JWT trägt **nur `sub`** — keine Rollen; Rechte pro Request DB-aufgelöst | `obs/api/auth.py` |

**Kein Self-Service-Rechte-Endpunkt.** `/auth/me` liefert nur `is_admin`; die
Grants-/Preview-Endpoints sind admin-gated. Der Client erfährt Rechte **nur
implizit** (gefilterter Baum, 404/403, leerer WS-Scope). → optimistisches,
servergetriebenes Muster ist Pflicht, kein Vorab-`can()`.

**Migration konservativ:** Grants werden nur für Nicht-Admins angelegt.
`admin/admin` behält Vollzugriff über die **Admin-Bridge** (`is_admin → allow`).
→ **Unsere 33 Mock-Tests + admin-basierte Läufe bleiben valide.**

## 3. Zielmodell — frontend/-Blaupause 1:1

Die bestehende `frontend/`-Visu autorisiert **überwiegend page-scoped**, nicht
über User-Rollen:

- **Page-Access** (`readonly` / `public` / `protected` / `user`) wird per
  `parent_id`-Traversal bis zum ersten Knoten mit gesetztem `access` aufgelöst;
  `readonly` gated **alle** Schreib-Controls der Seite.
- **Write-Kontext-Header** `X-Page-Id` (immer) + `X-Session-Token` (bei
  `protected`) bei **jedem** DP-Read/Write/Query → „eine Seite darf genau die DPs
  schreiben, die auf ihr liegen" (`_page_has_datapoint`). Kein Admin-Credential
  im Client.
- **PIN** (`POST /visu/nodes/{id}/auth` → `session_token`) für `protected`;
  **JWT-Login** für `user`; `readonly`/`public` ohne Auth. PIN und Grant-System
  koexistieren orthogonal.
- **403 = still verwerfen ODER Control dauerhaft sperren** (MessageArchive-Muster:
  `readForbidden` → Aktion ausblenden), **nie** rote Fehlermeldung.
- **Concealment tolerieren:** DP-Reads „silent" (kein globaler Logout);
  fehlender Wert → Widget ohne Wert, kein Crash.
- **WS-Auth im Aufbau:** JWT als Subprotocol `obs.jwt.<jwt>` **oder**
  `?page_id=&session_token=`; Close **4001** → kein Reconnect; Session-Expired →
  Seite neu laden/re-auth.

Unser heutiger ObsDataSource-Ansatz (admin-JWT, direkte DP-Writes ohne
`X-Page-Id`) ist ein **Antipattern** — funktioniert nur wegen der Admin-Bridge,
untragbar als ausgelieferte Visu (Credentials im Bundle). page-scoped war
ohnehin die richtige Architektur; authz macht den Umbau zwingend.

## 4. PoC-Merge (Phase 0) — ausgeführt

- Branch `integ/authz-upstream` von `feat/visu-mobile-skins`, `git merge origin/main`.
- **0 Konflikte** (auch `.gitignore` automatisch gemergt). 1765 Upstream-Commits
  inkl. authz-Backend integriert; Monorepo (`apps/visu`, `packages/contract`,
  Root-Configs) intakt.
- Gates gegen neuen Upstream: **build ✓ · typecheck ✓ · 294 Tests ✓ · boundaries ✓.**
- **Aussage:** mechanisch trivial; die 294 grünen Tests beweisen *nicht*
  authz-Konformität — sie sind der Beleg für die Grün-Falle.

## 5. Umsetzung in Wellen

### Welle 1 — Contract 1.4 (Fundament)
Skins müssen wissen, ob ein Gerät bedienbar ist (Golden Rule: ein Modell, Skins
stateless).
- **`Device.writable: boolean`** (default `true`) — ob `dispatch` erlaubt ist.
  Startwert leitet sich aus Page-`readonly` ab (device-genaue Verfeinerung optional
  später, siehe §7).
- **Namensfalle:** `Role` im Contract ist Layout-Größe — die authz-Rolle taucht im
  Contract **nicht** auf. Der Contract kodiert nur das *Ergebnis* (`writable`),
  nicht das Rechtemodell (Daten=JSON, Verhalten=Code).
- **Concealed braucht kein Contract-Feld:** verborgene Knoten/DPs kommen gar nicht
  im gefilterten Baum an → erscheinen nicht als `Device`.
- Contract-Bump koordiniert mit Skins (wie beim 1.3-host-actions-Fall: Skins
  zuerst nach main, dann App-Contract — sonst Wächter-Test rot).

### Welle 2 — ObsDataSource auf page-scoped (größter Brocken)
- `list()`: Baum gefiltert akzeptieren; Page-Access per parent-Traversal → `readonly`
  → `writable` pro Device; Initialwerte „silent" (404 → kein Wert).
- Write-Kontext `X-Page-Id` (+ `X-Session-Token`) bei allen DP-Ops; Page-Id pro
  Device aus dem Tree-Mapping mitführen.
- `dispatch()`: 403 → Device als gesperrt markieren / still verwerfen (kein throw).
- Auth-Flows: PIN (`protected`) → `session_token`; JWT-Login (`user`); Access-Gate
  vor dem Rendern.
- `subscribe()`: WS-Auth via Subprotocol/page_id; gefilterten Scope akzeptieren;
  Live-Entzug (subscribe-intersection); Close 4001 → kein Reconnect.
- 401 (global → Login) vs. 403 (lokal → gesperrt) sauber trennen.

### Welle 3 — App/Skin-Rendering
- `writable` im Core-State; Skins rendern Controls disabled/versteckt bei `!writable`.
- dispatch-403 optimistisch behandelt (Control nachträglich sperren).

### Welle 4 — Testabsicherung
- **Mock-Tests:** 403-write → readonly (kein throw); 404-read → kein Wert;
  gefilterter Baum → weniger Devices; WS-Scope-Filter + Live-Entzug; PIN-Flow;
  readonly-Vererbung (parent-Traversal).
- **E2E gegen echten authz-Server** mit `guest`/`resident`/`operator` — die
  eigentliche Sicherheitsverifikation. Ohne diese gilt die Integration nicht als fertig.

## 6. Gates je Welle
`pnpm -r build/typecheck` · `pnpm --filter @obs/visu-app test` · `pnpm lint` ·
`pnpm boundaries`. Contract-Bump zusätzlich: ionic-Wächter-Test (`targetsContract
== version`) + Skins-Koordination. Backend unberührt (reine Client-Arbeit).

## 7. Offene Fragen / zu entscheiden
1. **Device-genaues `writable` vs. nur Page-`readonly`.** frontend/ nutzt nur
   Page-`readonly` (grob) + 403-still. Ein device-genaues „bedienbar"-Vorab-Rendering
   bräuchte einen Batch-Endpunkt (`filter_authorized_datapoints` existiert als
   Service, aber **nicht öffentlich**). **Vorschlag:** Welle 1 nur Page-`readonly`
   (=frontend/-Parität); device-genaue Verfeinerung als späteres Opt-in, falls Bedarf.
2. **Liefert `GET /visu/tree` das effektive `access_mode`?** (Access kommt aus
   `access_view_permissions`, nicht mehr nur `vn.access`.) Vor Welle 2 verifizieren.
3. **`central_plant` proaktiv als gesperrt anzeigen?** Ohne Rechte-Discovery nur via
   403 erfahrbar. Vorschlag: optimistisch (403-still), kein Sonderweg in Welle 1–3.
4. **Integrationsbranch-Strategie:** `integ/authz-upstream` als neue Sprint-Basis
   etablieren (alle künftigen Visu-Wellen darauf) — dann bleibt der Sprint upstream-nah.

## 8. Welle 4 - Ergebnis und Follow-up (2026-08-31)

**Sicherheitsverifikation erbracht (API-Level, echter authz-Server):** Der authz-Smoke
(`apps/visu/e2e/seed.py` + live-Stack) bestaetigt 16/16: gefilterter Tree, 404/403-Concealment,
PIN-Entsperrung (`POST /visu/nodes/{def}/auth`), rollen-scoped Writes inkl. `central_plant`-403,
WS principal (`obs.jwt.<jwt>`) vs. credential-los 4001. Das ist die im Dok geforderte eigentliche
Sicherheitsverifikation. Client-Wellen L1/L2/2b/3b sind je Kritiker-verifiziert, gepusht, visu-ci gruen.

**Browser-E2E aufgedeckte, SEPARATE Luecke (kein authz-Defekt): dynamisches Overview-Layout fehlt.**
Der Playwright-Harness (`apps/visu/playwright.config.ts`, `apps/visu/e2e/*`) ist gebaut und der
Stack-Aufbau/Seed funktioniert; der UI-Lauf blockiert aber, weil die OBS-Modus-Visu gegen ein echtes
Backend gar nicht mountet: `resolveLayout: layout entry "kueche-wand" references no device`.
Ursache: das Overview-Layout ist statisch im Demo-Modell hartcodiert (`apps/visu/src/core/model.ts`
gruppiert Raeume mit Mock-Geraete-Ids), statt dynamisch aus dem gefilterten `GET /visu/tree`
(Raeume/Seiten/Geraete) gebaut zu werden. Gegen echte Backend-Geraete (andere Ids) wirft
`skin-host/layout.ts` und die App crasht vor dem Mount.

**Follow-up-Track (eigenstaendig, ausserhalb authz-Scope): Overview-Layout aus dem Backend-Tree.**
Die Visu muss ihr Overview (Gruppierung/Reihenfolge/Geraete) im OBS-Modus aus dem gefilterten Tree
ableiten (Raeume aus den PAGE/Location-Knoten, Geraete aus den gemappten Widgets), statt aus dem
statischen `model.ts`. Erst danach wird der Browser-E2E (`apps/visu/e2e/authz-roles.spec.ts`) gruen;
die authz-Assertions darin sind bereits korrekt formuliert. Der Harness bleibt turnkey (siehe
`apps/visu/e2e/README.md`).
