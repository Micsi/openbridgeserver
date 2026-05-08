"""Unit tests for ringbuffer filterset DB migration (issue #389)."""

from __future__ import annotations

import pytest

from obs.db.database import Database


@pytest.mark.asyncio
async def test_db_migration_creates_ringbuffer_filterset_tables():
    db = Database(":memory:")
    await db.connect()
    try:
        tables = await db.fetchall("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ringbuffer_filterset%' ORDER BY name")
        names = [row["name"] for row in tables]
        assert "ringbuffer_filtersets" in names
        assert "ringbuffer_filterset_groups" in names
        assert "ringbuffer_filterset_rules" in names
    finally:
        await db.disconnect()
