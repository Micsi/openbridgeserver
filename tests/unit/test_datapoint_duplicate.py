from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi import BackgroundTasks

import obs.api.v1.datapoints as datapoints_api
from obs.models.datapoint import DataPoint


class _RegistryStub:
    def __init__(self, source: DataPoint, duplicate: DataPoint) -> None:
        self.source = source
        self.duplicate = duplicate
        self.inserted: list[uuid.UUID] = []
        self.published: list[uuid.UUID] = []

    def get(self, dp_id: uuid.UUID) -> DataPoint | None:
        return self.source if dp_id == self.source.id else None

    def prepare_create(self, _payload) -> DataPoint:
        return self.duplicate

    async def insert(self, dp: DataPoint) -> None:
        self.inserted.append(dp.id)

    def publish(self, dp: DataPoint) -> None:
        self.published.append(dp.id)


class _FailingDb:
    def __init__(self, binding: dict) -> None:
        self.binding = binding
        self.rolled_back = False

    async def fetchall(self, _sql: str, _params: tuple[str]) -> list[dict]:
        return [self.binding]

    async def executemany(self, _sql: str, _params: list[tuple]) -> None:
        raise RuntimeError("copy failed")

    async def rollback(self) -> None:
        self.rolled_back = True


class _SuccessfulDb:
    def __init__(self, binding: dict) -> None:
        self.binding = binding
        self.committed = False

    async def fetchall(self, _sql: str, _params: tuple[str]) -> list[dict]:
        return [self.binding]

    async def executemany(self, _sql: str, _params: list[tuple]) -> None:
        return None

    async def commit(self) -> None:
        self.committed = True


class _CancelledDb(_FailingDb):
    def __init__(self, binding: dict) -> None:
        super().__init__(binding)
        self.copy_started = asyncio.Event()

    async def executemany(self, _sql: str, _params: list[tuple]) -> None:
        self.copy_started.set()
        await asyncio.Future()


def _binding_row() -> dict:
    return {
        "adapter_type": "MQTT",
        "adapter_instance_id": str(uuid.uuid4()),
        "direction": "SOURCE",
        "config": '{"topic":"test"}',
        "enabled": 1,
        "send_throttle_ms": None,
        "send_on_change": 0,
        "send_min_delta": None,
        "send_min_delta_pct": None,
        "value_formula": None,
        "value_map": None,
    }


@pytest.mark.asyncio
async def test_duplicate_datapoint_removes_created_datapoint_when_binding_copy_fails(monkeypatch):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    registry = _RegistryStub(source, duplicate)
    db = _FailingDb(_binding_row())
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)

    with pytest.raises(RuntimeError, match="copy failed"):
        await datapoints_api.duplicate_datapoint(
            source.id,
            datapoints_api.DataPointDuplicateIn(name="Copy"),
            BackgroundTasks(),
            _user="admin",
            db=db,
        )

    assert db.rolled_back is True
    assert registry.inserted == [duplicate.id]
    assert registry.published == []


@pytest.mark.asyncio
async def test_duplicate_datapoint_cleans_up_when_binding_copy_is_cancelled(monkeypatch):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    registry = _RegistryStub(source, duplicate)
    db = _CancelledDb(_binding_row())
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)

    request_task = asyncio.create_task(
        datapoints_api.duplicate_datapoint(
            source.id,
            datapoints_api.DataPointDuplicateIn(name="Copy"),
            BackgroundTasks(),
            _user="admin",
            db=db,
        ),
    )
    await db.copy_started.wait()
    request_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await request_task

    assert db.rolled_back is True
    assert registry.inserted == [duplicate.id]
    assert registry.published == []


@pytest.mark.asyncio
async def test_duplicate_datapoint_defers_post_commit_adapter_reload_failures(monkeypatch, caplog):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    registry = _RegistryStub(source, duplicate)
    db = _SuccessfulDb(_binding_row())
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)
    monkeypatch.setattr(datapoints_api, "_enrich", lambda dp: dp)

    async def _reload_failure(_instance_id: str, _db) -> None:
        raise RuntimeError("reload failed")

    import obs.api.v1.bindings as bindings_api

    monkeypatch.setattr(bindings_api, "_reload_adapter_instance", _reload_failure)

    background_tasks = BackgroundTasks()
    result = await datapoints_api.duplicate_datapoint(
        source.id,
        datapoints_api.DataPointDuplicateIn(name="Copy"),
        background_tasks,
        _user="admin",
        db=db,
    )

    assert result is duplicate
    assert db.committed is True
    assert registry.published == [duplicate.id]
    assert "reload failed" not in caplog.text

    await background_tasks()

    assert "duplicated successfully" in caplog.text
    assert "reload failed" in caplog.text


@pytest.mark.asyncio
async def test_duplicate_datapoint_does_not_reload_disabled_bindings(monkeypatch):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    disabled_binding = {**_binding_row(), "enabled": 0}
    registry = _RegistryStub(source, duplicate)
    db = _SuccessfulDb(disabled_binding)
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)
    monkeypatch.setattr(datapoints_api, "_enrich", lambda dp: dp)

    background_tasks = BackgroundTasks()
    result = await datapoints_api.duplicate_datapoint(
        source.id,
        datapoints_api.DataPointDuplicateIn(name="Copy"),
        background_tasks,
        _user="admin",
        db=db,
    )

    assert result is duplicate
    assert registry.published == [duplicate.id]
    assert background_tasks.tasks == []
