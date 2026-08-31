# Visu × Login-Konzept — Design-Skizze (Entwurf zum Review)

> Ergänzt CONTRIBUTING-visu-authz.md. Entscheidung: **Login jetzt einführen** — additiv,
> als Opt-in, das per-User-RBAC freischaltet. **Lesen und einfacher Gebrauch bleiben
> ohne Login (Gast).** Login wird NIE fürs Lesen erzwungen.

## 1. Drei Zugriffsebenen (additiv, koexistierend)

| Ebene | Auth | Kann | WS |
|---|---|---|---|
| **Gast** (Default) | keine | `public`/`readonly` lesen + einfache Bedienung auf nicht-gesperrten Seiten | page-scoped je Seite (bzw. Poll) |
| **PIN** | `session_token` je Seite | `protected`-Seiten (weiterhin ohne Nutzeridentität) | page-scoped je Seite mit `session_token` |
| **Login (JWT)** | `Authorization: Bearer` | per-User-Grants/Schreiben, `central_control`, `user`-Seiten, alles was eine Identität braucht | **ein** principal-scoped Socket (alle erlaubten DPs) |

PIN und Login **schließen sich nicht aus** (authz-Dok §3: koexistieren orthogonal). Ein
eingeloggter Nutzer kann zusätzlich eine PIN-Seite freischalten (Header stapeln:
`Bearer` + `X-Session-Token` + immer `X-Page-Id`).

## 2. JWT-Flow (frontend/-Blaupause 1:1)

- **Login:** `POST /auth/login` (user/pass) → `{ access_token (24h), refresh_token (30d) }`.
- **Speicherung:** wie `frontend/src/api/client.ts` — `localStorage('visu_jwt')` (getJwt/setJwt/
  clearJwt spiegeln). Refresh-Token separat (`visu_refresh`). *(Offene Frage §6: localStorage
  vs. sessionStorage — XSS-Abwägung; Blaupause nutzt localStorage.)*
- **REST:** `Authorization: Bearer <access>` an allen Requests, wenn eingeloggt; sonst weglassen
  (Gast). `X-Page-Id`/`X-Session-Token` bleiben unabhängig davon bestehen.
- **Refresh:** Access-401 → `POST /auth/refresh` mit Refresh-Token → neuer Access; still im
  Hintergrund. Refresh-fehlgeschlagen/abgelaufen → **auf Gast zurückfallen** + optionaler
  Re-Login-Prompt. Kein harter Crash. *(§6: /auth/refresh-Endpoint verifizieren.)*
- **Logout:** `clearJwt()` → zurück auf Gast; laufende principal-WS schließen, page-scoped/Poll
  wieder aufsetzen.

## 3. WebSocket-Modell (löst die Audit-Kernlücke)

- **Eingeloggt:** EIN Socket via Subprotocol `obs.jwt.<access>` (Browser kann keinen
  Authorization-Header auf WS setzen) → principal-scoped, liefert alle erlaubten DPs → das
  Aggregat-Overview ist damit trivial abgedeckt.
- **Gast/PIN:** page-scoped Socket je sichtbarer Seite (`?page_id=&session_token=`) — der heutige
  **kontextlose** Socket (`obs-datasource.ts:202`) ist der Bug (Server-Close 4001) und muss weg.
  Wo ein Mehrseiten-Scope ohne Identität nicht geht: Werte per Poll (`getValue`, page-scoped).
- Close **4001** → kein Reconnect (schon korrekt); Live-Entzug (subscribe-intersection) bleibt.

## 4. UI

- **Gast ist Default — keine Login-Wand.** Lesen/einfache Bedienung sofort.
- Login-Einstieg im Menü/Hamburger: Formular (user/pass), eingeloggt-Indikator, Logout.
- Gesperrte Controls (`!writable`) zeigen optional einen Hinweis „Login/PIN nötig" statt stumm —
  aber weiterhin **keine rote Fehlermeldung**, kein Zwang.
- `user`-Seiten: hinter Login gated (Gast sieht „Login erforderlich" oder ausgeblendet).

## 5. Umsetzung in Wellen (Quality-Loop, je max 20 Runden)

- **Welle L — Login-Fundament:** JWT-Client (get/set/clear wie frontend/), `/auth/login` +
  `/auth/refresh`, Bearer an ObsClient-REST, 401→refresh→Gast, Login-UI (Formular/Indikator/Logout).
- **Welle 2b — WS page-scoped/principal:** kontextlosen Socket ersetzen; Gast/PIN = page-scoped
  je Seite (bzw. Poll), eingeloggt = principal-Socket (`obs.jwt`). Behebt Audit-Lücke 1.
- **Welle 3b — PIN-Gate + user-Seiten:** `authenticatePage` verdrahten (PIN-Prompt vor protected),
  `user`-Seiten hinter Login. Behebt Audit-Lücke 2.
- **Welle 4 — Absicherung:** WS-Mock-Test so umbauen, dass credential-los = 4001 (Test erzwingt
  den Fix, statt den Bug festzuschreiben); E2E gegen echten authz-Server mit `guest`/`resident`/
  `operator`. Behebt Audit-Lücke 3.

## 6. Offene Fragen / zu verifizieren
1. **JWT-Speicherung:** localStorage (Blaupause) vs. sessionStorage/in-memory. XSS-Risiko in
   einer ausgelieferten Visu. Vorschlag: localStorage wie frontend/ (Parität), Refresh separat.
2. **`/auth/refresh`-Endpoint** existiert (create_refresh_token ja) — Route/Signatur verifizieren.
3. **Gast-WS:** page-scoped-je-Seite vs. Poll — je nach Anzahl sichtbarer Seiten. Für das
   Aggregat-Overview evtl. Poll für Gast, principal-Socket sobald eingeloggt.
4. **E2E-Infrastruktur (Welle 4):** laufender authz-Server + Testnutzer guest/resident/operator
   (Docker/Fixture) — separat aufzusetzen.

## 7. Golden Rules (unverändert)
Daten=JSON/Verhalten=Code · Skin stateless · 403 still/sperren (nie rote Meldung) · Concealment
tolerieren (kein globaler Logout bei DP-404) · optimistisch/servergetrieben · kein Credential im
Bundle (Login-Token stammt vom Nutzer, nicht aus dem Build).
