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
        self.in_transaction = False

    async def fetchall(self, _sql: str, _params: tuple[str]) -> list[dict]:
        assert self.in_transaction
        return [self.binding]

    async def fetchone(self, _sql: str, _params: tuple[str]) -> dict:
        assert self.in_transaction
        return {"exists": 1}

    @asynccontextmanager
    async def isolated_transaction(self):
        self.in_transaction = True
        try:
            yield self
        finally:
            self.in_transaction = False

    async def execute(self, sql: str, _params=()) -> None:
        assert sql == "BEGIN IMMEDIATE"

    async def executemany(self, _sql: str, _params: list[tuple]) -> None:
        raise RuntimeError("copy failed")

    async def rollback(self) -> None:
        self.rolled_back = True


class _SuccessfulDb:
    def __init__(self, binding: dict) -> None:
        self.binding = binding
        self.committed = False
        self.in_transaction = False

    async def fetchall(self, _sql: str, _params: tuple[str]) -> list[dict]:
        assert self.in_transaction
        return [self.binding]

    async def fetchone(self, _sql: str, _params: tuple[str]) -> dict:
        assert self.in_transaction
        return {"exists": 1}

    @asynccontextmanager
    async def isolated_transaction(self):
        self.in_transaction = True
        try:
            yield self
        finally:
            self.in_transaction = False

    async def execute(self, sql: str, _params=()) -> None:
        assert sql == "BEGIN IMMEDIATE"

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


class _MissingSourceDb(_FailingDb):
    async def fetchone(self, _sql: str, _params: tuple[str]) -> None:
        assert self.in_transaction


class _SlowCommitDb(_SuccessfulDb):
    def __init__(self, binding: dict) -> None:
        super().__init__(binding)
        self.commit_started = asyncio.Event()
        self.finish_commit = asyncio.Event()

    async def commit(self) -> None:
        self.commit_started.set()
        await self.finish_commit.wait()
        self.committed = True


class _SlowExitDb(_SuccessfulDb):
    def __init__(self, binding: dict) -> None:
        super().__init__(binding)
        self.exit_started = asyncio.Event()

    @asynccontextmanager
    async def isolated_transaction(self):
        self.in_transaction = True
        try:
            yield self
        finally:
            self.exit_started.set()
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
async def test_duplicate_datapoint_rechecks_source_inside_transaction(monkeypatch):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    registry = _RegistryStub(source, duplicate)
    db = _MissingSourceDb(_binding_row())
    monkeypatch.setattr(datapoints_api, "get_registry", lambda: registry)

    with pytest.raises(datapoints_api.HTTPException) as exc_info:
        await datapoints_api.duplicate_datapoint(
            source.id,
            datapoints_api.DataPointDuplicateIn(name="Copy"),
            BackgroundTasks(),
            _user="admin",
            db=db,
        )

    assert exc_info.value.status_code == 404
    assert db.rolled_back is True
    assert registry.inserted == []
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
    reloaded = asyncio.Event()

    async def _record_reload(_dp_id, _instance_ids, _db):
        reloaded.set()

    monkeypatch.setattr(datapoints_api, "_reload_duplicate_bindings", _record_reload)

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
    assert reloaded.is_set()


@pytest.mark.asyncio
async def test_duplicate_datapoint_publishes_before_transaction_cleanup(monkeypatch):
    source = DataPoint(name="Source", data_type="FLOAT")
    duplicate = DataPoint(name="Copy", data_type="FLOAT")
    registry = _RegistryStub(source, duplicate)
    db = _SlowExitDb(_binding_row())
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
    await db.exit_started.wait()

    assert db.committed is True
    assert registry.published == [duplicate.id]

    request_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await request_task


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
async def test_memory_database_transaction_uses_private_connection_and_rolls_back():
    db = Database(":memory:")
    await db.connect()
    try:
        await db.execute_and_commit("CREATE TABLE rolled_back_write (id INTEGER PRIMARY KEY)")
        async with db.isolated_transaction() as transaction:
            assert transaction._conn is not db.conn
            await transaction.execute("INSERT INTO rolled_back_write (id) VALUES (1)")

        row = await db.fetchone("SELECT COUNT(*) AS count FROM rolled_back_write")
        assert row["count"] == 0
    finally:
        await db.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "database_path",
    [":memory:", "file:duplicate-lock?mode=memory&cache=shared"],
)
async def test_memory_database_ordinary_write_waits_for_isolated_transaction(database_path):
    db = Database(database_path)
    await db.connect()
    try:
        await db.execute_and_commit("CREATE TABLE serialized_write (id INTEGER PRIMARY KEY)")
        async with db.isolated_transaction() as transaction:
            await transaction.execute("INSERT INTO serialized_write (id) VALUES (1)")
            ordinary_write = asyncio.create_task(db.execute_and_commit("INSERT INTO serialized_write (id) VALUES (2)"))
            await asyncio.sleep(0)
            assert not ordinary_write.done()
            await transaction.commit()

        await ordinary_write
        row = await db.fetchone("SELECT COUNT(*) AS count FROM serialized_write")
        assert row["count"] == 2
    finally:
        await db.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "database_path",
    [":memory:", "file:duplicate-wait?mode=memory&cache=shared"],
)
async def test_memory_database_isolated_transaction_waits_for_ordinary_transaction(database_path):
    db = Database(database_path)
    await db.connect()
    try:
        await db.execute_and_commit("CREATE TABLE ordinary_write (id INTEGER PRIMARY KEY)")
        await db.execute("INSERT INTO ordinary_write (id) VALUES (1)")
        transaction_entered = asyncio.Event()

        async def _enter_transaction() -> None:
            async with db.isolated_transaction():
                transaction_entered.set()

        transaction_task = asyncio.create_task(_enter_transaction())
        await asyncio.sleep(0)
        assert not transaction_entered.is_set()

        await db.commit()
        await transaction_task
        assert transaction_entered.is_set()
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_disconnect_waits_for_isolated_transaction(tmp_path):
    db = Database(str(tmp_path / "disconnect.db"))
    await db.connect()
    transaction_entered = asyncio.Event()
    release_transaction = asyncio.Event()

    async def _hold_transaction() -> None:
        async with db.isolated_transaction():
            transaction_entered.set()
            await release_transaction.wait()

    transaction_task = asyncio.create_task(_hold_transaction())
    await transaction_entered.wait()
    disconnect_task = asyncio.create_task(db.disconnect())
    await asyncio.sleep(0)
    assert not disconnect_task.done()

    release_transaction.set()
    await transaction_task
    await disconnect_task
    assert db._conn is None


@pytest.mark.asyncio
async def test_exclusive_lifecycle_blocks_transactions_until_reconnect(tmp_path):
    db = Database(str(tmp_path / "replacement.db"))
    await db.connect()
    transaction_entered = asyncio.Event()

    async def _enter_transaction() -> None:
        async with db.isolated_transaction():
            transaction_entered.set()

    async with db.exclusive_lifecycle() as lifecycle:
        await lifecycle.disconnect()
        transaction_task = asyncio.create_task(_enter_transaction())
        await asyncio.sleep(0)
        assert not transaction_entered.is_set()
        await lifecycle.connect()

    await transaction_task
    assert transaction_entered.is_set()
    await db.disconnect()


@pytest.mark.asyncio
async def test_isolated_transaction_rejects_disconnected_database(tmp_path):
    db = Database(str(tmp_path / "disconnected.db"))
    await db.connect()
    await db.disconnect()

    with pytest.raises(RuntimeError, match=r"Database\.connect"):
        async with db.isolated_transaction():
            pytest.fail("disconnected transaction unexpectedly opened")
