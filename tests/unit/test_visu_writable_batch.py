"""Unit tests for the page-scoped writable batch check and the shared
`_authorize_datapoint_write` helper.

Two concerns are covered here:

1. `_authorize_datapoint_write` — every authorization arc of the write-path
   decision that is now shared between `POST /api/v1/datapoints/{id}/value`
   and the visu writable batch check. Driven by direct calls with
   monkeypatched collaborators so each branch is deterministic (no Docker).

2. `GET`/`POST /api/v1/visu/nodes/{node_id}/writable` — the batch endpoint
   wiring (page read gate, response shape) plus parity: the endpoint's
   ``writable`` verdict matches what the real write path (`write_value`)
   allows/denies for the same datapoint.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from obs.api.auth import Principal
from obs.api.v1 import datapoints as dp_api
from obs.api.v1 import visu as visu_api
from obs.db.database import Database

pytestmark = pytest.mark.asyncio

NOW = "2026-06-10T00:00:00+00:00"

ADMIN = Principal(subject="admin", type="user", is_admin=True)
ALICE = Principal(subject="alice", type="user", is_admin=False)


@pytest.fixture
async def db() -> Database:
    database = Database(":memory:")
    await database.connect()
    try:
        yield database
    finally:
        await database.disconnect()


def _dp(dp_id: str, *, control_class: str = "room_local"):
    return SimpleNamespace(id=uuid.UUID(dp_id), data_type="FLOAT", control_class=control_class)


# ---------------------------------------------------------------------------
# _authorize_datapoint_write — branch-complete direct-call coverage
# ---------------------------------------------------------------------------


async def _authorize(monkeypatch, dp, user, *, page_id, session_token=None, **overrides):
    """Call the helper with all db-touching collaborators stubbed.

    overrides may set: deny (bool), allowed (list), page_has (bool),
    access (tuple), user_access (bool), validate (bool).
    """
    monkeypatch.setattr(dp_api, "load_role_grants", AsyncMock(return_value=[]))
    monkeypatch.setattr(dp_api, "_has_explicit_datapoint_deny", AsyncMock(return_value=overrides.get("deny", False)))
    monkeypatch.setattr(dp_api, "filter_authorized_datapoints", AsyncMock(return_value=overrides.get("allowed", [])))
    monkeypatch.setattr(dp_api, "_page_has_datapoint", AsyncMock(return_value=overrides.get("page_has", True)))
    monkeypatch.setattr(dp_api, "validate_session", lambda token, node_id: overrides.get("validate", True))
    monkeypatch.setattr(
        "obs.api.v1.visu._resolve_access_with_node",
        AsyncMock(return_value=overrides.get("access", ("public", None))),
    )
    monkeypatch.setattr(
        "obs.api.v1.visu._check_user_access",
        AsyncMock(return_value=overrides.get("user_access", True)),
    )
    await dp_api._authorize_datapoint_write(
        MagicMock(),
        dp,
        dp.id,
        user,
        page_id=page_id,
        session_token=session_token,
    )


async def test_admin_is_always_allowed(monkeypatch):
    # 1T (user), 2T (admin), 5F (skip page path)
    await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000a1"), ADMIN, page_id="p")


async def test_explicit_deny_blocks_authenticated(monkeypatch):
    # 2F, 3T
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000a2"), ALICE, page_id="p", deny=True)
    assert exc.value.status_code == 403


async def test_central_plant_without_grant_blocks_authenticated(monkeypatch):
    # 3F, 4T
    with pytest.raises(HTTPException) as exc:
        await _authorize(
            monkeypatch,
            _dp("00000000-0000-0000-0000-0000000000a3", control_class="central_plant"),
            ALICE,
            page_id="p",
            allowed=[],
        )
    assert exc.value.status_code == 403


async def test_write_grant_allows_authenticated(monkeypatch):
    # 4F, 5F
    dp = _dp("00000000-0000-0000-0000-0000000000a4")
    await _authorize(monkeypatch, dp, ALICE, page_id="p", allowed=[str(dp.id)])


async def test_unauthenticated_without_page_context_401(monkeypatch):
    # 1F, 5T, 6T, inner 7F
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000a5"), None, page_id=None)
    assert exc.value.status_code == 401


async def test_authenticated_unauthorized_without_page_context_403(monkeypatch):
    # 7T
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000a6"), ALICE, page_id=None, allowed=[])
    assert exc.value.status_code == 403


async def test_datapoint_not_on_page_403(monkeypatch):
    # 6F, 8T
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000a7"), None, page_id="p", page_has=False)
    assert exc.value.status_code == 403


async def test_readonly_page_blocks(monkeypatch):
    # 8F, 9T
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000a8"), None, page_id="p", access=("readonly", None))
    assert exc.value.status_code == 403


async def test_protected_page_with_valid_token_allowed(monkeypatch):
    # 9F, 10T, inner-or False (valid token), 13F
    await _authorize(
        monkeypatch,
        _dp("00000000-0000-0000-0000-0000000000a9"),
        None,
        page_id="p",
        session_token="tok",
        access=("protected", "node"),
        validate=True,
    )


@pytest.mark.parametrize(
    ("session_token", "validate"),
    [(None, True), ("tok", False)],
    ids=["missing-token", "invalid-token"],
)
async def test_protected_page_without_valid_token_blocks(monkeypatch, session_token, validate):
    # inner-or first operand (missing token) and second operand (invalid token)
    with pytest.raises(HTTPException) as exc:
        await _authorize(
            monkeypatch,
            _dp("00000000-0000-0000-0000-0000000000aa"),
            None,
            page_id="p",
            session_token=session_token,
            access=("protected", "node"),
            validate=validate,
        )
    assert exc.value.status_code == 403


async def test_user_page_assigned_allowed(monkeypatch):
    # 10F, 11T, inner-or all False (assigned), 13F
    await _authorize(
        monkeypatch,
        _dp("00000000-0000-0000-0000-0000000000ab"),
        ALICE,
        page_id="p",
        access=("user", "node"),
        user_access=True,
    )


async def test_user_page_unauthenticated_blocks(monkeypatch):
    # 11T inner-or first operand (principal is None)
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000ac"), None, page_id="p", access=("user", "node"))
    assert exc.value.status_code == 403


async def test_user_page_unassigned_blocks(monkeypatch):
    # 11T inner-or third operand (not _check_user_access)
    with pytest.raises(HTTPException) as exc:
        await _authorize(
            monkeypatch,
            _dp("00000000-0000-0000-0000-0000000000ad"),
            ALICE,
            page_id="p",
            access=("user", "node"),
            user_access=False,
        )
    assert exc.value.status_code == 403


async def test_unknown_access_unauthenticated_401(monkeypatch):
    # 11F, 12T, inner user None → 401
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000ae"), None, page_id="p", access=("bogus", None))
    assert exc.value.status_code == 401


async def test_unknown_access_authenticated_403(monkeypatch):
    # 12T, inner user not None → 403
    with pytest.raises(HTTPException) as exc:
        await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000af"), ALICE, page_id="p", access=("bogus", None), allowed=[])
    assert exc.value.status_code == 403


async def test_public_page_room_local_allowed(monkeypatch):
    # 12F (public), 13F
    await _authorize(monkeypatch, _dp("00000000-0000-0000-0000-0000000000b0"), None, page_id="p", access=("public", None))


async def test_public_page_central_plant_blocks(monkeypatch):
    # 13T on the page-scoped path
    with pytest.raises(HTTPException) as exc:
        await _authorize(
            monkeypatch,
            _dp("00000000-0000-0000-0000-0000000000b1", control_class="central_plant"),
            None,
            page_id="p",
            access=("public", None),
        )
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Batch endpoint  POST /api/v1/visu/nodes/{node_id}/writable
# ---------------------------------------------------------------------------


class _RegistryStub:
    def __init__(self, dps):
        self._dps = {dp.id: dp for dp in dps}

    def get(self, dp_id):
        return self._dps.get(dp_id)


def _page_config_json(dp_ids: list[str]) -> str:
    widgets = ",".join(
        f'{{"id":"w{i}","name":"W","type":"value","datapoint_id":"{dp_id}","status_datapoint_id":null,"x":0,"y":0,"w":1,"h":1,"config":{{}}}}'
        for i, dp_id in enumerate(dp_ids)
    )
    return '{"grid_cols":12,"grid_row_height":80,"grid_cell_width":120,"background":null,"widgets":[' + widgets + "]}"


async def _insert_page(db: Database, node_id: str, access: str, dp_ids: list[str], *, node_type: str = "PAGE") -> None:
    await db.execute_and_commit(
        """
        INSERT INTO visu_nodes
            (id, parent_id, name, type, node_order, icon, access, access_pin, page_config, created_at, updated_at)
        VALUES (?, NULL, ?, ?, 0, NULL, ?, NULL, ?, ?, ?)
        """,
        (node_id, node_id, node_type, access, _page_config_json(dp_ids), NOW, NOW),
    )
    await db.execute_and_commit(
        "INSERT INTO authz_visu_page_policies (node_id, access_mode) VALUES (?, ?)",
        (node_id, access),
    )


async def _call_batch(db, node_id, *, user=None, session_token=None):
    request = MagicMock()
    request.headers.get = lambda key, default=None: {"X-Session-Token": session_token}.get(key, default)
    return await visu_api.get_writable_datapoints(node_id=node_id, request=request, db=db, user=user)


async def test_batch_rejects_non_page_node(db: Database):
    await _insert_page(db, "loc-1", "public", [], node_type="LOCATION")
    with pytest.raises(HTTPException) as exc:
        await _call_batch(db, "loc-1")
    assert exc.value.status_code == 400


async def test_batch_public_page_room_local_central_and_missing(monkeypatch, db: Database):
    room = _dp("00000000-0000-0000-0000-0000000000c1")
    central = _dp("00000000-0000-0000-0000-0000000000c2", control_class="central_plant")
    missing_id = "00000000-0000-0000-0000-0000000000c3"
    await _insert_page(db, "page-pub", "public", [str(room.id), str(central.id), missing_id])
    # Registry only knows room + central; missing_id is placed on the page but absent.
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _RegistryStub([room, central]))

    result = await _call_batch(db, "page-pub")
    assert result.writable == {
        str(room.id): True,
        str(central.id): False,
        missing_id: False,
    }


async def test_batch_readonly_page_all_false_but_readable(monkeypatch, db: Database):
    room = _dp("00000000-0000-0000-0000-0000000000c4")
    await _insert_page(db, "page-ro", "readonly", [str(room.id)])
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _RegistryStub([room]))

    result = await _call_batch(db, "page-ro")
    assert result.writable == {str(room.id): False}


async def test_batch_protected_page_requires_read_access(monkeypatch, db: Database):
    room = _dp("00000000-0000-0000-0000-0000000000c5")
    await _insert_page(db, "page-prot", "protected", [str(room.id)])
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _RegistryStub([room]))

    # No token → page read gate denies (mirrors get_page).
    with pytest.raises(HTTPException) as exc:
        await _call_batch(db, "page-prot")
    assert exc.value.status_code == 401

    # Valid token → readable, and room-local dp is writable.
    monkeypatch.setattr("obs.api.v1.visu.validate_session", lambda token, node_id: True)
    monkeypatch.setattr("obs.api.v1.datapoints.validate_session", lambda token, node_id: True)
    result = await _call_batch(db, "page-prot", session_token="tok")
    assert result.writable == {str(room.id): True}


async def test_batch_user_page_assigned_user_can_write(monkeypatch, db: Database):
    room = _dp("00000000-0000-0000-0000-0000000000c6")
    await db.execute_and_commit(
        "INSERT INTO users (id, username, password_hash, created_at, is_admin) VALUES ('uid', 'alice', 'h', ?, 0)",
        (NOW,),
    )
    await _insert_page(db, "page-user", "user", [str(room.id)])
    # Assigned to the page (visu_page READ) and granted datapoint READ+WRITE.
    await db.execute_and_commit(
        """INSERT INTO authz_node_roles (principal_type, principal_id, node_type, node_id, role, effect)
           VALUES ('user', 'alice', 'visu_page', 'page-user', 'guest', 'allow'),
                  ('user', 'alice', 'datapoint', ?, 'resident', 'allow')""",
        (str(room.id),),
    )
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _RegistryStub([room]))

    result = await _call_batch(db, "page-user", user=ALICE)
    assert result.writable == {str(room.id): True}


async def test_batch_matches_write_value_decision(monkeypatch, db: Database):
    """Parity: the batch verdict equals the real write path's allow/deny."""
    room = _dp("00000000-0000-0000-0000-0000000000c7")
    central = _dp("00000000-0000-0000-0000-0000000000c8", control_class="central_plant")
    await _insert_page(db, "page-parity", "public", [str(room.id), str(central.id)])
    registry = _RegistryStub([room, central])
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: registry)
    monkeypatch.setattr(dp_api, "get_registry", lambda: registry)
    event_bus = MagicMock()
    event_bus.publish = AsyncMock()
    monkeypatch.setattr(dp_api, "get_event_bus", lambda: event_bus)

    batch = (await _call_batch(db, "page-parity")).writable

    async def _write_ok(dp_id: uuid.UUID) -> bool:
        request = MagicMock()
        request.headers.get = lambda key, default=None: {"X-Page-Id": "page-parity"}.get(key, default)
        try:
            await dp_api.write_value(
                dp_id=dp_id,
                body=dp_api.WriteValueIn(value=1.0),
                request=request,
                user=None,
                db=db,
            )
            return True
        except HTTPException:
            return False

    assert batch[str(room.id)] is await _write_ok(room.id) is True
    assert batch[str(central.id)] is await _write_ok(central.id) is False
