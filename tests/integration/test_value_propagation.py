"""
Integration Tests — Value Propagation via MQTT

Covers:
  - REST → MQTT:  POST /value fires an event → MQTT dp/{id}/value published
  - MQTT → REST:  publish dp/{id}/set → GET /value returns the written value
  - Payload format: JSON with fields v, u, t, q
"""
from __future__ import annotations

import asyncio
import json

import aiomqtt
import pytest


pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

_DP_PAYLOAD = {
    "name": "MQTT-Test DP",
    "data_type": "FLOAT",
    "unit": "W",
    "tags": ["mqtt-test"],
    "persist_value": False,
}


async def _create_dp(client, auth_headers, name: str | None = None) -> dict:
    payload = {**_DP_PAYLOAD}
    if name:
        payload["name"] = name
    resp = await client.post("/api/v1/datapoints/", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# REST → MQTT
# ---------------------------------------------------------------------------

async def test_value_via_rest_arrives_on_mqtt(
    client, auth_headers, mosquitto_port
):
    """
    Write a value via REST → the app should publish it to dp/{id}/value.
    We subscribe to that topic *before* writing and assert the message arrives
    within 3 seconds.
    """
    dp = await _create_dp(client, auth_headers, "MQTT-Sub Test")
    dp_id = dp["id"]
    topic = f"dp/{dp_id}/value"

    received: list[dict] = []

    async def _subscribe():
        async with aiomqtt.Client(hostname="localhost", port=mosquitto_port) as mqtt:
            await mqtt.subscribe(topic)
            async with asyncio.timeout(3.0):
                async for message in mqtt.messages:
                    received.append(json.loads(message.payload))
                    return  # got one message — done

    # Start subscriber in background, then write value
    sub_task = asyncio.create_task(_subscribe())
    await asyncio.sleep(0.2)  # tiny gap so subscribe is ready before publish

    write_resp = await client.post(
        f"/api/v1/datapoints/{dp_id}/value",
        json={"value": 123.4},
        headers=auth_headers,
    )
    assert write_resp.status_code == 204

    try:
        await asyncio.wait_for(sub_task, timeout=4.0)
    except asyncio.TimeoutError:
        pytest.fail("MQTT message not received within 4 s after REST write")

    assert len(received) >= 1
    msg = received[0]
    assert msg["v"] == pytest.approx(123.4)
    assert msg["u"] == "W"


async def test_payload_format_contains_required_fields(
    client, auth_headers, mosquitto_port
):
    """Verify the published MQTT payload has fields: v, u, t, q."""
    dp = await _create_dp(client, auth_headers, "Payload-Format Test")
    dp_id = dp["id"]
    topic = f"dp/{dp_id}/value"

    received: list[dict] = []

    async def _subscribe():
        async with aiomqtt.Client(hostname="localhost", port=mosquitto_port) as mqtt:
            await mqtt.subscribe(topic)
            async with asyncio.timeout(3.0):
                async for message in mqtt.messages:
                    received.append(json.loads(message.payload))
                    return

    sub_task = asyncio.create_task(_subscribe())
    await asyncio.sleep(0.2)

    await client.post(
        f"/api/v1/datapoints/{dp_id}/value",
        json={"value": 50.0},
        headers=auth_headers,
    )

    try:
        await asyncio.wait_for(sub_task, timeout=4.0)
    except asyncio.TimeoutError:
        pytest.fail("MQTT message not received in time")

    assert received, "No MQTT messages received"
    msg = received[0]
    for field in ("v", "u", "t", "q"):
        assert field in msg, f"Missing field '{field}' in MQTT payload: {msg}"


# ---------------------------------------------------------------------------
# MQTT → REST
# ---------------------------------------------------------------------------

async def test_mqtt_set_updates_value(client, auth_headers, mosquitto_port):
    """
    Publish dp/{id}/set via MQTT → app receives it via WriteRouter →
    GET /value returns the new value.
    """
    dp = await _create_dp(client, auth_headers, "MQTT-Set Test")
    dp_id = dp["id"]
    set_topic = f"dp/{dp_id}/set"

    async with aiomqtt.Client(hostname="localhost", port=mosquitto_port) as mqtt:
        await mqtt.publish(set_topic, payload="77.7")

    # Allow the broker → app propagation to complete
    await asyncio.sleep(0.5)

    resp = await client.get(
        f"/api/v1/datapoints/{dp_id}/value",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["value"] == pytest.approx(77.7, abs=0.01), (
        f"Expected 77.7 but got {body['value']}"
    )
