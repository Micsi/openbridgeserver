"""
Integration Test Fixtures — Ebene 2

Session-scoped setup:
  1. mosquitto  — Eclipse Mosquitto in Docker (anonymous, port 18830)
  2. app        — FastAPI app with lifespan, SQLite :memory:, test MQTT port
  3. client     — httpx.AsyncClient via ASGITransport
  4. auth_headers — Bearer token from admin/admin login

Requirements (install alongside regular deps):
  pip install pytest-asyncio asgi-lifespan httpx
"""
from __future__ import annotations

import os
import subprocess
import tempfile
import time

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import AsyncClient, ASGITransport


# ---------------------------------------------------------------------------
# Mosquitto Docker fixture (sync — subprocess only)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def mosquitto_port():
    """
    Start eclipse-mosquitto in Docker with anonymous access enabled.
    Yields the host port (18830). Stops/removes the container on teardown.
    """
    port = 18830

    # Write a minimal mosquitto config that allows anonymous connections
    cfg = tempfile.NamedTemporaryFile(
        mode="w", suffix=".conf", delete=False, prefix="obs_test_mosquitto_"
    )
    cfg.write("listener 1883\nallow_anonymous true\n")
    cfg.flush()
    cfg.close()

    cid = subprocess.check_output([
        "docker", "run", "-d",
        "-p", f"{port}:1883",
        "-v", f"{cfg.name}:/mosquitto/config/mosquitto.conf:ro",
        "eclipse-mosquitto",
    ]).decode().strip()

    # Give the broker a moment to start accepting connections
    time.sleep(1.5)

    yield port

    subprocess.run(["docker", "stop", cid], check=False, capture_output=True)
    subprocess.run(["docker", "rm",   cid], check=False, capture_output=True)
    try:
        os.unlink(cfg.name)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# App + Client (async session fixtures)
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture(scope="session")
async def app(mosquitto_port):
    """
    Create the FastAPI app with:
      - SQLite :memory: (fresh for this test session)
      - MQTT pointing at the test Mosquitto container
      - JWT secret long enough to pass validation
      - Mosquitto passwd file in /tmp (no reload needed in tests)

    Lifespan is managed by asgi_lifespan.LifespanManager so startup/shutdown
    hooks run exactly once for the whole test session.
    """
    from obs.config import (
        override_settings, Settings,
        DatabaseSettings, MqttSettings, SecuritySettings,
        MosquittoSettings, RingBufferSettings,
    )

    override_settings(Settings(
        database=DatabaseSettings(
            path=":memory:",
            history_plugin="sqlite",
        ),
        mqtt=MqttSettings(
            host="localhost",
            port=mosquitto_port,
            username=None,
            password=None,
        ),
        security=SecuritySettings(
            jwt_secret="integration-test-secret-32-chars-xx",
            jwt_expire_minutes=60,
        ),
        mosquitto=MosquittoSettings(
            passwd_file="/tmp/obs_integration_test_passwd",
            reload_pid=None,
            reload_command=None,
            service_username="obs",
            service_password="test",
        ),
        ringbuffer=RingBufferSettings(
            storage="memory",
            max_entries=1000,
        ),
    ))

    from obs.main import create_app
    _app = create_app()

    async with LifespanManager(_app):
        yield _app

    # Reset all singletons so other test sessions (if any) start clean
    from obs.db.database import reset_db
    from obs.core.registry import reset_registry
    from obs.core.event_bus import reset_event_bus
    from obs.core.mqtt_client import reset_mqtt_client
    from obs.core.write_router import reset_write_router
    from obs.ringbuffer.ringbuffer import reset_ringbuffer
    from obs.history.factory import reset_history_plugin
    from obs.api.v1.websocket import reset_ws_manager

    reset_ws_manager()
    reset_write_router()
    reset_mqtt_client()
    reset_history_plugin()
    reset_ringbuffer()
    reset_registry()
    reset_event_bus()
    reset_db()


@pytest_asyncio.fixture(scope="session")
async def client(app):
    """httpx.AsyncClient wired to the in-process FastAPI app."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c


@pytest_asyncio.fixture(scope="session")
async def auth_headers(client):
    """Login once as admin and return the Authorization header dict."""
    resp = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
