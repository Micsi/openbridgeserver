# Visu E2E — authz-Rollen (Welle 4) + M5-Messlatten-Harness

Zwei Suiten in einem Verzeichnis, gegen **einen** laufenden, geseedeten
obs-Server:

1. **`authz-roles.spec.ts`** — die Sicherheitsabnahme der authz-Welle 4
   (`CONTRIBUTING-visu-authz.md` §5): die mobile Visu im Browser gegen den
   echten Server, Verdeckung · PIN-Gate · rollenbezogene Sichtbarkeit.
2. **`m5-*.spec.ts`** — der **Messlatten-Harness** der Welle M5
   (`CONTRIBUTING-visu-m5.md` §1 Regeltabelle R1-R16, §1.1 Editor-Matrix
   E1-E19, Issue Micsi/openbridgeserver#175). Die Specs *sind* die Messlatte:
   genau ein Szenario je Zeile, der Testname ist das Kriterium aus dem Plan.
   Siehe [Messlatten-Harness (M5)](#messlatten-harness-m5) unten.

Beide Suiten teilen `seed.py`, `fixtures.ts` und die Playwright-Konfiguration.
Die Schritte 1-6 unten bringen den Stapel hoch (Mosquitto, Backend, Seed,
Visu-Dev-Server) und gelten für beide.

## Suite 1 — Visu × authz role E2E (Welle 4)

The **real** security verification for the Visu × authz integration
(`CONTRIBUTING-visu-authz.md` §5, Welle 4): the mobile Visu driven by a headless
browser against a **live, authz-seeded obs server**, asserting the authz truth
(concealment, PIN gate, role-scoped visibility) — not a mock.

This is a **separate run** from the mandatory visu-ci gates (`pnpm --filter
@obs/visu-app test`, `pnpm lint`, `pnpm boundaries`). It needs a browser, a
backend and a seeded DB, so it is intentionally kept out of those gates.

All credentials/PINs used here are **throwaway test values** for an ephemeral
instance (see `seed.py`). Never reuse them.

## What runs where

- **A) API-level authz smoke** (`GET/POST /visu/…`, `/datapoints/…`, WS) is proven
  separately and does not need a browser.
- **B) This browser E2E** must be run by the orchestrator on a machine with a
  Chromium install (`pnpm --filter @obs/visu-app exec playwright install chromium`).

## Prerequisites (once)

```bash
# from repo root
pnpm install
pnpm --filter @obs/visu-app exec playwright install chromium
```

## Step 1 — Mosquitto (anonymous, Colima/Docker)

The obs lifespan needs MQTT. Use an anonymous broker on a free port. On this
project Docker is Colima, and the conf mount must live under `/Volumes/Daten/tmp`
(only that path is mounted into the VM), so set `TMPDIR` accordingly.

```bash
export TMPDIR=/Volumes/Daten/tmp
printf 'listener 1883\nallow_anonymous true\n' > "$TMPDIR/e2e_mosq.conf"
MQTT_CID=$(docker run -d -p 127.0.0.1:1884:1883 \
  -v "$TMPDIR/e2e_mosq.conf:/mosquitto/config/mosquitto.conf:ro" eclipse-mosquitto:2)
```

## Step 2 — Backend (venv/uvicorn, NOT a Docker image) + owner seed

