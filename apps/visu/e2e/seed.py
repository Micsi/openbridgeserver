#!/usr/bin/env python3
"""Seed a RUNNING obs server with the Visu × authz role fixtures (Welle 4 E2E).

This does NOT start the server or Mosquitto and does NOT tear anything down —
e2e/README.md brings the stack up first, then runs this against it. Seeding is
done purely over the REST API + the admin-gated authz grants endpoint (no direct
DB access), so it works against any reachable obs instance for which you hold the
owner/admin credentials.

All page names, datapoint (widget) names, usernames, passwords and the PIN below
are FIXED and must match the constants in authz-roles.spec.ts. The credentials
are throwaway TEST values for an ephemeral E2E instance — never reuse them.

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

        def mk_user(u: dict) -> None:
            resp = c.post("/api/v1/auth/users", headers=admin,
                          json={"username": u["username"], "password": u["password"],
                                "is_admin": False, "mqtt_enabled": False})
            if resp.status_code not in (201, 409):
                die(f"create user {u['username']}: {resp.status_code} {resp.text}")

        def mk_dp(name: str, control_class: str = "room_local") -> str:
            resp = c.post("/api/v1/datapoints/", headers=admin,
                          json={"name": name, "data_type": "FLOAT", "unit": "C",
                                "tags": [], "control_class": control_class})
            if resp.status_code != 201:
                die(f"create dp {name}: {resp.status_code} {resp.text}")
            return resp.json()["id"]

        def mk_page(name: str, access: str, pin: str | None = None) -> str:
            payload: dict = {"name": name, "type": "PAGE", "order": 999, "access": access}
            if pin is not None:
                payload["access_pin"] = pin
            resp = c.post("/api/v1/visu/nodes", headers=admin, json=payload)
            if resp.status_code != 201:
                die(f"create page {name}: {resp.status_code} {resp.text}")
            return resp.json()["id"]

        def put_widgets(page_id: str, dps: list[tuple[str, str]]) -> None:
            widgets = [{"id": str(uuid.uuid4()), "name": wname, "type": "ValueDisplay",
                        "datapoint_id": dp, "status_datapoint_id": None,
                        "x": 0, "y": i * 2, "w": 3, "h": 2, "config": {}}
                       for i, (wname, dp) in enumerate(dps)]
            resp = c.put(f"/api/v1/visu/pages/{page_id}", headers=admin,
                         json={"grid_cols": 12, "grid_row_height": 80, "grid_cell_width": 80,
                               "background": None, "widgets": widgets})
            if resp.status_code not in (200, 204):
                die(f"save page {page_id}: {resp.status_code} {resp.text}")

        def seed_value(dp: str, val: float) -> None:
            resp = c.post(f"/api/v1/datapoints/{dp}/value", headers=admin, json={"value": val})
            if resp.status_code != 204:
                die(f"seed value {dp}: {resp.status_code} {resp.text}")

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
            resp = c.put(f"/api/v1/visu/nodes/{page_id}/users", headers=admin,
                         json={"usernames": usernames})
            if resp.status_code != 204:
                die(f"assign audience {page_id}: {resp.status_code} {resp.text}")

        # 1) principals
        mk_user(RESIDENT)
        mk_user(OPERATOR)

        # 2) datapoints
        dp = {
            "public": mk_dp("dp-e2e-public"),
            "readonly": mk_dp("dp-e2e-readonly"),
            "protected": mk_dp("dp-e2e-protected"),
            "private": mk_dp("dp-e2e-private"),
            "room": mk_dp("dp-e2e-room", "room_local"),
            "central": mk_dp("dp-e2e-central", "central_plant"),
        }

        # 3) pages + widgets
        page = {
            "public": mk_page(PAGES["public"]["name"], "public"),
            "readonly": mk_page(PAGES["readonly"]["name"], "readonly"),
            "protected": mk_page(PAGES["protected"]["name"], "protected", pin=PIN),
            "private": mk_page(PAGES["private"]["name"], "user"),
            "room": mk_page(PAGES["room"]["name"], "public"),
        }
        put_widgets(page["public"], [(PAGES["public"]["widget"], dp["public"])])
        put_widgets(page["readonly"], [(PAGES["readonly"]["widget"], dp["readonly"])])
        put_widgets(page["protected"], [(PAGES["protected"]["widget"], dp["protected"])])
        put_widgets(page["private"], [(PAGES["private"]["widget"], dp["private"])])
        put_widgets(page["room"], [(PAGES["room"]["widget"], dp["room"]), (CENTRAL_WIDGET, dp["central"])])

        for key in ("public", "readonly", "protected", "private", "room", "central"):
            seed_value(dp[key], 21.5)

        # 4) grants (read on the private DP is a precondition for audience assignment)
        replace_grants(RESIDENT["username"], [
            {"node_type": "datapoint", "node_id": dp["private"], "role": "resident"},
            {"node_type": "datapoint", "node_id": dp["room"], "role": "resident"},
        ])
        replace_grants(OPERATOR["username"], [
            {"node_type": "datapoint", "node_id": dp["private"], "role": "operator"},
            {"node_type": "datapoint", "node_id": dp["room"], "role": "operator"},
            {"node_type": "datapoint", "node_id": dp["central"], "role": "operator", "central_control": True},
        ])

        # 5) private page audience → both non-admin roles (guest stays excluded)
        assign_audience(page["private"], [RESIDENT["username"], OPERATOR["username"]])

    fixture = {
        "base": BASE, "pin": PIN,
        "resident": RESIDENT, "operator": OPERATOR,
        "pages": {k: v["name"] for k, v in PAGES.items()},
        "widgets": {k: v["widget"] for k, v in PAGES.items()} | {"central": CENTRAL_WIDGET},
        "node_ids": page, "datapoint_ids": dp,
    }
    out = Path(__file__).with_name(".seeded.json")
    out.write_text(json.dumps(fixture, indent=2))
    print(f"seeded OK -> {out}")
    print(json.dumps({k: fixture[k] for k in ("pages", "widgets", "resident", "operator", "pin")}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
