# Visu × authz role E2E (Welle 4)

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
export TMPDIR=/Volumes/Daten/tmp
export OBS_CONFIG=$TMPDIR/e2e_nonexistent.yaml          # isolate from any host config.yaml
export OBS_DATABASE__PATH=$TMPDIR/e2e_obs.db
export OBS_DATABASE__HISTORY_PLUGIN=sqlite
export OBS_MQTT__HOST=localhost
export OBS_MQTT__PORT=1884
export OBS_SECURITY__JWT_SECRET=e2e-integration-secret-32-chars-xx
export OBS_SECURITY__JWT_EXPIRE_MINUTES=60
export OBS_MOSQUITTO__PASSWD_FILE=$TMPDIR/e2e_obs_passwd

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

## Step 3 — Seed the authz role fixtures

Seeds users (`e2e_resident`, `e2e_operator`), the datapoints, the
`public`/`readonly`/`protected`/`user` pages + a room page, the widgets, the
grants (via the admin-gated authz grants API) and the `user`-page audience. Fixed
names match `authz-roles.spec.ts`. Writes `e2e/.seeded.json` for reference.

```bash
OBS_BASE=http://127.0.0.1:8080 OBS_ADMIN_USER=admin OBS_ADMIN_PASSWORD=e2e-admin-pw \
  .venv/bin/python apps/visu/e2e/seed.py
```

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
rm -f "$TMPDIR"/e2e_obs.db* "$TMPDIR/e2e_mosq.conf" "$TMPDIR/e2e_obs_passwd" apps/visu/e2e/.seeded.json
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

## Bekannter Blocker (2026-08-31): OBS-Modus-Overview crasht gegen echtes Backend

Der API-Smoke (16/16) und der Stack-Aufbau/Seed sind verifiziert. Der Browser-Lauf blockiert
aktuell aber, weil die Visu im OBS-Modus nicht mountet: das Overview-Layout ist statisch im
Demo-Modell (`apps/visu/src/core/model.ts`) hartcodiert (`kueche-wand` etc.) und passt nicht zu
echten Backend-Geraete-Ids -> `resolveLayout: ... references no device`. Voraussetzung fuer einen
gruenen UI-E2E ist der Follow-up "dynamisches Overview-Layout aus dem Backend-Tree" (siehe
CONTRIBUTING-visu-authz.md §8). Die Playwright-Config nutzt bewusst einen Mobile-Viewport, damit
das `ion-menu`-Drawer (LoginPanel/AccessGate) rendert.
