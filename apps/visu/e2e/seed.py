#!/usr/bin/env python3
"""Seed a RUNNING obs server with the Visu E2E fixtures (authz Welle 4 + M5 Seitentypen).

This does NOT start the server or Mosquitto and does NOT tear anything down —
e2e/README.md brings the stack up first, then runs this against it. Seeding is
done purely over the REST API + the admin-gated authz grants endpoint (no direct
DB access), so it works against any reachable obs instance for which you hold the
owner/admin credentials.

Two worlds are seeded into the same instance:

  1. **authz roles** (Welle 4) — the fixtures `authz-roles.spec.ts` asserts on.
  2. **M5 Seitentypen** (CONTRIBUTING-visu-m5.md §1) — every page kind (normal,
     two global includes with different `order`, an individual include, five
     popups covering the R2-R6 parameter space, a page with
     `ignore_global_includes`) plus the access boundaries R15 needs (a `user`
     page, a `readonly` page, a `protected`/PIN page, a LOCATION folder) and a
     host page that includes all of them.

**Idempotent.** Every object is looked up by its fixed name first and only then
created; an existing object is patched back onto the expected shape. Running this
twice against the same instance leaves the same world — the second run is a
read-back check, not a duplicate.

All page names, datapoint (widget) names, usernames, passwords and the PINs below
are FIXED and must match the constants in the specs. The credentials are
throwaway TEST values for an ephemeral E2E instance — never reuse them.

Env:
  OBS_BASE            default http://127.0.0.1:8080   (the obs REST base host)
  OBS_ADMIN_USER      default admin
  OBS_ADMIN_PASSWORD  required (the seeded owner password)

Run:
  OBS_ADMIN_PASSWORD=... .venv/bin/python apps/visu/e2e/seed.py
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import httpx

BASE = os.environ.get("OBS_BASE", "http://127.0.0.1:8080").rstrip("/")
ADMIN_USER = os.environ.get("OBS_ADMIN_USER", "admin")
ADMIN_PW = os.environ.get("OBS_ADMIN_PASSWORD")

# ---- FIXED fixture identity (must match authz-roles.spec.ts) ----------------
PIN = "2468"
RESIDENT = {"username": "e2e_resident", "password": "e2e-resident-pw"}  # test-only
OPERATOR = {"username": "e2e_operator", "password": "e2e-operator-pw"}  # test-only

PAGES = {
    "public": {"name": "E2E Public", "access": "public", "widget": "Public Lamp"},
    "readonly": {"name": "E2E Readonly", "access": "readonly", "widget": "Readonly Sensor"},
    "protected": {"name": "E2E Protected", "access": "protected", "widget": "Protected Switch", "pin": PIN},
    "private": {"name": "E2E Private", "access": "user", "widget": "Private Blind"},
    "room": {"name": "E2E Room", "access": "public", "widget": "Room Dimmer"},
}
CENTRAL_WIDGET = "Central Pump"  # a central_plant DP that lives on the room page

# ---- FIXED M5 fixture identity (must match m5-*.spec.ts) -------------------
# Ein zweiter PIN, getrennt vom authz-PIN, damit eine Spec die M5-Include-Quelle
# nicht versehentlich mit dem authz-PIN aufschließt (und umgekehrt).
M5_PIN = "1357"

# Die M5-Welt. `order` ist tragend für R10 (globale Includes stapeln nach
# Knoten-`order`, CONTRIBUTING-visu-m5.md §2.2), deshalb tragen die beiden
# globalen Inkludeseiten bewusst verschiedene, nicht benachbarte Werte.
M5_PAGES: dict[str, dict[str, Any]] = {
    # -- globale Inkludeseiten (R9, R10, R11) --------------------------------
    "global_a": {"name": "M5 Global A", "kind": "globalInclude", "access": "public", "order": 10, "widget": "M5 Global Alpha"},
    "global_b": {"name": "M5 Global B", "kind": "globalInclude", "access": "public", "order": 20, "widget": "M5 Global Beta"},
    # -- individuelle Inkludeseite (R14): eine gewöhnliche Seite, die woanders
    #    in `includes` referenziert wird — sie braucht keinen eigenen Seitentyp.
    "include_ind": {"name": "M5 Include Gamma", "kind": "normal", "access": "public", "order": 30, "widget": "M5 Gamma Item"},
    # -- normale Seiten (R1, R13, R14) ---------------------------------------
    "home": {"name": "M5 Home", "kind": "normal", "access": "public", "order": 40, "widget": "M5 Home Delta"},
    "solo": {"name": "M5 Solo", "kind": "normal", "access": "public", "order": 50, "widget": "M5 Solo Epsilon"},
    # -- Popups (R2-R8): jeder Parameter der PopupConfig einmal gesetzt -------
    # Position vollständig gesetzt + Schlagschatten (R2 gesetzt, R3, R6).
    "popup_positioned": {"name": "M5 Popup Positioned", "kind": "popup", "access": "public", "order": 60, "widget": "M5 Popup Pos Item"},
    # x gesetzt, y FEHLT → der Host zentriert (R2, zweite Seite der Regel).
    "popup_centered": {"name": "M5 Popup Centered", "kind": "popup", "access": "public", "order": 61, "widget": "M5 Popup Ctr Item"},
    # auto_close_ms (R4, R7).
    "popup_timed": {"name": "M5 Popup Timed", "kind": "popup", "access": "public", "order": 62, "widget": "M5 Popup Timed Item"},
    # modal + animate + dim_backdrop (R5, R6).
    "popup_modal": {"name": "M5 Popup Modal", "kind": "popup", "access": "public", "order": 63, "widget": "M5 Popup Modal Item"},
    # Alle Flags aus, damit R5/R6 beide Seiten der Bedingung sehen; zugleich das
    # zweite, VERSCHIEDENE Popup für R8.
    "popup_plain": {"name": "M5 Popup Plain", "kind": "popup", "access": "public", "order": 64, "widget": "M5 Popup Plain Item"},
    # -- Zugriffsgrenzen für R15 ---------------------------------------------
    # user-Seite: Zielgruppe ist NUR der resident → guest 401 „Anmeldung
    # erforderlich", operator (angemeldet, nicht in der Zielgruppe) 403.
    "guard_user": {"name": "M5 Guard User", "kind": "normal", "access": "user", "order": 70, "widget": "M5 Guard Zeta"},
    # readonly-Seite: lesbar, aber X-Source-Page-Readonly: true → Widgets gesperrt.
    "guard_readonly": {"name": "M5 Guard Readonly", "kind": "normal", "access": "readonly", "order": 71, "widget": "M5 Guard Eta"},
    # protected-Seite: 401 „PIN-Authentifizierung erforderlich" = auflösbare
    # Aufforderung, KEINE Verdeckung (§2.1 Signalliste).
    "guard_pin": {"name": "M5 Guard Pin", "kind": "normal", "access": "protected", "order": 72, "widget": "M5 Guard Theta", "pin": M5_PIN},
    # Die Wirtsseite, die alle drei Grenzen auf einmal inkludiert.
    "guard_host": {"name": "M5 Guard Host", "kind": "normal", "access": "public", "order": 73, "widget": "M5 Guard Host Item"},
}

# Ein Ordner (LOCATION) — Signal „400 Knoten ist keine Seite" (§2.1).
M5_LOCATION_NAME = "M5 Ordner"

# Wer inkludiert wen (R13/R14/R15). Zielseiten müssen vorher existieren.
M5_INCLUDES: dict[str, list[str]] = {
    "home": ["include_ind"],
    "guard_host": ["guard_user", "guard_readonly", "guard_pin"],
}
# R13: diese Seite blendet die globalen Inkludeseiten aus.
M5_IGNORE_GLOBAL = {"solo"}

# Link-Kacheln (`config.target_node_id`, Contract 1.11/#1194) — die Affordanz,
# über die ein Popup geöffnet bzw. eine globale Inkludeseite direkt aufgerufen
# wird. Ohne sie hätte die Beispielwelt keinen Bedienweg zu R7/R8/R11, und die
# Szenarien wären auch nach Teil B nicht ausführbar. Wirtsseite → [(Kachelname,
# Zielseite)].
M5_LINKS: dict[str, list[tuple[str, str]]] = {
    "home": [
        ("M5 Open Positioned", "popup_positioned"),
        ("M5 Open Centered", "popup_centered"),
        ("M5 Open Timed", "popup_timed"),
        ("M5 Open Modal", "popup_modal"),
        ("M5 Open Plain", "popup_plain"),
        # R11: der Direktaufruf einer globalen Inkludeseite.
        ("M5 Open Global A", "global_a"),
    ],
}

# R2-R6: die exakten Deskriptoren, die Teil B an den Skin durchreicht.
M5_POPUPS: dict[str, dict[str, Any]] = {
    "popup_positioned": {"x": 120, "y": 80, "w": 300, "h": 200, "shadow": True},
    # y fehlt bewusst → PopupConfig.y bleibt None (R2).
    "popup_centered": {"x": 120, "w": 280, "h": 160},
    "popup_timed": {"x": 40, "y": 40, "w": 240, "h": 140, "auto_close_ms": 1500},
    "popup_modal": {"x": 60, "y": 60, "w": 320, "h": 220, "modal": True, "animate": True, "dim_backdrop": True},
    "popup_plain": {"x": 200, "y": 240, "w": 200, "h": 120},
}


def die(msg: str) -> None:
    print(f"SEED ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    if not ADMIN_PW:
        die("OBS_ADMIN_PASSWORD is required")

    with httpx.Client(base_url=BASE, timeout=15.0) as c:
        r = c.post("/api/v1/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PW})
        if r.status_code != 200:
            die(f"admin login failed: {r.status_code} {r.text}")
        admin = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # ---- idempotente Nachschlage-Helfer ---------------------------------

        def existing_nodes() -> dict[str, dict]:
            resp = c.get("/api/v1/visu/tree", headers=admin)
            if resp.status_code != 200:
                die(f"read tree: {resp.status_code} {resp.text}")
            return {node["name"]: node for node in resp.json()}

        def existing_datapoints() -> dict[str, str]:
            resp = c.get("/api/v1/datapoints/", headers=admin, params={"size": 10000})
            if resp.status_code != 200:
                die(f"list datapoints: {resp.status_code} {resp.text}")
            return {dp["name"]: dp["id"] for dp in resp.json()["items"]}

        nodes_by_name = existing_nodes()
        dps_by_name = existing_datapoints()

        def mk_user(u: dict) -> None:
            resp = c.post(
                "/api/v1/auth/users",
                headers=admin,
                json={"username": u["username"], "password": u["password"], "is_admin": False, "mqtt_enabled": False},
            )
            if resp.status_code not in (201, 409):
                die(f"create user {u['username']}: {resp.status_code} {resp.text}")

        def mk_dp(name: str, control_class: str = "room_local") -> str:
            if name in dps_by_name:
                return dps_by_name[name]
            resp = c.post(
                "/api/v1/datapoints/",
                headers=admin,
                json={"name": name, "data_type": "FLOAT", "unit": "C", "tags": [], "control_class": control_class},
            )
            if resp.status_code != 201:
                die(f"create dp {name}: {resp.status_code} {resp.text}")
            dp_id = resp.json()["id"]
            dps_by_name[name] = dp_id
            return dp_id

        def mk_node(
            name: str,
            *,
            node_type: str = "PAGE",
            access: str | None = None,
            kind: str = "normal",
            order: int = 999,
            pin: str | None = None,
        ) -> str:
            """Legt einen Knoten an oder zieht einen vorhandenen auf die Sollform (idempotent)."""
            found = nodes_by_name.get(name)
            if found is not None:
                patch: dict[str, Any] = {"kind": kind, "order": order, "access": access}
                if pin is not None:
                    patch["access_pin"] = pin
                resp = c.patch(f"/api/v1/visu/nodes/{found['id']}", headers=admin, json=patch)
                if resp.status_code != 200:
                    die(f"patch node {name}: {resp.status_code} {resp.text}")
                return found["id"]
            payload: dict[str, Any] = {"name": name, "type": node_type, "kind": kind, "order": order, "access": access}
            if pin is not None:
                payload["access_pin"] = pin
            resp = c.post("/api/v1/visu/nodes", headers=admin, json=payload)
            if resp.status_code != 201:
                die(f"create node {name}: {resp.status_code} {resp.text}")
            created = resp.json()
            nodes_by_name[name] = created
            return created["id"]

        def mk_page(name: str, access: str, pin: str | None = None) -> str:
            return mk_node(name, access=access, order=999, pin=pin)

        def put_page(
            page_id: str,
            dps: list[tuple[str, str]],
            *,
            links: list[tuple[str, str, str]] | None = None,
            includes: list[str] | None = None,
            ignore_global_includes: bool = False,
            popup: dict[str, Any] | None = None,
        ) -> None:
            # "Toggle" so the Visu's obs mapper (obsKind) actually renders the
            # widget as a switch tile — ValueDisplay/Chart/... are deliberately
            # skipped by the mapper (issue #124). Its read+write datapoint is
            # `datapoint_id`, which the mapper reads.
            widgets = [
                {
                    "id": str(uuid.uuid4()),
                    "name": wname,
                    "type": "Toggle",
                    "datapoint_id": dp_id,
                    "status_datapoint_id": None,
                    "x": 0,
                    "y": i * 2,
                    "w": 3,
                    "h": 2,
                    "config": {},
                }
                for i, (wname, dp_id) in enumerate(dps)
            ]
            # Link-Kacheln tragen dasselbe Kachel-Schema und zusätzlich
            # `target_node_id` (die Konfig-Schlüssel des V1-Link-Widgets).
            widgets += [
                {
                    "id": str(uuid.uuid4()),
                    "name": wname,
                    "type": "Toggle",
                    "datapoint_id": dp_id,
                    "status_datapoint_id": None,
                    "x": 4,
                    "y": i * 2,
                    "w": 3,
                    "h": 2,
                    "config": {"target_node_id": target_id, "active_indicator": "dot"},
                }
                for i, (wname, dp_id, target_id) in enumerate(links or [])
            ]
            body: dict[str, Any] = {
                "grid_cols": 12,
                "grid_row_height": 80,
                "grid_cell_width": 80,
                "background": None,
                "widgets": widgets,
                "includes": includes or [],
                "ignore_global_includes": ignore_global_includes,
                "popup": popup,
            }
            resp = c.put(f"/api/v1/visu/pages/{page_id}", headers=admin, json=body)
            if resp.status_code not in (200, 204):
                die(f"save page {page_id}: {resp.status_code} {resp.text}")

        def seed_value(dp_id: str, val: float) -> None:
            resp = c.post(f"/api/v1/datapoints/{dp_id}/value", headers=admin, json={"value": val})
            if resp.status_code != 204:
                die(f"seed value {dp_id}: {resp.status_code} {resp.text}")

        def replace_grants(username: str, grants: list[dict]) -> None:
            # Admin-gated optimistic replace: GET current ETag, then PUT with If-Match.
            path = f"/api/v1/authz/principals/user/{username}/grants"
            g = c.get(path, headers=admin)
            if g.status_code != 200:
                die(f"get grants {username}: {g.status_code} {g.text}")
            etag = g.headers.get("ETag")
            if not etag:
                die(f"no ETag on grants for {username}")
            p = c.put(path, headers={**admin, "If-Match": etag}, json={"grants": grants})
            if p.status_code != 200:
                die(f"put grants {username}: {p.status_code} {p.text}")

        def assign_audience(page_id: str, usernames: list[str]) -> None:
            resp = c.put(f"/api/v1/visu/nodes/{page_id}/users", headers=admin, json={"usernames": usernames})
            if resp.status_code != 204:
                die(f"assign audience {page_id}: {resp.status_code} {resp.text}")

        # 1) principals
        mk_user(RESIDENT)
        mk_user(OPERATOR)

        # 2) datapoints (authz-Welt + M5-Welt)
        dp = {
            "public": mk_dp("dp-e2e-public"),
            "readonly": mk_dp("dp-e2e-readonly"),
            "protected": mk_dp("dp-e2e-protected"),
            "private": mk_dp("dp-e2e-private"),
            "room": mk_dp("dp-e2e-room", "room_local"),
            "central": mk_dp("dp-e2e-central", "central_plant"),
        }
        m5_dp = {key: mk_dp(f"dp-m5-{key.replace('_', '-')}") for key in M5_PAGES}

        # 3) grants — EIN Replace je Principal (der Endpunkt ersetzt die ganze
        #    Liste), deshalb tragen beide Welten gemeinsam ein. Lesen auf dem DP
        #    der user-Seite ist Vorbedingung für die Zielgruppen-Zuweisung.
        replace_grants(
            RESIDENT["username"],
            [
                {"node_type": "datapoint", "node_id": dp["private"], "role": "resident"},
                {"node_type": "datapoint", "node_id": dp["room"], "role": "resident"},
                {"node_type": "datapoint", "node_id": m5_dp["guard_user"], "role": "resident"},
            ],
        )
        replace_grants(
            OPERATOR["username"],
            [
                {"node_type": "datapoint", "node_id": dp["private"], "role": "operator"},
                {"node_type": "datapoint", "node_id": dp["room"], "role": "operator"},
                {"node_type": "datapoint", "node_id": dp["central"], "role": "operator", "central_control": True},
            ],
        )

        # 4) authz-Welt: Seiten + Widgets
        page = {
            "public": mk_page(PAGES["public"]["name"], "public"),
            "readonly": mk_page(PAGES["readonly"]["name"], "readonly"),
            "protected": mk_page(PAGES["protected"]["name"], "protected", pin=PIN),
            "private": mk_page(PAGES["private"]["name"], "user"),
            "room": mk_page(PAGES["room"]["name"], "public"),
        }
        put_page(page["public"], [(PAGES["public"]["widget"], dp["public"])])
        put_page(page["readonly"], [(PAGES["readonly"]["widget"], dp["readonly"])])
        put_page(page["protected"], [(PAGES["protected"]["widget"], dp["protected"])])
        put_page(page["private"], [(PAGES["private"]["widget"], dp["private"])])
        put_page(page["room"], [(PAGES["room"]["widget"], dp["room"]), (CENTRAL_WIDGET, dp["central"])])

        for key in ("public", "readonly", "protected", "private", "room", "central"):
            seed_value(dp[key], 21.5)

        # 5) private page audience → both non-admin roles (guest stays excluded)
        assign_audience(page["private"], [RESIDENT["username"], OPERATOR["username"]])

        # 6) M5-Welt: erst alle Knoten (Include-Ziele müssen existieren, bevor
        #    eine `includes`-Liste sie streng geprüft referenzieren darf).
        m5_node = {
            key: mk_node(
                spec["name"],
                access=spec["access"],
                kind=spec["kind"],
                order=spec["order"],
                pin=spec.get("pin"),
            )
            for key, spec in M5_PAGES.items()
        }
        m5_location = mk_node(M5_LOCATION_NAME, node_type="LOCATION", access="public", order=80)

        # 7) Zielgruppe der user-Seite: NUR der resident. Der operator ist
        #    angemeldet und trotzdem draußen — genau der 403-Fall aus §2.1.
        assign_audience(m5_node["guard_user"], [RESIDENT["username"]])

        # 8) M5-Seitenkonfigurationen (Widgets, includes, ignore, popup)
        for key, spec in M5_PAGES.items():
            put_page(
                m5_node[key],
                [(spec["widget"], m5_dp[key])],
                links=[(wname, m5_dp[target], m5_node[target]) for wname, target in M5_LINKS.get(key, [])],
                includes=[m5_node[target] for target in M5_INCLUDES.get(key, [])],
                ignore_global_includes=key in M5_IGNORE_GLOBAL,
                popup=M5_POPUPS.get(key),
            )
            seed_value(m5_dp[key], 21.5)

        # 9) Read-back: der Seed prüft seine eigenen Zusagen, damit ein stiller
        #    Modell-Drift hier auffliegt und nicht erst in einer roten Spec.
        for key, spec in M5_PAGES.items():
            node = c.get(f"/api/v1/visu/nodes/{m5_node[key]}", headers=admin)
            if node.status_code != 200:
                die(f"verify node {spec['name']}: {node.status_code} {node.text}")
            if node.json()["kind"] != spec["kind"]:
                die(f"verify node {spec['name']}: kind {node.json()['kind']!r} != {spec['kind']!r}")
            cfg = c.get(f"/api/v1/visu/pages/{m5_node[key]}", headers=admin)
            if cfg.status_code != 200:
                die(f"verify page {spec['name']}: {cfg.status_code} {cfg.text}")
            body = cfg.json()
            want_includes = [m5_node[target] for target in M5_INCLUDES.get(key, [])]
            if body["includes"] != want_includes:
                die(f"verify page {spec['name']}: includes {body['includes']} != {want_includes}")
            if body["ignore_global_includes"] != (key in M5_IGNORE_GLOBAL):
                die(f"verify page {spec['name']}: ignore_global_includes drifted")
            want_popup = M5_POPUPS.get(key)
            got_popup = body["popup"]
            if want_popup is None:
                if got_popup is not None:
                    die(f"verify page {spec['name']}: unexpected popup config")
            else:
                if got_popup is None:
                    die(f"verify page {spec['name']}: popup config missing")
                for field, value in want_popup.items():
                    if got_popup[field] != value:
                        die(f"verify page {spec['name']}: popup.{field} {got_popup[field]!r} != {value!r}")

    fixture = {
        "base": BASE,
        "pin": PIN,
        "resident": RESIDENT,
        "operator": OPERATOR,
        "pages": {k: v["name"] for k, v in PAGES.items()},
        "widgets": {k: v["widget"] for k, v in PAGES.items()} | {"central": CENTRAL_WIDGET},
        "node_ids": page,
        "datapoint_ids": dp,
        "m5": {
            "pin": M5_PIN,
            "names": {k: v["name"] for k, v in M5_PAGES.items()} | {"location": M5_LOCATION_NAME},
            "kinds": {k: v["kind"] for k, v in M5_PAGES.items()},
            "orders": {k: v["order"] for k, v in M5_PAGES.items()},
            "widgets": {k: v["widget"] for k, v in M5_PAGES.items()},
            "node_ids": m5_node | {"location": m5_location},
            "datapoint_ids": m5_dp,
            "includes": M5_INCLUDES,
            "ignore_global_includes": sorted(M5_IGNORE_GLOBAL),
            "popups": M5_POPUPS,
            "links": {host: [{"widget": w, "target": t} for w, t in entries] for host, entries in M5_LINKS.items()},
        },
    }
    out = Path(__file__).with_name(".seeded.json")
    out.write_text(json.dumps(fixture, indent=2))
    print(f"seeded OK -> {out}")
    print(json.dumps({k: fixture[k] for k in ("pages", "widgets", "resident", "operator", "pin")}, indent=2))
    print(json.dumps({"m5_pages": fixture["m5"]["names"], "m5_kinds": fixture["m5"]["kinds"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
