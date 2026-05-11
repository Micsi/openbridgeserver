"""Unit tests for ringbuffer filterset DB migration (#431).

V29 was overwritten in-place when the flat filterset schema landed — the
legacy ``ringbuffer_filterset_groups`` and ``ringbuffer_filterset_rules``
tables no longer exist and the single remaining ``ringbuffer_filtersets``
table carries the new columns (``color``, ``topbar_active``, ``topbar_order``,
``filter_json``). See #431 for the rationale; the previous nested layout
never reached upstream main so a destructive DROP+CREATE is safe.
"""

from __future__ import annotations

import pytest

from obs.db.database import Database


@pytest.mark.asyncio
async def test_db_migration_creates_flat_ringbuffer_filterset_table():
    db = Database(":memory:")
    await db.connect()
    try:
        tables = await db.fetchall(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ringbuffer_filterset%' ORDER BY name"
        )
        names = [row["name"] for row in tables]
        assert names == ["ringbuffer_filtersets"], (
            "legacy ringbuffer_filterset_groups/_rules tables must be dropped by V29"
        )

        columns = await db.fetchall("PRAGMA table_info(ringbuffer_filtersets)")
        column_names = {row["name"] for row in columns}
        # New columns introduced by #431.
        assert {"color", "topbar_active", "topbar_order", "filter_json"} <= column_names
        # Existing columns preserved.
        assert {"id", "name", "description", "dsl_version", "is_active", "is_default"} <= column_names
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_db_migration_creates_topbar_indexes():
    db = Database(":memory:")
    await db.connect()
    try:
        indexes = await db.fetchall("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ringbuffer_filtersets'")
        names = {row["name"] for row in indexes}
        assert "idx_rb_fs_topbar_active" in names
        assert "idx_rb_fs_topbar_order" in names
    finally:
        await db.disconnect()
