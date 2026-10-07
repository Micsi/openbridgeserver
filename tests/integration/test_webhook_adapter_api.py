"""Integration tests for the WEBHOOK adapter (issue #1256).

Exercises the real supported entry points end to end against the live FastAPI
app: the device-facing trigger URL below the instance path prefix, the two
management routes under ``/api/v1/adapters/instances/...``, and the webhook
rules the generic binding routes enforce.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

pytestmark = pytest.mark.integration

_MISSING_ID = "00000000-0000-0000-0000-000000000000"


async def _create_dp(client, auth_headers, *, data_type: str = "BOOLEAN", control_class: str = "room_local") -> dict:
    resp = await client.post(
        "/api/v1/datapoints/",
        json={
            "name": f"WebhookTest-{uuid.uuid4().hex[:8]}",
            "data_type": data_type,
            "control_class": control_class,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_instance(client, auth_headers, *, config: dict | None = None, enabled: bool = True) -> dict:
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={
            "adapter_type": "WEBHOOK",
            "name": f"Hook-{uuid.uuid4().hex[:6]}",
            "config": config or {},
            "enabled": enabled,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_binding(client, auth_headers, dp_id: str, instance_id: str, config: dict) -> dict:
    resp = await client.post(
        f"/api/v1/datapoints/{dp_id}/bindings",
        json={"adapter_instance_id": instance_id, "direction": "SOURCE", "config": config},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _dp_value(client, auth_headers, dp_id: str):
    resp = await client.get(f"/api/v1/datapoints/{dp_id}/value", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["value"]


async def _delete_instance(client, auth_headers, instance_id: str) -> None:
    resp = await client.delete(f"/api/v1/adapters/instances/{instance_id}", headers=auth_headers)
    assert resp.status_code in (200, 204), resp.text


async def _webhook_overview(client, auth_headers, instance_id: str) -> dict:
    resp = await client.get(f"/api/v1/adapters/instances/{instance_id}/webhook/bindings", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _webhook_bindings(client, auth_headers, instance_id: str) -> list[dict]:
    return (await _webhook_overview(client, auth_headers, instance_id))["bindings"]


# ---------------------------------------------------------------------------
# Binding lifecycle
# ---------------------------------------------------------------------------


async def test_create_binding_generates_a_token_and_redacts_it_in_the_generic_listing(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        created = await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-one"})
        assert created["config"]["token"] == "[redacted]"

        listed = await client.get(f"/api/v1/datapoints/{dp['id']}/bindings", headers=auth_headers)
        assert listed.status_code == 200, listed.text
        assert listed.json()[0]["config"]["token"] == "[redacted]"

        entries = await _webhook_bindings(client, auth_headers, instance["id"])
        assert len(entries) == 1
        entry = entries[0]
        assert entry["slug"] == "bell-one"
        assert len(entry["token"]) >= 40
        assert entry["call_path"] == f"/hook/bell-one?token={entry['token']}"
        assert entry["call_path_token_in_path"] == f"/hook/bell-one/{entry['token']}"
        assert entry["datapoint_id"] == dp["id"]
        assert entry["datapoint_name"] == dp["name"]
        assert entry["methods"] == ["GET"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_a_client_supplied_token_is_ignored_on_create_and_update(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        created = await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-two", "token": "attacker-chosen"},
        )
        issued = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]["token"]
        assert issued != "attacker-chosen"

        patched = await client.patch(
            f"/api/v1/datapoints/{dp['id']}/bindings/{created['id']}",
            json={"config": {"slug": "bell-two", "token": "attacker-chosen", "debounce_ms": 500}},
            headers=auth_headers,
        )
        assert patched.status_code == 200, patched.text
        after = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert after["token"] == issued
        assert after["debounce_ms"] == 500
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_webhook_bindings_must_be_source(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        resp = await client.post(
            f"/api/v1/datapoints/{dp['id']}/bindings",
            json={"adapter_instance_id": instance["id"], "direction": "DEST", "config": {"slug": "bell-three"}},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "SOURCE" in resp.json()["detail"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_central_plant_datapoints_are_refused(client, auth_headers):
    dp = await _create_dp(client, auth_headers, control_class="central_plant")
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        resp = await client.post(
            f"/api/v1/datapoints/{dp['id']}/bindings",
            json={"adapter_instance_id": instance["id"], "direction": "SOURCE", "config": {"slug": "plant-hook"}},
            headers=auth_headers,
        )
        assert resp.status_code == 403, resp.text
        assert "central_plant" in resp.json()["detail"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_duplicate_slug_in_one_instance_is_refused(client, auth_headers):
    first_dp = await _create_dp(client, auth_headers)
    second_dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        await _create_binding(client, auth_headers, first_dp["id"], instance["id"], {"slug": "shared-slug"})
        resp = await client.post(
            f"/api/v1/datapoints/{second_dp['id']}/bindings",
            json={"adapter_instance_id": instance["id"], "direction": "SOURCE", "config": {"slug": "shared-slug"}},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "shared-slug" in resp.json()["detail"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_patching_a_binding_onto_an_existing_slug_is_refused(client, auth_headers):
    first_dp = await _create_dp(client, auth_headers)
    second_dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        await _create_binding(client, auth_headers, first_dp["id"], instance["id"], {"slug": "taken-slug"})
        other = await _create_binding(client, auth_headers, second_dp["id"], instance["id"], {"slug": "free-slug"})

        collide = await client.patch(
            f"/api/v1/datapoints/{second_dp['id']}/bindings/{other['id']}",
            json={"config": {"slug": "taken-slug"}},
            headers=auth_headers,
        )
        assert collide.status_code == 422, collide.text

        keep = await client.patch(
            f"/api/v1/datapoints/{second_dp['id']}/bindings/{other['id']}",
            json={"config": {"slug": "free-slug", "debounce_ms": 10}},
            headers=auth_headers,
        )
        assert keep.status_code == 200, keep.text
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_invalid_binding_config_is_rejected(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        resp = await client.post(
            f"/api/v1/datapoints/{dp['id']}/bindings",
            json={"adapter_instance_id": instance["id"], "direction": "SOURCE", "config": {"slug": "not a slug"}},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


# ---------------------------------------------------------------------------
# Instance configuration
# ---------------------------------------------------------------------------


async def test_instance_rejects_a_reserved_path_prefix(client, auth_headers):
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={
            "adapter_type": "WEBHOOK",
            "name": f"Hook-{uuid.uuid4().hex[:6]}",
            "config": {"path_prefix": "/api"},
            "enabled": False,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 422, resp.text


async def test_binding_schema_is_served_for_the_new_adapter_type(client, auth_headers):
    resp = await client.get("/api/v1/adapters/WEBHOOK/binding-schema", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    binding_properties = set(resp.json()["properties"])
    assert binding_properties >= {"slug", "token", "methods", "allowed_networks", "value_source", "fixed_value", "value_param", "debounce_ms"}

    schema = await client.get("/api/v1/adapters/WEBHOOK/schema", headers=auth_headers)
    assert schema.status_code == 200, schema.text
    instance_properties = set(schema.json()["properties"])
    assert instance_properties == {"path_prefix", "trust_forwarded_for", "rate_limit_per_minute"}
    # The allowlist belongs to the binding; the instance must not offer one.
    assert "allowed_networks" not in instance_properties


# ---------------------------------------------------------------------------
# Trigger endpoint — the device-facing URL
# ---------------------------------------------------------------------------


async def test_get_trigger_sets_the_datapoint_value(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, config={"path_prefix": "/hook"})
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "doorbell"})
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        resp = await client.get(entry["call_path"])
        assert resp.status_code == 204, resp.text

        value = await client.get(f"/api/v1/datapoints/{dp['id']}/value", headers=auth_headers)
        assert value.status_code == 200, value.text
        assert value.json()["value"] is True

        stats = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert stats["call_count"] == 1
        assert stats["publish_count"] == 1
        assert stats["last_status"] == 204
        assert stats["last_called"] is not None
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_token_in_path_variant_works(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-path"})
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        resp = await client.get(entry["call_path_token_in_path"])
        assert resp.status_code == 204, resp.text
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_post_with_a_json_body_sets_the_value(client, auth_headers):
    dp = await _create_dp(client, auth_headers, data_type="INTEGER")
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-post", "methods": ["POST"], "value_source": "request"},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        resp = await client.post(f"/hook/bell-post?token={entry['token']}", json={"value": 42})
        assert resp.status_code == 204, resp.text

        value = await client.get(f"/api/v1/datapoints/{dp['id']}/value", headers=auth_headers)
        assert value.json()["value"] == 42
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_wrong_token_and_unknown_slug_both_return_json_404(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-404"})

        wrong = await client.get("/hook/bell-404?token=nope")
        unknown = await client.get("/hook/does-not-exist?token=nope")

        for resp in (wrong, unknown):
            assert resp.status_code == 404
            assert resp.json() == {"detail": "Not found"}
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_unsupported_method_on_a_claimed_prefix_returns_404(client, auth_headers):
    instance = await _create_instance(client, auth_headers)
    try:
        resp = await client.put("/hook/anything")
        assert resp.status_code == 404
        assert resp.json() == {"detail": "Not found"}
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_options_preflight_passes_through_to_the_cors_layer(client, auth_headers):
    """The webhook gate must not swallow OPTIONS, or CORS preflights break."""
    instance = await _create_instance(client, auth_headers)
    try:
        resp = await client.options(
            "/hook/anything",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_custom_path_prefix_is_honoured(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, config={"path_prefix": "/iot/trigger"})
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-prefix"})
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert entry["call_path"].startswith("/iot/trigger/bell-prefix?token=")

        # The default prefix is not claimed by this instance, so the call never
        # reaches the adapter.  It falls through to the normal request stack,
        # which answers an unknown non-API path with the Admin-GUI shell — what
        # matters is that no value was published.
        await client.get(f"/hook/bell-prefix?token={entry['token']}")
        assert await _dp_value(client, auth_headers, dp["id"]) is None
        assert (await _webhook_bindings(client, auth_headers, instance["id"]))[0]["call_count"] == 0

        assert (await client.get(entry["call_path"])).status_code == 204
        assert await _dp_value(client, auth_headers, dp["id"]) is True
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_allowlist_blocks_the_test_client(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-binding-allowlist", "allowed_networks": ["203.0.113.0/24"]},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert entry["allowed_networks"] == ["203.0.113.0/24"]

        resp = await client.get(entry["call_path"])

        assert resp.status_code == 404
        assert await _dp_value(client, auth_headers, dp["id"]) is None
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_a_binding_allowlist_that_covers_the_caller_lets_it_through(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-allowed", "allowed_networks": ["127.0.0.0/8", "::1"]},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        assert (await client.get(entry["call_path"])).status_code == 204
        assert await _dp_value(client, auth_headers, dp["id"]) is True
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_autoreset_turns_the_webhook_into_a_trigger(client, auth_headers):
    """One call, two values on the bus — so the next press is a fresh edge."""
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-trigger", "autoreset": True, "autoreset_value": "false", "autoreset_delay_ms": 0},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert entry["autoreset"] is True
        assert entry["autoreset_value"] == "false"
        assert entry["autoreset_delay_ms"] == 0

        assert (await client.get(entry["call_path"])).status_code == 204

        # The reset runs on its own task; give the loop a turn to finish it.
        for _ in range(50):
            if await _dp_value(client, auth_headers, dp["id"]) is False:
                break
            await asyncio.sleep(0.01)

        assert await _dp_value(client, auth_headers, dp["id"]) is False
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_autoreset_is_off_by_default(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-no-reset"})
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert entry["autoreset"] is False

        assert (await client.get(entry["call_path"])).status_code == 204
        await asyncio.sleep(0.05)
        assert await _dp_value(client, auth_headers, dp["id"]) is True
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_rejections_are_reported_with_reason_and_address(client, auth_headers):
    """The diagnostics that turn an opaque 404 into something actionable."""
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-diag", "allowed_networks": ["203.0.113.0/24"]},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        assert (await client.get(entry["call_path"])).status_code == 404

        overview = await _webhook_overview(client, auth_headers, instance["id"])
        assert "allowed_networks" not in overview
        assert overview["running"] is True
        rejections = overview["rejections"]
        assert rejections["total"] == 1
        assert rejections["counts"] == {"address_blocked": 1}
        assert rejections["last_reason"] == "address_blocked"
        assert rejections["last_client_ip"]
        assert rejections["last_at"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_a_rejection_is_reported_on_the_binding_that_caused_it(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-binding-diag", "allowed_networks": ["203.0.113.0/24"]},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert (await client.get(entry["call_path"])).status_code == 404

        after = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert after["rejections"]["counts"] == {"address_blocked": 1}
        assert after["rejections"]["last_reason"] == "address_blocked"
        assert after["last_status"] == 404
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_a_legacy_comma_separated_allowlist_still_loads(client, auth_headers):
    """A binding stored before the field became a list must keep working."""
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-legacy", "allowed_networks": "10.0.0.0/8, 192.168.1.5"},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]
        assert entry["allowed_networks"] == ["10.0.0.0/8", "192.168.1.5/32"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_rate_limit_answers_429(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, config={"rate_limit_per_minute": 1})
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-rate"})
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        assert (await client.get(entry["call_path"])).status_code == 204
        limited = await client.get(entry["call_path"])
        assert limited.status_code == 429
        assert limited.json() == {"detail": "Too many requests"}
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_missing_request_value_answers_400(client, auth_headers):
    dp = await _create_dp(client, auth_headers, data_type="INTEGER")
    instance = await _create_instance(client, auth_headers)
    try:
        await _create_binding(
            client,
            auth_headers,
            dp["id"],
            instance["id"],
            {"slug": "bell-novalue", "value_source": "request"},
        )
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        resp = await client.get(entry["call_path"])
        assert resp.status_code == 400
        assert "value" in resp.json()["detail"]
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_a_disabled_instance_claims_no_prefix(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-disabled"})
        entry = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        # Nothing claims /hook while the instance is disabled, so the call
        # falls through to the normal request stack and no value is published.
        await client.get(entry["call_path"])
        assert await _dp_value(client, auth_headers, dp["id"]) is None
        assert entry["call_count"] == 0
        assert entry["last_status"] is None
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


# ---------------------------------------------------------------------------
# Token rotation
# ---------------------------------------------------------------------------


async def test_rotating_a_token_revokes_the_old_url(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers)
    try:
        binding = await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-rotate"})
        old = (await _webhook_bindings(client, auth_headers, instance["id"]))[0]

        rotated = await client.post(
            f"/api/v1/adapters/instances/{instance['id']}/webhook/bindings/{binding['id']}/rotate-token",
            headers=auth_headers,
        )
        assert rotated.status_code == 200, rotated.text
        body = rotated.json()
        assert body["slug"] == "bell-rotate"
        assert body["token"] != old["token"]
        assert body["call_path"] == f"/hook/bell-rotate?token={body['token']}"
        assert body["call_path_token_in_path"] == f"/hook/bell-rotate/{body['token']}"

        assert (await client.get(old["call_path"])).status_code == 404
        assert (await client.get(body["call_path"])).status_code == 204
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_rotation_writes_an_audit_entry_without_the_token(client, auth_headers):
    from obs.db.database import get_db

    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        binding = await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "bell-audit"})
        rotated = await client.post(
            f"/api/v1/adapters/instances/{instance['id']}/webhook/bindings/{binding['id']}/rotate-token",
            headers=auth_headers,
        )
        assert rotated.status_code == 200, rotated.text
        token = rotated.json()["token"]

        row = await get_db().fetchone(
            """
            SELECT actor, action, resource_type, resource_id, details_json
            FROM audit_log_entries
            WHERE action = 'adapter.webhook.token_rotated'
            ORDER BY id DESC
            LIMIT 1
            """
        )
        assert row is not None
        assert row["actor"] == "admin"
        assert row["resource_type"] == "adapter_instance"
        assert row["resource_id"] == binding["id"]
        assert token not in (row["details_json"] or "")
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_rotation_rejects_unknown_instances_and_bindings(client, auth_headers):
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        missing_instance = await client.post(
            f"/api/v1/adapters/instances/{_MISSING_ID}/webhook/bindings/{_MISSING_ID}/rotate-token",
            headers=auth_headers,
        )
        assert missing_instance.status_code == 404

        missing_binding = await client.post(
            f"/api/v1/adapters/instances/{instance['id']}/webhook/bindings/{_MISSING_ID}/rotate-token",
            headers=auth_headers,
        )
        assert missing_binding.status_code == 404
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_webhook_routes_reject_a_non_webhook_instance(client, auth_headers):
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={
            "adapter_type": "ANWESENHEITSSIMULATION",
            "name": f"NotHook-{uuid.uuid4().hex[:6]}",
            "config": {},
            "enabled": False,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    instance_id = resp.json()["id"]
    try:
        listing = await client.get(f"/api/v1/adapters/instances/{instance_id}/webhook/bindings", headers=auth_headers)
        assert listing.status_code == 400

        rotation = await client.post(
            f"/api/v1/adapters/instances/{instance_id}/webhook/bindings/{_MISSING_ID}/rotate-token",
            headers=auth_headers,
        )
        assert rotation.status_code == 400

        missing = await client.get(f"/api/v1/adapters/instances/{_MISSING_ID}/webhook/bindings", headers=auth_headers)
        assert missing.status_code == 404
    finally:
        await _delete_instance(client, auth_headers, instance_id)


async def test_webhook_management_routes_require_authentication(client):
    instance_id = _MISSING_ID
    assert (await client.get(f"/api/v1/adapters/instances/{instance_id}/webhook/bindings")).status_code == 401
    assert (await client.post(f"/api/v1/adapters/instances/{instance_id}/webhook/bindings/{_MISSING_ID}/rotate-token")).status_code == 401


# ---------------------------------------------------------------------------
# Review follow-ups
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("prefix", ["/docs", "/redoc", "/openapi.json", "/favicon.svg"])
async def test_instance_rejects_prefixes_that_would_shadow_application_surfaces(client, auth_headers, prefix):
    resp = await client.post(
        "/api/v1/adapters/instances",
        json={"adapter_type": "WEBHOOK", "name": f"Hook-{uuid.uuid4().hex[:6]}", "config": {"path_prefix": prefix}, "enabled": False},
        headers=auth_headers,
    )
    assert resp.status_code == 422, resp.text


async def test_an_oversized_post_is_cut_off_before_authentication(client, auth_headers):
    instance = await _create_instance(client, auth_headers)
    try:
        declared = await client.post("/hook/does-not-exist", content=b"x" * (64 * 1024 + 1))
        assert declared.status_code == 413
        assert declared.json() == {"detail": "Request body is too large"}

        async def chunks():
            for _ in range(65):
                yield b"x" * 1024

        undeclared = await client.post("/hook/does-not-exist", content=chunks())
        assert undeclared.status_code == 413

        small = await client.post("/hook/does-not-exist", content=b"{}")
        assert small.status_code == 404
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_a_binding_on_a_reclassified_datapoint_can_be_disabled_but_not_re_enabled(client, auth_headers):
    dp = await _create_dp(client, auth_headers)
    instance = await _create_instance(client, auth_headers, enabled=False)
    try:
        binding = await _create_binding(client, auth_headers, dp["id"], instance["id"], {"slug": "reclassified"})
        reclass = await client.patch(f"/api/v1/datapoints/{dp['id']}", json={"control_class": "central_plant"}, headers=auth_headers)
        assert reclass.status_code == 200, reclass.text

        off = await client.patch(f"/api/v1/datapoints/{dp['id']}/bindings/{binding['id']}", json={"enabled": False}, headers=auth_headers)
        assert off.status_code == 200, off.text

        on = await client.patch(f"/api/v1/datapoints/{dp['id']}/bindings/{binding['id']}", json={"enabled": True}, headers=auth_headers)
        assert on.status_code == 403, on.text
    finally:
        await _delete_instance(client, auth_headers, instance["id"])


async def test_migration_refuses_a_slug_the_target_instance_already_owns(client, auth_headers):
    source_dp = await _create_dp(client, auth_headers)
    target_dp = await _create_dp(client, auth_headers)
    source = await _create_instance(client, auth_headers, enabled=False)
    target = await _create_instance(client, auth_headers, enabled=False)
    try:
        moving = await _create_binding(client, auth_headers, source_dp["id"], source["id"], {"slug": "bell"})
        await _create_binding(client, auth_headers, target_dp["id"], target["id"], {"slug": "bell"})

        resp = await client.post(
            f"/api/v1/adapters/instances/{source['id']}/bindings/migrate",
            json={"target_instance_id": target["id"]},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "bell" in resp.json()["detail"]

        still_there = await _webhook_bindings(client, auth_headers, source["id"])
        assert [entry["binding_id"] for entry in still_there] == [moving["id"]]
    finally:
        await _delete_instance(client, auth_headers, source["id"])
        await _delete_instance(client, auth_headers, target["id"])


async def test_migration_moves_webhook_bindings_with_distinct_slugs(client, auth_headers):
    source_dp = await _create_dp(client, auth_headers)
    target_dp = await _create_dp(client, auth_headers)
    source = await _create_instance(client, auth_headers, enabled=False)
    target = await _create_instance(client, auth_headers, enabled=False)
    try:
        moving = await _create_binding(client, auth_headers, source_dp["id"], source["id"], {"slug": "moves"})
        await _create_binding(client, auth_headers, target_dp["id"], target["id"], {"slug": "stays"})

        resp = await client.post(
            f"/api/v1/adapters/instances/{source['id']}/bindings/migrate",
            json={"target_instance_id": target["id"]},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["migrated"] == 1

        moved = await _webhook_bindings(client, auth_headers, target["id"])
        assert moving["id"] in [entry["binding_id"] for entry in moved]
    finally:
        await _delete_instance(client, auth_headers, source["id"])
        await _delete_instance(client, auth_headers, target["id"])
