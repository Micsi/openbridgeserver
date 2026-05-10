"""Integration tests — Logikblatt aktivieren/deaktivieren (issue #422).

Verifies that:
  1. A newly created logic graph has enabled=True by default.
  2. PATCH /api/v1/logic/graphs/{id} with enabled=False deactivates the graph.
  3. PATCH /api/v1/logic/graphs/{id} with enabled=True re-activates the graph.
  4. The enabled flag is persisted and reflected in GET responses.
"""

from __future__ import annotations

import time

import pytest

pytestmark = pytest.mark.integration


async def _create_graph(client, auth_headers, name: str) -> dict:
    resp = await client.post(
        "/api/v1/logic/graphs",
        json={"name": name, "description": "", "enabled": True, "flow_data": {"nodes": [], "edges": []}},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _get_graph(client, auth_headers, graph_id: str) -> dict:
    resp = await client.get(f"/api/v1/logic/graphs/{graph_id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _patch_graph(client, auth_headers, graph_id: str, payload: dict) -> dict:
    resp = await client.patch(f"/api/v1/logic/graphs/{graph_id}", json=payload, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _cleanup(client, auth_headers, graph_id: str) -> None:
    await client.delete(f"/api/v1/logic/graphs/{graph_id}", headers=auth_headers)


@pytest.mark.asyncio
async def test_new_graph_is_enabled_by_default(client, auth_headers):
    """Neu erstellte Logikblätter sind standardmässig aktiv."""
    ts = time.time()
    graph = await _create_graph(client, auth_headers, f"IT-Toggle-Default-{ts}")
    graph_id = graph["id"]
    try:
        assert graph["enabled"] is True
        fetched = await _get_graph(client, auth_headers, graph_id)
        assert fetched["enabled"] is True
    finally:
        await _cleanup(client, auth_headers, graph_id)


@pytest.mark.asyncio
async def test_patch_enabled_false_deactivates_graph(client, auth_headers):
    """PATCH enabled=False deaktiviert das Logikblatt."""
    ts = time.time()
    graph = await _create_graph(client, auth_headers, f"IT-Toggle-Disable-{ts}")
    graph_id = graph["id"]
    try:
        updated = await _patch_graph(client, auth_headers, graph_id, {"enabled": False})
        assert updated["enabled"] is False

        fetched = await _get_graph(client, auth_headers, graph_id)
        assert fetched["enabled"] is False
    finally:
        await _cleanup(client, auth_headers, graph_id)


@pytest.mark.asyncio
async def test_patch_enabled_true_reactivates_graph(client, auth_headers):
    """PATCH enabled=True re-aktiviert ein deaktiviertes Logikblatt."""
    ts = time.time()
    graph = await _create_graph(client, auth_headers, f"IT-Toggle-Reactivate-{ts}")
    graph_id = graph["id"]
    try:
        await _patch_graph(client, auth_headers, graph_id, {"enabled": False})
        updated = await _patch_graph(client, auth_headers, graph_id, {"enabled": True})
        assert updated["enabled"] is True

        fetched = await _get_graph(client, auth_headers, graph_id)
        assert fetched["enabled"] is True
    finally:
        await _cleanup(client, auth_headers, graph_id)


@pytest.mark.asyncio
async def test_patch_enabled_does_not_affect_name_or_flow(client, auth_headers):
    """PATCH enabled ändert weder Name noch flow_data des Logikblatts."""
    ts = time.time()
    original_name = f"IT-Toggle-Preserve-{ts}"
    graph = await _create_graph(client, auth_headers, original_name)
    graph_id = graph["id"]
    try:
        updated = await _patch_graph(client, auth_headers, graph_id, {"enabled": False})
        assert updated["name"] == original_name
        assert updated["flow_data"]["nodes"] == []
        assert updated["flow_data"]["edges"] == []
    finally:
        await _cleanup(client, auth_headers, graph_id)


@pytest.mark.asyncio
async def test_list_graphs_includes_enabled_field(client, auth_headers):
    """GET /api/v1/logic/graphs gibt enabled-Feld für alle Logikblätter zurück."""
    ts = time.time()
    graph = await _create_graph(client, auth_headers, f"IT-Toggle-List-{ts}")
    graph_id = graph["id"]
    try:
        await _patch_graph(client, auth_headers, graph_id, {"enabled": False})

        resp = await client.get("/api/v1/logic/graphs", headers=auth_headers)
        assert resp.status_code == 200
        graphs = resp.json()
        target = next((g for g in graphs if g["id"] == graph_id), None)
        assert target is not None
        assert target["enabled"] is False
    finally:
        await _cleanup(client, auth_headers, graph_id)
