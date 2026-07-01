"""WAL maintenance for the main SQLite database (issue #908).

Verifies that the main DB bounds its ``-wal`` sidecar via PRAGMAs and that an explicit
TRUNCATE checkpoint (and the background maintenance scheduler) actually shrinks the WAL
file on disk.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from obs.db.database import Database
from obs.db.maintenance import (
    DatabaseMaintenanceScheduler,
    get_db_maintenance_scheduler,
    init_db_maintenance_scheduler,
)


async def _wal_size(db_path: Path) -> int:
    wal = Path(f"{db_path}-wal")
    return wal.stat().st_size if wal.exists() else 0


async def _grow_wal(db: Database) -> None:
    """Write enough rows to force the WAL file to grow on disk."""
    await db.execute("CREATE TABLE IF NOT EXISTS blob_test (id INTEGER PRIMARY KEY, payload TEXT)")
    await db.commit()
    payload = "x" * 4096
    for _ in range(2000):
        await db.execute("INSERT INTO blob_test (payload) VALUES (?)", (payload,))
    await db.commit()


@pytest.mark.asyncio
async def test_connect_sets_wal_bounding_pragmas(tmp_path):
    db = Database(str(tmp_path / "obs.db"))
    await db.connect()
    try:
        async with db.conn.execute("PRAGMA journal_mode") as cur:
            assert (await cur.fetchone())[0].lower() == "wal"
        async with db.conn.execute("PRAGMA journal_size_limit") as cur:
            assert (await cur.fetchone())[0] == 67108864
        async with db.conn.execute("PRAGMA wal_autocheckpoint") as cur:
            assert (await cur.fetchone())[0] == 1000
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_checkpoint_truncates_wal_file(tmp_path):
    db_path = tmp_path / "obs.db"
    db = Database(str(db_path))
    await db.connect()
    try:
        await _grow_wal(db)
        assert await _wal_size(db_path) > 0

        assert await db.checkpoint() is True
        # TRUNCATE checkpoint resets the WAL file back to (near) zero on disk.
        assert await _wal_size(db_path) == 0
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_checkpoint_noop_for_memory_db():
    db = Database(":memory:")
    await db.connect()
    try:
        assert await db.checkpoint() is False
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_scheduler_checkpoints_periodically(tmp_path):
    db_path = tmp_path / "obs.db"
    db = Database(str(db_path))
    await db.connect()
    scheduler = DatabaseMaintenanceScheduler(db, interval_seconds=0.05)
    try:
        await _grow_wal(db)
        assert await _wal_size(db_path) > 0

        scheduler.start()
        # Wait for at least one scheduled checkpoint to run.
        for _ in range(40):
            await asyncio.sleep(0.05)
            if await _wal_size(db_path) == 0:
                break
        assert await _wal_size(db_path) == 0
    finally:
        await scheduler.stop()
        await db.disconnect()


@pytest.mark.asyncio
async def test_scheduler_stop_is_idempotent_and_cancels_task(tmp_path):
    db = Database(str(tmp_path / "obs.db"))
    await db.connect()
    scheduler = DatabaseMaintenanceScheduler(db, interval_seconds=10)
    try:
        scheduler.start()
        await scheduler.stop()
        # Second stop must not raise even though the task is already gone.
        await scheduler.stop()
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_scheduler_survives_checkpoint_error(tmp_path):
    """A failing checkpoint is logged and does not kill the maintenance loop."""
    db = Database(str(tmp_path / "obs.db"))
    await db.connect()

    calls = {"n": 0}

    async def boom() -> bool:
        calls["n"] += 1
        raise RuntimeError("checkpoint exploded")

    db.checkpoint = boom  # type: ignore[method-assign]
    scheduler = DatabaseMaintenanceScheduler(db, interval_seconds=0.02)
    try:
        scheduler.start()
        for _ in range(40):
            await asyncio.sleep(0.02)
            if calls["n"] >= 2:
                break
        # Loop kept running past the first failure instead of dying.
        assert calls["n"] >= 2
    finally:
        await scheduler.stop()
        await db.disconnect()


@pytest.mark.asyncio
async def test_init_and_get_scheduler_singleton(tmp_path):
    db = Database(str(tmp_path / "obs.db"))
    await db.connect()
    scheduler = init_db_maintenance_scheduler(db, interval_seconds=10)
    try:
        assert get_db_maintenance_scheduler() is scheduler
    finally:
        await scheduler.stop()
        await db.disconnect()


def test_get_scheduler_before_init_raises(monkeypatch):
    import obs.db.maintenance as maintenance

    monkeypatch.setattr(maintenance, "_scheduler", None)
    with pytest.raises(RuntimeError):
        get_db_maintenance_scheduler()


@pytest.mark.asyncio
async def test_disconnect_swallows_checkpoint_error(tmp_path):
    """A checkpoint failure on shutdown must not prevent the connection from closing."""
    db = Database(str(tmp_path / "obs.db"))
    await db.connect()

    async def boom() -> bool:
        raise RuntimeError("checkpoint exploded")

    db.checkpoint = boom  # type: ignore[method-assign]
    # Must not raise despite the failing checkpoint.
    await db.disconnect()
    assert db._conn is None
