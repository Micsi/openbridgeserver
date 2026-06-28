"""Unit tests for the MESSAGE adapter."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import BaseModel

from obs.adapters.message.adapter import (
    MessageAdapter,
    evaluate_condition,
    render_message,
)
from obs.adapters.message.providers.base import MessageSendResult
from obs.adapters.message.providers.registry import register_provider
from obs.core.event_bus import DataValueEvent
from tests.adapters.conftest import make_binding


class _DummyConfig(BaseModel):
    enabled: bool = True
    targets: dict[str, dict] = {}


class _DummyProvider:
    provider_type = "dummy"
    config_schema = _DummyConfig
    target_schema = BaseModel

    def __init__(self) -> None:
        self.send = AsyncMock(return_value=MessageSendResult("dummy", "default", True))


class _Dp:
    def __init__(self, dp_id: uuid.UUID, name: str = "Temperatur", unit: str | None = "°C") -> None:
        self.id = dp_id
        self.name = name
        self.unit = unit


class _Registry:
    def __init__(self, dp: _Dp) -> None:
        self._dp = dp

    def get(self, dp_id: uuid.UUID) -> _Dp | None:
        return self._dp if dp_id == self._dp.id else None


@pytest.mark.parametrize(
    ("value", "operator", "compare_value", "expected"),
    [
        ("anything", "any", None, True),
        (None, "any", "ignored", True),
        (29.4, ">=", 28, True),
        ("29.4", "<", "30", True),
        ("bad", "<", 30, False),
        ("open", "=", "open", True),
        (1, "==", "1", True),
        (True, "==", "true", True),
        (False, "==", "false", True),
        (True, "!=", "false", True),
        ("abc", "!=", "def", True),
        ("hello world", "contains", "world", True),
        ("hello world", "contains not", "mars", True),
        ("sensor/temp", "starts with", "sensor", True),
        ("sensor/temp", "ends with", "temp", True),
    ],
)
def test_evaluate_condition(value, operator, compare_value, expected):
    assert evaluate_condition(value, operator, compare_value) is expected


def test_render_message_replaces_value_unit_and_metadata():
    dp_id = uuid.uuid4()
    ts = datetime(2026, 6, 28, 12, 0, tzinfo=UTC)

    rendered = render_message(
        "###DPN### ###DPI### ###DP### ###DPU### ###TS###",
        value=29.4,
        unit="°C",
        name="Temperatur",
        datapoint_id=dp_id,
        ts=ts,
    )

    assert rendered == f"Temperatur {dp_id} 29.4 °C 2026-06-28T12:00:00+00:00"


@pytest.fixture
def dummy_provider():
    provider = _DummyProvider()
    register_provider(provider)
    return provider


@pytest.fixture
def bus():
    bus = MagicMock()
    bus.publish = AsyncMock()
    return bus


def _message_binding(dp_id: uuid.UUID, **config):
    binding = make_binding(
        {
            "operator": ">=",
            "compare_value": 28,
            "message": "Temperatur kritisch: ###DP### ###DPU###",
            "title": "OBS Alarm",
            "providers": [{"provider": "dummy", "target": "default"}],
            "send_on_change": True,
            **config,
        },
        direction="SOURCE",
    )
    binding.datapoint_id = dp_id
    return binding


@pytest.mark.asyncio
async def test_datapoint_update_sends_message_to_provider(bus, dummy_provider, monkeypatch):
    dp_id = uuid.uuid4()
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _Registry(_Dp(dp_id)))
    adapter = MessageAdapter(
        event_bus=bus,
        config={"providers": {"dummy": {"enabled": True, "targets": {"default": {"id": "x"}}}}},
    )
    binding = _message_binding(dp_id)
    await adapter.reload_bindings([binding])

    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=29.4, quality="good", source_adapter="test"))

    dummy_provider.send.assert_awaited_once()
    kwargs = dummy_provider.send.await_args.kwargs
    assert kwargs["title"] == "OBS Alarm"
    assert kwargs["message"] == "Temperatur kritisch: 29.4 °C"
    assert kwargs["target_name"] == "default"


@pytest.mark.asyncio
async def test_send_on_change_suppresses_repeated_true_condition(bus, dummy_provider, monkeypatch):
    dp_id = uuid.uuid4()
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _Registry(_Dp(dp_id)))
    adapter = MessageAdapter(
        event_bus=bus,
        config={"providers": {"dummy": {"enabled": True, "targets": {"default": {}}}}},
    )
    binding = _message_binding(dp_id)
    await adapter.reload_bindings([binding])

    event = DataValueEvent(datapoint_id=dp_id, value=29.4, quality="good", source_adapter="test")
    await adapter._on_value_event(event)
    await adapter._on_value_event(event)

    dummy_provider.send.assert_awaited_once()


@pytest.mark.asyncio
async def test_cooldown_suppresses_repeated_sends(bus, dummy_provider, monkeypatch):
    dp_id = uuid.uuid4()
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _Registry(_Dp(dp_id)))
    adapter = MessageAdapter(
        event_bus=bus,
        config={"providers": {"dummy": {"enabled": True, "targets": {"default": {}}}}},
    )
    binding = _message_binding(dp_id, send_on_change=False, cooldown_seconds=300)
    await adapter.reload_bindings([binding])

    event = DataValueEvent(datapoint_id=dp_id, value=29.4, quality="good", source_adapter="test")
    await adapter._on_value_event(event)
    await adapter._on_value_event(event)

    dummy_provider.send.assert_awaited_once()


@pytest.mark.asyncio
async def test_condition_reset_allows_next_true_transition(bus, dummy_provider, monkeypatch):
    dp_id = uuid.uuid4()
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _Registry(_Dp(dp_id)))
    adapter = MessageAdapter(
        event_bus=bus,
        config={"providers": {"dummy": {"enabled": True, "targets": {"default": {}}}}},
    )
    binding = _message_binding(dp_id)
    await adapter.reload_bindings([binding])

    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=29, quality="good", source_adapter="test"))
    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=20, quality="good", source_adapter="test"))
    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=30, quality="good", source_adapter="test"))

    assert dummy_provider.send.await_count == 2


@pytest.mark.asyncio
async def test_any_operator_sends_for_each_changed_value(bus, dummy_provider, monkeypatch):
    dp_id = uuid.uuid4()
    monkeypatch.setattr("obs.core.registry.get_registry", lambda: _Registry(_Dp(dp_id)))
    adapter = MessageAdapter(
        event_bus=bus,
        config={"providers": {"dummy": {"enabled": True, "targets": {"default": {}}}}},
    )
    binding = _message_binding(dp_id, operator="any", compare_value=None, send_on_change=True)
    await adapter.reload_bindings([binding])

    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=False, quality="good", source_adapter="test"))
    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=False, quality="good", source_adapter="test"))
    await adapter._on_value_event(DataValueEvent(datapoint_id=dp_id, value=True, quality="good", source_adapter="test"))

    assert dummy_provider.send.await_count == 2