Run the server from the repo root with a fresh SQLite DB pointed at that broker.
Do **not** build the Docker image (slow); use the venv (`.venv` symlinks the main
worktree's env).

```bash
export TMPDIR=/Volumes/Daten/tmp                        # nur fuer den Colima-Mount
export E2E_STATE=${E2E_STATE:-$HOME/.cache/obs-e2e}     # DB auf die INTERNE Platte (s. Falle unten)
mkdir -p "$E2E_STATE"
export OBS_CONFIG=$TMPDIR/e2e_nonexistent.yaml          # isolate from any host config.yaml
export OBS_DATABASE__PATH=$E2E_STATE/e2e_obs.db
export OBS_DATABASE__HISTORY_PLUGIN=sqlite
export OBS_MQTT__HOST=localhost
export OBS_MQTT__PORT=1884
export OBS_SECURITY__JWT_SECRET=e2e-integration-secret-32-chars-xx
export OBS_SECURITY__JWT_EXPIRE_MINUTES=60
export OBS_MOSQUITTO__PASSWD_FILE=$E2E_STATE/e2e_obs_passwd

# seed the first owner into the fresh DB
.venv/bin/python - <<'PY'
import asyncio, os
from obs.db.database import Database
from obs.admin_cli import create_first_owner
db = Database(os.environ["OBS_DATABASE__PATH"])
asyncio.run(db.connect()); asyncio.run(db.disconnect())
create_first_owner(os.environ["OBS_DATABASE__PATH"], username="admin", password="e2e-admin-pw", backup=False)
PY

# start the live server on :8080
.venv/bin/python -m uvicorn --factory obs.main:create_app --host 127.0.0.1 --port 8080 &
OBS_PID=$!
# wait for health
until curl -sf http://127.0.0.1:8080/api/v1/system/health >/dev/null; do sleep 0.3; done
```

## Step 3 — Seed the fixtures (authz roles **and** the M5 world)

Seeds users (`e2e_resident`, `e2e_operator`), the datapoints, the
`public`/`readonly`/`protected`/`user` pages + a room page, the widgets, the
grants (via the admin-gated authz grants API) and the `user`-page audience. Fixed
names match `authz-roles.spec.ts`. Since M5 the same script also seeds the
Seitentypen-Beispielwelt (`M5 …`, siehe
[Die Beispielwelt](#die-beispielwelt-seedpy-m5-teil)). Writes `e2e/.seeded.json`
— the specs read the generated node ids from there.

Der Seed ist **idempotent**: ein zweiter Lauf legt nichts doppelt an und liest am
Ende alles zurück. `.venv` ist im M5-Worktree kein Symlink — dort den Interpreter
des Hauptworktrees nehmen (`../openbridgeserver/.venv/bin/python`).

```bash
OBS_BASE=http://127.0.0.1:8080 OBS_ADMIN_USER=admin OBS_ADMIN_PASSWORD=e2e-admin-pw \
  .venv/bin/python apps/visu/e2e/seed.py
```

> Die M5-Specs brauchen `OBS_BASE` **auch beim Testlauf** (sie prüfen die
> Regeltabelle direkt am Backend, nicht über den Vite-Proxy) — siehe
> [Harness starten](#harness-starten).

## Step 4 — Visu dev server pointed at the seeded backend

The Visu only wires up the real `ObsDataSource` when opted in via `VITE_USE_OBS=1`
(or `VITE_OBS_API`); `/api` REST + WebSocket are proxied to `VITE_OBS_PROXY_TARGET`.

```bash
VITE_USE_OBS=1 VITE_OBS_PROXY_TARGET=http://127.0.0.1:8080 \
  pnpm --filter @obs/visu-app dev &          # serves http://localhost:5175
VISU_PID=$!
```

## Step 5 — Run the E2E

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5175 pnpm --filter @obs/visu-app e2e
# report:
pnpm --filter @obs/visu-app e2e:report
```

Alternatively let Playwright manage only the Visu dev server (backend must already
be up + seeded):

```bash
PLAYWRIGHT_MANAGE_WEBSERVER=1 VITE_OBS_PROXY_TARGET=http://127.0.0.1:8080 \
  pnpm --filter @obs/visu-app e2e
```

## Step 6 — Teardown (no zombies)

```bash
kill $VISU_PID $OBS_PID 2>/dev/null || true
docker stop "$MQTT_CID" && docker rm "$MQTT_CID"
rm -rf "$E2E_STATE" "$TMPDIR/e2e_mosq.conf" apps/visu/e2e/.seeded.json
rm -rf apps/visu/.auth apps/visu/test-results apps/visu/playwright-report
```

## Notes / open points for the runner

- **Browser step is orchestrator-run.** The specs and selectors were authored
  against the current shell markup (`.login-open`/`.login-submit`/`.login-logout`,
  `.access-gate*`, `Signed in as …`, `getByLabel('Username'|'Password'|'Enter
  PIN')`) but have **not** been executed end-to-end here. Expect to adjust a
  locator if the shell markup drifts. The assertions themselves encode authz
  truth and must stay.
- Device tiles are matched by their seeded **widget name** (e.g. `Public Lamp`,
  `Private Blind`). The Visu overview page renders every authz-visible device, so
  concealment shows up as a widget name with `toHaveCount(0)`.
- If the shell renders no `ion-menu` on desktop widths, open the LoginPanel by
  whatever affordance the shell exposes and keep the `.login-*` interactions.
- Keep this run out of the visu-ci pipeline; it is a manual/dedicated E2E lane.

## Status (2026-08-31): Browser-E2E gruen

Der Browser-E2E laeuft **4/4 gruen** (zweimal, non-flaky) gegen einen frisch geseedeten
authz-Server (guest/PIN/resident/operator), zusaetzlich zum API-Smoke (16/16). Drei
Integrations-Schichten wurden dafuer geschlossen (Details in CONTRIBUTING-visu-authz.md §8.1):
dynamisches Overview-Layout aus dem Backend-Tree, Per-Page-Config-Fetch
(`GET /visu/pages/{id}`, da `/visu/tree` nur eine Summary ohne `page_config` liefert), und die
AccessGate-Bedienbarkeit ueber dem `ion-router-outlet`. Die Playwright-Config nutzt bewusst einen
Mobile-Viewport, damit das `ion-menu`-Drawer (LoginPanel/AccessGate) rendert.

---

# Messlatten-Harness (M5)

Teil **E** der M5-Welle (Issue Micsi/openbridgeserver#175). Die Specs sind die
Messlatte, an der die ganze Welle gemessen wird: **genau ein Szenario je Zeile**
der Regeltabelle R1-R16 (`CONTRIBUTING-visu-m5.md` §1) und der Editor-Matrix
E1-E19 (§1.1). Der **Testname ist wörtlich das Kriterium** aus dem Plan, damit
die Zuordnung Zeile ↔ Szenario eindeutig bleibt und ohne Nachschlagen prüfbar
ist. R17 (V1 bleibt unberührt) ist kein E2E-Szenario, sondern das V1-Vitest-Gate
des Backend-Teils; E20-E22 stehen ausdrücklich außerhalb des M5-Scopes (§1.1).

Ein Szenario ist entweder **laufend** (grün gegen das echte Backend) oder
**`test.fixme`** mit `blocked-by`-Annotation, die den zuständigen Teil und sein
Issue nennt. Kein `test.skip` ohne Begründung, kein leerer Rumpf, keine Attrappe
die immer grün ist: ein `fixme`-Szenario ist vollständig ausgeschrieben und wird
grün, sobald der genannte Teil liefert.

## Harness starten

Voraussetzungen und Schritte 1-4 oben (Mosquitto, Backend, Seed, Visu-Dev-Server)
gelten unverändert; der Harness braucht zusätzlich nur die Umgebungsvariablen,
die auf **dasselbe** Backend zeigen wie der Seed:

```bash
# 0) Health-Check VOR dem Start — der Harness prüft das Backend, nicht sich selbst
export OBS_BASE=http://127.0.0.1:8080
curl -sf "$OBS_BASE/api/v1/system/health" || { echo "Backend nicht erreichbar"; exit 1; }

# 1) State-Leaks vermeiden (Reste eines früheren Laufs)
rm -rf apps/visu/test-results apps/visu/playwright-report
rm -f apps/visu/e2e/.seeded.json
# `apps/visu/e2e/.auth` NICHT löschen, solange dieselbe Instanz läuft: dort steht
# das verbrauchte Login-Kontingent. Bei einer FRISCHEN Instanz darf es weg (die
# alten Tokens werden ohnehin erkannt und verworfen); es kostet dann nur bis zu
# einer Minute Wartezeit, wenn kurz zuvor schon ein Lauf gefahren wurde.
# Wird die Datei ZWISCHEN Seed und Lauf zerstört (kaputter Inhalt statt gelöscht),
# ist die Anmeldung des Seeds nicht mehr verbucht und der Lauf kann in ein 429
# laufen. Der sichere Weg ist immer: erst `.auth` weg, DANN seeden, dann fahren;
# der Seed baut die Buchführung dabei wieder auf.

# 2) Seed (idempotent — zweimal laufen lassen ist erlaubt und aendert nichts)
OBS_BASE=$OBS_BASE OBS_ADMIN_USER=admin OBS_ADMIN_PASSWORD=e2e-admin-pw \
  .venv/bin/python apps/visu/e2e/seed.py

# 3) Harness
cd apps/visu
OBS_BASE=$OBS_BASE OBS_ADMIN_USER=admin OBS_ADMIN_PASSWORD=e2e-admin-pw \
  PLAYWRIGHT_BASE_URL=http://localhost:5175 \
  ./node_modules/.bin/playwright test
```

| Variable | Zweck | Vorgabe |
|---|---|---|
| `OBS_BASE` | Backend, gegen das die Regeltabelle direkt prüft (nicht über den Vite-Proxy) | `http://127.0.0.1:8080` |
| `OBS_ADMIN_USER` / `OBS_ADMIN_PASSWORD` | Wegwerf-Owner der ephemeren Instanz | `admin` / `e2e-admin-pw` |
| `PLAYWRIGHT_BASE_URL` | Visu-Dev-Server für die UI-Szenarien | `http://localhost:5175` |
| `GUI_BASE_URL` | Admin-GUI, in der der V2-Editor liegt (§2.4); nur die E-Szenarien nutzen sie | `http://localhost:5173` |

`POST /api/v1/auth/login` ist auf **5 Anmeldungen pro Minute** begrenzt
(`@limiter.limit("5/minute")`, `obs/api/auth.py:471`; bis Runde 1 stand hier
irrtümlich 10, die Bremse ist doppelt so eng wie dokumentiert). Deshalb zwei
Vorkehrungen:

- **Ein Speicher für den ganzen Harness.** `e2e/.auth/tokens.json`
  (gitignoriert, ephemer, Modus 0600, nur JWTs, keine Passwörter) wird von
  `seed.py` **und** `fixtures.ts` gelesen und geschrieben. `seed.py` ist der
  erste Verbraucher des Kontingents und legt sein Admin-Token dort ab;
  `global-setup.ts` holt nur noch, was fehlt (resident, operator). Neben den
  Tokens führt die Datei eine Liste der **Anmelde-Zeitstempel**, und zwar auch
  für die zwei Anmeldungen, die durch die echte Maske laufen und gar kein Token
  hinterlassen. Das Kontingent zählt Anmeldungen, nicht Nutzernamen: ohne diese
  Buchung hielte ein unmittelbar folgender zweiter Lauf das Fenster für freier,
  als es ist (an genau der Stelle ist Lauf 2 in der Erprobung rot geworden).
- **Der Zwischenspeicher überlebt den Worker.** Playwright startet nach jedem
  roten Szenario einen neuen Worker; ein rein modulglobaler Cache wäre genau
  dann weg, wenn der Harness gebraucht wird, und die Folgeszenarien liefen in
  `429 Too Many Requests` statt in ihre Aussage. `fixtures.ts` liest deshalb
  zuerst den Speicher im Modul, dann die Datei (ein abgelegter Token wird nur
  benutzt, solange er noch mindestens eine Minute gilt), und erst dann meldet es
  sich an.
- **Der Rest des Kontingents bleibt der UI.** `authz-roles.spec.ts` meldet
  resident und operator durch die echte Anmeldemaske an, und das IST die Aussage
  dieser beiden Szenarien, ein Token-Cache kann sie nicht abkürzen. Die Rechnung
  geht damit exakt auf: Seed 1 + vorgeholt 2 + UI 2 = 5. `global-setup.ts` prüft
  das vor der Übergabe an den Lauf und **wartet** das Fenster aus, wenn mehr
  verbraucht wurde (etwa weil jemand von Hand einen Login gepollt hat), statt
  den Lauf in ein 429 laufen zu lassen. Diese Prüfung ist erst durch den
  Warmlauf nötig geworden: vorher verteilten sich dieselben Anmeldungen über
  zwei bis drei Minuten, jetzt fallen sie in dieselbe Minute.

Ein 429 meldet der Harness als solches, mit der Ursache im Text, nicht als
vermeintlich gescheiterte Regel. Und beide Aufbau-Schritte **warten** es
einmalig aus, statt daran zu sterben: `seed.py` sitzt das Minutenfenster aus und
meldet das (Aufbau ist kein Test, hier ist Warten billig), `global-setup.ts`
ebenso. Ein Token, das aus einer früheren Datenbank derselben Adresse stammt,
wird vorher über `GET /auth/me` erkannt und verworfen; das kostet einen Aufruf,
aber keine Anmeldung, und erspart die Suche nach einem 401, das gar keine
Regelaussage ist.

`global-setup.ts` fährt außerdem einen **Warmlauf** gegen den Visu-Dev-Server
(`/` und `/edomi`), bevor das erste Szenario startet. Grund, gemessen statt
geglaubt: Vite transpiliert on demand, der allererste Seitenaufruf einer Sitzung
kostet 26-48 s, dieselben Szenarien gegen denselben warmgelaufenen Dev-Server
1,0-2,9 s. Diese Einmal-Kosten gehören nicht in die Zeitmessung eines Szenarios,
deshalb liegen sie außerhalb jedes Test-Timeouts und der Test-Timeout bleibt bei
**30 s** (nicht 60 s: ein Szenario, das mit warmem Server 30 s braucht, hat ein
echtes Problem und soll rot werden). Beide Schritte sind nachsichtig: schlägt
einer fehl, meldet das Setup es sichtbar und der Lauf beginnt trotzdem.

## Zwei Pflichtläufe

Der Harness wird **zweimal** gefahren und jeder Lauf klassifiziert als
`pass` / `flaky` (erst rot, im Retry grün) / `fail`:

1. **Frische leere Instanz** — DB löschen, Owner anlegen, Backend starten, Seed
   **einmal**, Harness. Ein `fail` hier ist ein **Blocker**.
2. **Befüllte Instanz** — dieselbe Instanz, Seed **erneut** (belegt die
   Idempotenz), Harness. Dieselben Zahlen wie Lauf 1 sind das Sollergebnis.

```bash
# fresh: DB + Ringbuffer-Segmente + Message-Archiv wegräumen
rm -f  "$OBS_DATABASE__PATH" "$OBS_DATABASE__PATH-wal" "$OBS_DATABASE__PATH-shm"
rm -rf "$(dirname "$OBS_DATABASE__PATH")/archives" "${OBS_DATABASE__PATH%.db}_ringbuffer_segments"
```

> **Zwei belegte Fallen mit `/Volumes/Daten`** (dem externen Volume, das nur
> wegen des Colima-Mounts für Mosquitto `TMPDIR` sein muss):
>
> 1. Liegt die **SQLite-Datei** dort, bleibt der Start in der
>    Ringbuffer-Initialisierung hängen — uvicorn meldet nichts, der Prozess lebt,
>    es horcht kein Port. DB-Pfad auf die interne Platte legen.
> 2. Läuft **Playwright** mit `TMPDIR=/Volumes/Daten/tmp`, legt Chromium sein
>    Profil dorthin; die Browser-Szenarien laufen dann in „Tearing down context
>    exceeded the test timeout" statt in eine echte Aussage. `TMPDIR` also für
>    Mosquitto/Backend setzen, aber **nicht** in die Shell exportieren, in der
>    `playwright test` läuft.

### Ergebnis der Pflichtläufe (Runde 3, 2026-09-04, mit dem Host aus Teil B)

`OBS_BASE` = `http://127.0.0.1:8099` (Backend, venv/uvicorn), Visu-Dev-Server auf
`http://localhost:5199`, Mosquitto anonym auf `127.0.0.1:1899` (Colima).
Health-Check vor beiden Läufen grün.

| Lauf | Instanz | pass | fixme | flaky | fail | Dauer |
|---|---|---|---|---|---|---|
| 1 | frisch + leer, Dev-Server **kalt**, Seed **einmal** | 19 | 20 | 0 | 0 | 45,0 s |
| 2 | dieselbe Instanz, Seed **erneut**, direkt im Anschluss | 19 | 20 | 0 | 0 | 1,3 min |

Der Sprung von 12 auf 19 ist die Lieferung von Teil B (#167): **R7, R8, R9, R10,
R11, R13 und R14** waren mit `blocked-by`-Annotation auf die Host-Komposition
ausgeschrieben und laufen seither **unverändert**: kein Selektor, keine
Erwartung und kein Timing musste nachgezogen werden, damit sie grün werden.

Über beide Läufe: **7 Anmeldungen, alle `200`, kein einziges `429`** (Seed 1,
vorgeholt 2, UI 2 je Lauf). Lauf 2 folgte unmittelbar auf Lauf 1; das
Minutenfenster war beim Übergeben bereits wieder offen, `global-setup.ts` musste
diesmal nicht warten. Der Fall „Fenster voll" ist getrennt belegt (Runde 2:
Meldung `5 von 5 Anmeldungen … verbraucht`, 38 s gewolltes Warten, danach grün).

Nach dem zweiten Seed stehen weiterhin **20 Knoten** und **20 Datenpunkte** in
der Instanz — die Idempotenz ist damit an der Instanz belegt, nicht nur behauptet.
(Am Baum sieht ein Admin davon 18: die beiden `user`-Seiten `E2E Private` und
`M5 Guard User` haben eine Zielgruppe, in der er nicht steht. Gezählt wird
deshalb in der Datenbank.) Die 19 grünen Szenarien sind R1-R15 ohne R16 und ohne
R17 sowie die vier Bestands-Szenarien der authz-Welle 4; die 20 `fixme` sind R16,
E1-E13 und E15-E19.

Die vier Browser-Szenarien der authz-Welle, an denen die Timeout-Frage hing,
brauchten in Lauf 1 (kalt gestarteter Dev-Server, Warmlauf davor) **10,0 / 5,2 /
3,2 / 3,2 s** statt der 26-48 s ohne Warmlauf; die sieben neu hinzugekommenen
Host-Szenarien R7-R11/R13/R14 liegen zwischen **1,1 und 2,1 s**. Das ist der
Beleg dafür, dass der Kostentreiber die Vite-Transpilierung war und nicht die
gewachsene Beispielwelt, und dass die 30-s-Decke mit Rand reicht.

**Belegte Heilung des Seeds.** Vorbedingung von Hand hergestellt (direkter
SQLite-Schreibzugriff: `M5 Global A` bekommt bei `kind=globalInclude` einen
`includes`-Eintrag, an der API sichtbar, und der reine PATCH quittiert mit
`400 Eine globale Inkludeseite kann selbst keine Seiten inkludieren`). Der Seed
dagegen: `rc=0`, Meldung `seed: M5 Global A geheilt (Seitenkonfiguration
kollidierte mit kind='globalInclude')`, danach `kind=globalInclude`, `order=10`,
`includes=[]`, Widget steht, Bestand unverändert 20/20.

**Belegte Schärfe der Zielgruppen-Schranke.** Mit der Mutation „nur der
Zielgruppen-Check in `_check_page_read_access` entfällt" (Datenpunkt-Policy
bleibt) wird R15 rot: `Expected: 403 / Received: 200` im Schritt „403 Zugriff
verweigert". Ohne das Leserecht des operators auf `dp-m5-guard-user` hätte die
Policy denselben 403 nachgeliefert und die Mutation überlebt.

## Abdeckung — welche Zeile prüft welches Szenario

**Regeltabelle R1-R16** (`CONTRIBUTING-visu-m5.md` §1)

| Zeile | Spec | Status | Grund / zuständig |
|---|---|---|---|
| R1 Seitentyp normal/Include/globalInclude/Popup | `m5-pagetypes.spec.ts` | **läuft** | Backend-Enum + Baum; die Editor-Auswahl prüft E9, das Nav-Badge Teil B |
| R2 Popup X/Y in px, fehlt eine Angabe → zentriert | `m5-pagetypes.spec.ts` | **läuft** | Deskriptor: gesetzte Koordinate bleibt, fehlende bleibt `null` (kein 0-Default) — daran erkennt der Host „zentriert". Das gerenderte Zentrieren belegt R16 |
| R3 Popup Breite/Höhe in px | `m5-pagetypes.spec.ts` | **läuft** | wie R2 |
| R4 Popup automatisch schließen nach Zeitspanne | `m5-pagetypes.spec.ts` | **läuft** | `auto_close_ms` gesetzt und (Gegenprobe) `null` statt 0 |
| R5 Popup exklusiv öffnen = modal, Rest inert | `m5-pagetypes.spec.ts` | **läuft** | `modal` beide Seiten; das `inert` im Skin belegt R16 |
| R6 Animation, Schlagschatten, Hintergrund abdunkeln | `m5-pagetypes.spec.ts` | **läuft** | die drei Flags einzeln und unabhängig |
| R7 Auto-Close verlängert sich beim erneuten Öffnen nicht | `m5-pagetypes.spec.ts` | **läuft** | echte Zeitachse, zeitscharf: öffnen, nach 900 ms erneut öffnen, und der ZEITPUNKT des Verschwindens muss auf 1500 ± 400 ms nach dem ERSTEN Öffnen fallen. Ein beim Wiederöffnen neu gestarteter Timer (2400 ms) liegt außerhalb und macht die Zeile rot |
| R8 Beliebig viele verschiedene Popups gleichzeitig | `m5-pagetypes.spec.ts` | **läuft** | zwei verschiedene Popups nebeneinander; dasselbe zweimal geöffnet gibt keine Dublette |
| R9 globale Inkludeseite in jede normale Seite, nicht in Popups | `m5-composition.spec.ts` | **läuft** | beide Seiten der Regel: zwei normale Seiten mit beiden globalen Layern, ein Popup ohne |
| R10 mehrere globale Includes aufsteigend nach `order` | `m5-composition.spec.ts` | **läuft** | `data-layer` in Renderreihenfolge = Stapelreihenfolge, kleinste `order` zuunterst |
| R11 Direktaufruf zeigt die anderen globalen nicht | `m5-composition.spec.ts` | **läuft** | über die Link-Kachel aufgerufen; die eigene Ebene steht, die zweite globale fehlt |
| R12 globale Inkludeseite inkludiert selbst nichts (400) | `m5-composition.spec.ts` | **läuft** | 400 + folgenlos + erlaubte Gegenprobe auf einer normalen Seite |
| R13 normale Seite kann globale Includes ignorieren | `m5-composition.spec.ts` | **läuft** | beide Hälften wie bei R2-R6: `ignore_global_includes` am Backend (true **und** false) und kein globaler Layer im Bild |
| R14 individuelle Inkludeseite wird eingebettet | `m5-composition.spec.ts` | **läuft** | `include`-Ebene unter der eigenen; die eingebetteten Elemente tragen dieselben `data-id` wie beim Direktaufruf (kein Datenfork) |
| R15 Include quer über eine Zugriffsgrenze | `m5-authz-include.spec.ts` | **läuft** | die ganze Signalliste aus §2.1 + `X-Source-Page-Readonly` + Verdeckung im Baum |
| R16 Editor-Round-Trip | `m5-editor-roundtrip.spec.ts` | `fixme` | Teil C1 #168 (Teil B #167 ist geliefert, siehe „Was bewusst offen bleibt") |

R17 („V1 bleibt unberührt und grün") ist kein E2E-Szenario: das belegt der
V1-Vitest-Lauf des Backend-Teils.

**Editor-Matrix E1-E19** (`CONTRIBUTING-visu-m5.md` §1.1) in
`m5-editor-matrix.spec.ts`, **E14 in `m5-editor-touch.spec.ts`** (eigenes
Playwright-Projekt, s. u.); alle `fixme`, denn der V2-Editor liegt in `gui/` und ist
noch nicht gebaut (§6: C1-C6 auf „offen"). Die geteilten Bedien-Affordanzen
stehen in `editor-helpers.ts`, damit beide Dateien gegen dieselbe Anforderung
bauen:

| Zeile | zuständig | Zeile | zuständig |
|---|---|---|---|
| E1 Drag auf x/y + Snap | C2 #169 | E11 Datenpunkt-Bindung + Live-Wert | C3 #170 |
| E2 Reihenfolge per Drag, Order stabil | C2 #169 | E12 Seitenversionen + Wiederherstellen | C6 #173 |
| E3 Vorschau = Live-Renderer (Pixel-Diff 0) | C4 #171 | E13 JSON- und visuelle Ansicht synchron | C6 #173 |
| E4 Ausrichtlinie/Verteilen/gleiche Größe | C2 #169 | E14 Touch-Drag wie Maus-Drag | C5 #172 |
| E5 Mehrfachauswahl + Gruppieren | C5 #172 | E15 Zugriff/Zielgruppe in Seiteneigenschaften | C1 #168 |
| E6 Copy/Paste/Duplizieren, seitenübergreifend | C5 #172 | E16 bedingte Sichtbarkeit je Datenpunktwert | C3 #170 |
| E7 Undo/Redo + Pfeiltasten-Nudging | C5 #172 | E17 Responsive-Breakpoints | C2 #169 |
| E8 Z-Ordnung, sperren/ausblenden | C2 #169 | E18 Export/Import als Datei | C6 #173 |
| E9 Seitentypen wählbar und wirksam | C1 #168 | E19 Skin/Theme pro Seite oder global | C1 #168 |
| E10 zentrale Vorlage propagiert automatisch | C3 #170 | | |

Die Bedien-Affordanzen der E-Szenarien (Rollen, Beschriftungen, die
`[data-el]`-Marke am Canvas-Element) sind die **Anforderung des Harness** an den
Editor. Wählt C1-C6 eine gleichwertige andere Affordanz, zieht der Harness nach —
die Behauptung des Szenarios bleibt.

### Zwei Zeilen, die ihre eigene Vorkehrung brauchen

Ein `fixme` ist nur dann etwas wert, wenn es nach Lieferung seines Teils grün
werden **kann**. Zwei Zeilen konnten das nicht und tragen jetzt die nötige
Vorkehrung:

- **E14 (Touch-Drag)** verlangt `page.touchscreen`, und Playwright verweigert das
  ohne `hasTouch` im Kontext („hasTouch must be enabled on the browser context
  before using the touchscreen.", Playwright 1.62.1). Nachgemessen mit einer
  Wegwerf-Sonde in beiden Projekten: im Projekt `chromium` fliegt genau diese
  Meldung, im Projekt `chromium-touch` läuft `page.touchscreen.tap` durch
  (`navigator.maxTouchPoints` 0 gegen > 0). Alle übrigen
  Szenarien brauchen ausdrücklich das Gegenteil (Maus-Semantik für die
  `.login-*`/`.access-gate*`-Klicks). Deshalb fährt `playwright.config.ts` ein
  zweites Projekt **`chromium-touch`**, das ausschließlich
  `m5-editor-touch.spec.ts` mit `hasTouch: true` fährt; das Projekt `chromium`
  nimmt diese Datei aus, damit sie nicht zweimal läuft. Das Szenario prüft als
  erstes seine eigene Voraussetzung (`navigator.maxTouchPoints > 0`) und dann
  **beide Hälften seiner Planzeile**: derselbe Zug per Finger bewegt das Element
  um **dieselbe Distanz** wie der Maus-Zug, und derselbe Zug am Anfasser
  (`[data-resize="se"]`, in `editor-helpers.ts`) macht es um **dasselbe Maß**
  größer, ohne es zu verschieben. Beide Male wird vom selben Ausgangswert
  gemessen (dazwischen je ein Undo) und beide Male über denselben synthetischen
  Touch-Zug, damit sich die Hälften nicht in zwei Nachbildungen unterscheiden.
  Bis Runde 2 behauptete E14 nur das Ziehen; ein Editor, der per Finger schieben,
  aber nicht größer ziehen lässt, wäre durchgekommen.
- **E3 (Vorschau = Live-Renderer)** verglich zwei verschieden große Ausschnitte
  byteweise; das konnte nie 0 ergeben und war auch nicht das Kriterium. Jetzt
  wird auf **beiden** Seiten derselbe Ausschnitt fotografiert (`.edomi-root`,
  einmal im Vorschau-iframe, einmal in der Live-Visu); der Editor-Chrome liegt
  außerhalb dieses Ausschnitts und wird gar nicht erst aufgenommen. Die
  Live-Visu bekommt exakt das Fenster der Vorschau (Breite, Höhe,
  `deviceScaleFactor`), die gleiche Abmessung wird getrennt behauptet, und dann
  zählt das Szenario die **abweichenden Pixel** (Dekodierung im Browser über
  `canvas`/`getImageData`, keine zusätzliche Abhängigkeit) und verlangt 0. Der
  zweite Browser-Kontext gehört dem Szenario und wird in einem `finally` wieder
  geschlossen; Playwright räumt nur den Kontext der `page`-Fixture ab, ein
  selbst geöffneter bliebe sonst bis zum Prozessende stehen.

## Die Beispielwelt (`seed.py`, M5-Teil)

Der Seed ist **idempotent**: jedes Objekt wird über seinen festen Namen gesucht
und nur dann angelegt; ein vorhandenes wird auf die Sollform zurückgezogen. Am
Ende liest der Seed alles zurück und bricht ab, wenn das Modell abweicht — ein
stiller Drift fliegt dort auf und nicht erst in einer roten Spec. Die erzeugten
IDs landen in `e2e/.seeded.json` (gitignoriert); `e2e/fixtures.ts` liest sie.

„Auf die Sollform zurückziehen" schließt **eine Welt ein, die dem Sollzustand
widerspricht**. `_validate_page_kind_config` lehnt eine `globalInclude`- oder
Popup-Seite mit `includes` ab und eine Popup-Konfiguration auf jedem anderen
Seitentyp. Trägt die Datenbank eine solche Lage bereits (über Restore, Migration
oder direkten DB-Zugriff, die §2.1 ausdrücklich als reale Wege nennt), dann
scheiterte der PATCH des Seitentyps daran und der Seed **starb** an genau dem
Zustand, den er heilen soll. `mk_node` nimmt einer solchen Seite jetzt zuerst die
kollidierenden Felder (`includes` leeren, `popup` fallen lassen), patcht dann den
Seitentyp und meldet die Heilung auf stdout (`seed: … geheilt`); die
Sollkonfiguration schreibt `put_page` unmittelbar danach ohnehin vollständig.
Belegt an der Instanz: eine `globalInclude`-Seite mit einem `includes`-Eintrag in
die DB gebracht, danach Seed → `rc=0`, Heilmeldung, 20 Knoten / 20 Datenpunkte.

| Knoten | `kind` | Zugriff | wofür |
|---|---|---|---|
| `M5 Global A` (order 10), `M5 Global B` (order 20) | `globalInclude` | public | R9, R10 (Stapelung nach `order`, §2.2), R11 |
| `M5 Include Gamma` | `normal` | public | individuelle Inkludeseite (R14), Vorlage für E10 |
| `M5 Home` (`includes: [Gamma]`) | `normal` | public | Wirtsseite R14; trägt die Link-Kacheln |
| `M5 Solo` (`ignore_global_includes`) | `normal` | public | R13 |
| `M5 Popup Positioned` (x/y/w/h, `shadow`) | `popup` | public | R2 gesetzt, R3, R6 |
| `M5 Popup Centered` (x gesetzt, **y fehlt**) | `popup` | public | R2 „fehlt eine Angabe → zentriert" |
| `M5 Popup Timed` (`auto_close_ms: 1500`) | `popup` | public | R4, R7 |
| `M5 Popup Modal` (`modal`, `animate`, `dim_backdrop`) | `popup` | public | R5, R6 |
| `M5 Popup Plain` (alle Flags aus) | `popup` | public | Gegenprobe R4-R6, zweites Popup für R8 |
| `M5 Guard User` (Zielgruppe: nur `e2e_resident`) | `normal` | `user` | R15: guest 401 „Anmeldung erforderlich", `e2e_operator` 403, `e2e_resident` 200 |
| `M5 Guard Readonly` | `normal` | `readonly` | R15: `X-Source-Page-Readonly: true` |
| `M5 Guard Pin` (PIN `1357`) | `normal` | `protected` | R15: 401 „PIN-Authentifizierung erforderlich" — auflösbar, keine Verdeckung |
| `M5 Guard Host` (`includes` alle drei) | `normal` | public | die Wirtsseite, die über die Grenze inkludiert |
| `M5 Ordner` | — | public | LOCATION → Signal „400 Knoten ist keine Seite" |

`M5 Home` trägt zusätzlich **Link-Kacheln** (`config.target_node_id`,
Contract 1.11/#1194) auf jedes Popup und auf `M5 Global A`. Ohne sie hätte die
Beispielwelt keinen Bedienweg zu R7/R8/R11, und die Szenarien wären auch nach
Teil B nicht ausführbar.

Alle Zugangsdaten und PINs sind **Wegwerf-Werte** einer ephemeren Instanz. Kein
Token steht je in einer URL, einer Query oder einer Ausgabe: `fixtures.ts` hält
sie im Speicher, `.seeded.json` enthält keine Admin-Zugangsdaten.

## Was der Harness am Backend gefunden hat

- **404-Text weicht vom Plan ab.** §2.1 notiert für „die Seite existiert nicht
  (mehr)" das `detail` „Knoten nicht gefunden". Auf der Leitung steht immer
  `{"detail": "Not found"}`: der globale `spa_404_handler` in `obs/main.py`
  ersetzt das `detail` **jedes** 404 unter `/api/`. `_get_node_or_404` schreibt
  die deutsche Meldung, der Handler überschreibt sie. **Teil B muss diese Lage am
  Status erkennen, nie am Text.** R15 hängt die Lage deshalb am Status auf und
  behauptet über den Text **nichts**: der heutige Wortlaut ist kein Vertrag,
  sondern das Nebenprodukt eines Handlers, der jedes 404 unter `/api/` gleich
  macht. Wer `spa_404_handler` später so repariert, dass die spezifische Meldung
  durchgereicht wird, macht die richtige Änderung und darf davon nicht rot
  werden. Die Abweichung ist dem Owner für §2.1 gemeldet.
- **Zwei Schranken, ein Statuscode.** `_check_page_read_access` prüft erst die
  Zielgruppe und danach die Datenpunkt-Policy; beide antworten mit 403 und
  demselben `detail`. Am API-Rand sind sie damit verhaltensgleich, und ein Test
  kann eine Änderung nicht sehen, die auf der Leitung nichts ändert. Der Seed
  trennt sie jetzt: der `e2e_operator` **darf** `dp-m5-guard-user` lesen, steht
  aber nicht in der Zielgruppe. Damit ist der Zielgruppen-Check die einzige noch
  scharfe Schranke des R15-Schritts: fällt er weg, wird aus dem 403 ein 200 und
  die Zeile rot. R15 behauptet die Vorbedingung ausdrücklich mit
  (`GET /datapoints/{dp}` als operator → 200), damit die Trennung nicht still
  wegkonfiguriert werden kann.
- **Ein gespeichertes Flag ohne laufende Behauptung fällt still.** Bis Runde 2
  war `ignore_global_includes` (R13) allein vom Read-Back des Seeds gedeckt, und
  der ist Aufbau, kein Szenario: ein Modell, das das Flag beim Lesen verwirft,
  kam an jedem laufenden Szenario vorbei. R13 trägt deshalb jetzt dieselbe
  Zweiteilung wie R2-R6: erst der Deskriptor am Backend (beide Seiten der
  Bedingung), dann das Bild. Belegt mit der Mutation „`ignore_global_includes`
  liefert immer `False`" (an der API belegt: `M5 Solo` meldet `False`): R13 wird
  rot, `Expected: true / Received: false`, nach 73 ms und noch vor dem Browser.
- **An Teil B kein Mangel gefunden.** Die sieben Szenarien, die auf die
  Host-Komposition warteten (R7, R8, R9, R10, R11, R13, R14), wurden zuerst
  **unverändert** gegen den gelieferten Host gefahren und waren auf Anhieb grün.
  Es wurde weder eine Erwartung abgeschwächt noch ein Selektor nachgezogen. Dass
  sie tragen und nicht bloss leer durchlaufen, ist an einer Mutationsprobe belegt:
  mit `kind` im `VisuNodeSummary` fest auf `normal` (an der API belegt, der Baum
  meldet nur noch `['normal']`) werden R1, R7, R8, R9, R10 und R13 rot. R11 und
  R14 bleiben zu Recht grün, denn sie hängen nicht an der Einstufung als globale
  Inkludeseite.
- **„Irgendwann zu" ist nicht „zur Frist zu".** R7 hat seine eigene Mutation
  („Wiederöffnen startet den Auto-Close-Timer neu") zunächst überlebt: die
  abschließende `expect(popup).toHaveCount(0)` ist eine retriende Erwartung und
  hat mit dem 7-Sekunden-Fenster aus `playwright.config.ts` jede Verlängerung bis
  rund 8,6 s verschluckt. R7 misst die Frist deshalb jetzt punktgenau
  (`waitFor` mit einem ab dem ERSTEN Öffnen gerechneten Deckel, danach beide
  Schranken um 1500 ms). Gemessen über zehn Läufe: 1548-1587 ms, Streuung 39 ms;
  unter der Mutation wandert die Frist auf 2400 ms und R7 wird rot
  (dreimal gefahren, dreimal rot, `waitFor … to be detached` läuft in den
  Deckel), während R8 grün bleibt.
- **Die authz-Welle-4-Spec musste enger werden, nicht lockerer.** Seit die
  Beispielwelt eine zweite PIN-geschützte Seite kennt (`M5 Guard Pin`), rendert
  der `AccessGate`-Streifen mehrere PIN-Formulare. `authz-roles.spec.ts` fasst
  seine PIN-Eingaben deshalb auf das Formular **seiner** Seite — was zugleich die
  schärfere Behauptung ist, die die Komponente verspricht (der Inline-Hinweis
  erscheint nur an diesem Eintrag).

## Was bewusst offen bleibt

- **R16 (Editor-Round-Trip) bleibt `fixme`.** Teil B liefert nur die eine Hälfte
  seiner Blockade; die andere ist der V2-Editor in `gui/` (C1 #168), und ohne ihn
  gibt es die Seite gar nicht, deren Round-Trip die Zeile behauptet.
- Die **Darstellungshälfte** von R2-R6 (zentriertes Popup, Schatten, `inert`) hat
  kein eigenes laufendes Szenario: sie hängt an der Darstellung des Skins und
  wird über R16 nachgewiesen. Die laufenden Szenarien prüfen den Deskriptor genau so, wie der
  Host ihn liest — inklusive der scharfen Kante „fehlende Koordinate bleibt
  `null`".
- **R17** und die Contract-/Skins-Gates gehören nicht in diesen Harness.
- Die `fixme`-Szenarien laufen erst, wenn ihr Teil geliefert hat. Sie sind
  deshalb im Bericht als eigene Zahl auszuweisen — ein Lauf ohne `fail` ist noch
  kein fertiges M5.
- **E14 und E3 sind weiterhin `fixme`**: sie sind jetzt abnehmbar (Touch-Projekt
  bzw. gleicher Ausschnitt mit Pixelzählung), aber ihre Behauptung über den
  Editor ist bis zur Lieferung von C4/C5 nicht gefahren. Was heute belegt ist:
  dass die Harness-Seite der beiden Zeilen trägt (Touch-Sonde in beiden
  Projekten gemessen), nicht dass der Editor sie erfüllt.
- **Das Login-Kontingent ist knapp bemessen.** 5 Anmeldungen pro Minute stehen 5
  benötigten gegenüber (Seed 1, vorgeholt 2, UI 2). Der Harness führt darüber
  Buch und wartet notfalls, aber wer parallel gegen dieselbe Instanz arbeitet,
  nimmt ihm das Kontingent weg. Für eine ephemere Instanz ist das richtig; wer
  dauerhaft mehr braucht, muss die Bremse im Backend anfassen, und das ist keine
  Entscheidung von Teil E.
