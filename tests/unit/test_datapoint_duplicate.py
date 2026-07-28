from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi import BackgroundTasks

import obs.api.v1.datapoints as datapoints_api
from obs.db.database import Database
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

    async def insert(self, dp: DataPoint, *, connection=None) -> None:
        self.inserted.append(dp.id)

    def publish(self, dp: DataPoint) -> None:
        self.published.append(dp.id)


class _FailingDb:
    def __init__(self, binding: dict) -> None:
        self.binding = binding
        self.rolled_back = False

    async def fetchall(self, _sql: str, _params: tuple[str]) -> list[dict]:
        return [self.binding]

    @asynccontextmanager
    async def isolated_transaction(self):
        yield self

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

    @asynccontextmanager
    async def isolated_transaction(self):
        yield self

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


class _SlowCommitDb(_SuccessfulDb):
    def __init__(self, binding: dict) -> None:
        super().__init__(binding)
        self.commit_started = asyncio.Event()
        self.finish_commit = asyncio.Event()

    async def commit(self) -> None:
        self.commit_started.set()
        await self.finish_commit.wait()
        self.committed = True


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


@pytest.mark.asyncio
async def test_duplicate_datapoint_publishes_if_cancelled_commit_completes(monkeypatch):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    registry = _RegistryStub(source, duplicate)
    db = _SlowCommitDb(_binding_row())
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)

    request_task = asyncio.create_task(
        datapoints_api.duplicate_datapoint(
            source.id,
            datapoints_api.DataPointDuplicateIn(name="Copy"),
            BackgroundTasks(),
            _user="admin",
            db=db,
        )
    )
    await db.commit_started.wait()
    request_task.cancel()
    db.finish_commit.set()

    with pytest.raises(asyncio.CancelledError):
        await request_task

    assert db.committed is True
    assert registry.published == [duplicate.id]


@pytest.mark.asyncio
async def test_database_transaction_uses_an_isolated_connection(tmp_path):
    db = Database(str(tmp_path / "isolated.db"))
    await db.connect()
    try:
        async with db.isolated_transaction() as transaction:
            assert transaction._conn is not db.conn
            await transaction.execute("CREATE TABLE isolated_write (id INTEGER PRIMARY KEY)")
            await transaction.commit()

        row = await db.fetchone("SELECT name FROM sqlite_master WHERE name='isolated_write'")
        assert row["name"] == "isolated_write"
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_memory_database_transaction_uses_shared_connection_and_rolls_back():
    db = Database(":memory:")
    await db.connect()
    try:
        await db.execute_and_commit("CREATE TABLE rolled_back_write (id INTEGER PRIMARY KEY)")
        async with db.isolated_transaction() as transaction:
            assert transaction._conn is db.conn
            await transaction.execute("INSERT INTO rolled_back_write (id) VALUES (1)")

        row = await db.fetchone("SELECT COUNT(*) AS count FROM rolled_back_write")
        assert row["count"] == 0
    finally:
        await db.disconnect()
