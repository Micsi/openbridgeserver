"""RingBuffer Debug Log — Phase 5

Zeichnet jede Werteänderung auf. Speicher umschaltbar zur Laufzeit:
  memory  — SQLite :memory: (verschwindet bei Neustart)
  disk    — SQLite WAL-Mode (überlebt Neustarts)

Filterfunktionen:
  q       — Substring in datapoint_id oder source_adapter
  adapter — exakt source_adapter
  from_ts — ISO-8601 Timestamp (exkl.)
  limit   — max. Einträge (default: 100)

Überschreibt älteste Einträge wenn max_entries erreicht.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import aiosqlite

logger = logging.getLogger(__name__)
_UNSET = object()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ringbuffer (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT    NOT NULL,
    datapoint_id   TEXT    NOT NULL,
    topic          TEXT    NOT NULL,
    old_value      TEXT,
    new_value      TEXT,
    source_adapter TEXT    NOT NULL,
    quality        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rb_ts  ON ringbuffer(ts);
CREATE INDEX IF NOT EXISTS idx_rb_dp  ON ringbuffer(datapoint_id);
CREATE INDEX IF NOT EXISTS idx_rb_adp ON ringbuffer(source_adapter);
"""


@dataclass
class RingBufferEntry:
    id: int
    ts: str
    datapoint_id: str
    topic: str
    old_value: Any
    new_value: Any
    source_adapter: str
    quality: str


class RingBuffer:
    """Async RingBuffer backed by SQLite.

    Lifecycle:
        rb = RingBuffer("memory", max_entries=10000)
        await rb.start()
        bus.subscribe(DataValueEvent, rb.handle_value_event)
        ...
        await rb.stop()
    """

    def __init__(
        self,
        storage: str = "memory",
        max_entries: int = 10000,
        disk_path: str = "/data/obs_ringbuffer.db",
        max_file_size_bytes: int | None = None,
        max_age: int | None = None,
    ) -> None:
        self._storage = storage
        self._max_entries = max_entries
        self._disk_path = disk_path
        self._max_file_size_bytes = max_file_size_bytes
        self._max_age = max_age
        self._conn: aiosqlite.Connection | None = None
        self._last_values: dict[str, Any] = {}  # dp_id → last recorded value
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        path = ":memory:" if self._storage == "memory" else self._disk_path
        self._conn = await aiosqlite.connect(path)
        self._conn.row_factory = aiosqlite.Row
        if self._storage == "disk":
            await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()
        logger.info(
            "RingBuffer started (%s, max_entries=%d, max_file_size_bytes=%s, max_age=%s)",
            self._storage,
            self._max_entries,
            self._max_file_size_bytes,
            self._max_age,
        )

    async def stop(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------
    # Runtime config switch (memory ↔ disk)
    # ------------------------------------------------------------------

    async def reconfigure(
        self,
        storage: str,
        max_entries: int,
        max_file_size_bytes: int | None | object = _UNSET,
        max_age: int | None | object = _UNSET,
    ) -> None:
        """Switch storage mode at runtime. Copies existing entries."""
        async with self._lock:
            resolved_max_file_size = self._max_file_size_bytes if max_file_size_bytes is _UNSET else max_file_size_bytes
            resolved_max_age = self._max_age if max_age is _UNSET else max_age

            if (
                storage == self._storage
                and max_entries == self._max_entries
                and resolved_max_file_size == self._max_file_size_bytes
                and resolved_max_age == self._max_age
            ):
                return

            # Same storage backend: apply config in-place and trim, no data migration.
            if storage == self._storage:
                self._max_entries = max_entries
                self._max_file_size_bytes = int(resolved_max_file_size) if resolved_max_file_size is not None else None
                self._max_age = int(resolved_max_age) if resolved_max_age is not None else None
                await self._trim()
                logger.info(
                    "RingBuffer reconfigured in-place → %s, max_entries=%d, max_file_size_bytes=%s, max_age=%s",
                    storage,
                    self._max_entries,
                    self._max_file_size_bytes,
                    self._max_age,
                )
                return

            # Export current entries
            rows = await self._fetchall("SELECT * FROM ringbuffer ORDER BY id")
            existing: list[dict] = [dict(r) for r in rows]

            # Close old connection
            if self._conn:
                await self._conn.close()

            self._storage = storage
            self._max_entries = max_entries
            self._max_file_size_bytes = int(resolved_max_file_size) if resolved_max_file_size is not None else None
            self._max_age = int(resolved_max_age) if resolved_max_age is not None else None

            # Open new connection
            path = ":memory:" if storage == "memory" else self._disk_path
            self._conn = await aiosqlite.connect(path)
            self._conn.row_factory = aiosqlite.Row
            if storage == "disk":
                await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.executescript(_SCHEMA)
            await self._conn.commit()

            # Re-import (keep only the newest max_entries)
            to_import = existing[-max_entries:]
            for row in to_import:
                await self._conn.execute(
                    """INSERT INTO ringbuffer
                       (ts, datapoint_id, topic, old_value, new_value, source_adapter, quality)
                       VALUES (?,?,?,?,?,?,?)""",
                    (
                        row["ts"],
                        row["datapoint_id"],
                        row["topic"],
                        row["old_value"],
                        row["new_value"],
                        row["source_adapter"],
                        row["quality"],
                    ),
                )
            await self._conn.commit()
            logger.info(
                "RingBuffer reconfigured → %s, max_entries=%d, max_file_size_bytes=%s, max_age=%s (%d entries kept)",
                storage,
                max_entries,
                self._max_file_size_bytes,
                self._max_age,
                len(to_import),
            )
            await self._trim()

    # ------------------------------------------------------------------
    # Record
    # ------------------------------------------------------------------

    async def record(
        self,
        ts: str,
        datapoint_id: str,
        topic: str,
        old_value: Any,
        new_value: Any,
        source_adapter: str,
        quality: str,
    ) -> None:
        if not self._conn:
            return
        async with self._lock:
            await self._conn.execute(
                """INSERT INTO ringbuffer
                   (ts, datapoint_id, topic, old_value, new_value, source_adapter, quality)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    ts,
                    datapoint_id,
                    topic,
                    json.dumps(old_value),
                    json.dumps(new_value),
                    source_adapter,
                    quality,
                ),
            )
            await self._conn.commit()
            await self._trim(reference_ts=ts)

    async def _trim(self, reference_ts: str | None = None) -> None:
        """Apply retention rules and keep max_entries compatibility."""
        if not self._conn:
            return

        while True:
            # Retention rule 1: disk size hard limit (oldest-first)
            if self._max_file_size_bytes is not None:
                current_size = await self._current_storage_bytes()
                if current_size > self._max_file_size_bytes:
                    removed = await self._delete_oldest(limit=1)
                    if removed == 0:
                        logger.warning(
                            "RingBuffer size trim blocked: size=%d limit=%d",
                            current_size,
                            self._max_file_size_bytes,
                        )
                        break
                    new_size = await self._current_storage_bytes()
                    await self._log_trim_event(
                        reason="size",
                        removed=removed,
                        before_value=current_size,
                        after_value=new_size,
                    )
                    continue

            # Retention rule 2: max age in seconds (strictly older than cutoff)
            removed_by_age = await self._trim_by_age(reference_ts=reference_ts)
            if removed_by_age > 0:
                continue

            # Legacy behavior from #383: count-based trim stays in place.
            removed_by_count = await self._trim_by_count()
            if removed_by_count > 0:
                continue
            break

    async def _trim_by_count(self) -> int:
        if not self._conn:
            return 0
        async with self._conn.execute("SELECT COUNT(*) FROM ringbuffer") as cur:
            row = await cur.fetchone()
        count = row[0] if row else 0
        if count <= self._max_entries:
            return 0

        excess = count - self._max_entries
        removed = await self._delete_oldest(limit=excess)
        if removed:
            await self._log_trim_event(
                reason="count",
                removed=removed,
                before_value=count,
                after_value=count - removed,
            )
        return removed

    async def _trim_by_age(self, reference_ts: str | None) -> int:
        if not self._conn or self._max_age is None:
            return 0

        ref_ts = reference_ts
        if not ref_ts:
            async with self._conn.execute("SELECT MAX(ts) FROM ringbuffer") as cur:
                row = await cur.fetchone()
            ref_ts = row[0] if row else None
        if not ref_ts:
            return 0

        cutoff_dt = _parse_iso_ts(ref_ts) - timedelta(seconds=self._max_age)
        cutoff = _isoformat_utc(cutoff_dt)
        async with self._conn.execute("SELECT COUNT(*) FROM ringbuffer WHERE ts < ?", (cutoff,)) as cur:
            row = await cur.fetchone()
        remove_count = row[0] if row else 0
        if remove_count <= 0:
            return 0

        await self._conn.execute("DELETE FROM ringbuffer WHERE ts < ?", (cutoff,))
        await self._conn.commit()
        await self._log_trim_event(
            reason="age",
            removed=remove_count,
            before_value=ref_ts,
            after_value=cutoff,
        )
        return remove_count

    async def _delete_oldest(self, limit: int) -> int:
        if not self._conn or limit <= 0:
            return 0

        async with self._conn.execute(
            "SELECT id FROM ringbuffer ORDER BY id ASC LIMIT ?",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
        if not rows:
            return 0

        ids = [row[0] for row in rows]
        placeholders = ",".join("?" for _ in ids)
        await self._conn.execute(
            f"DELETE FROM ringbuffer WHERE id IN ({placeholders})",
            ids,
        )
        await self._conn.commit()
        if self._storage == "disk":
            await self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return len(ids)

    async def _current_storage_bytes(self) -> int:
        if not self._conn or self._storage != "disk":
            return 0

        async with self._conn.execute("PRAGMA page_size") as cur:
            page_size_row = await cur.fetchone()
        async with self._conn.execute("PRAGMA page_count") as cur:
            page_count_row = await cur.fetchone()
        async with self._conn.execute("PRAGMA freelist_count") as cur:
            freelist_row = await cur.fetchone()

        page_size = page_size_row[0] if page_size_row else 0
        page_count = page_count_row[0] if page_count_row else 0
        freelist_count = freelist_row[0] if freelist_row else 0
        used_bytes = max(page_count - freelist_count, 0) * page_size

        wal_bytes = 0
        wal_path = f"{self._disk_path}-wal"
        if os.path.exists(wal_path):
            wal_bytes = os.path.getsize(wal_path)
        return used_bytes + wal_bytes

    async def _log_trim_event(
        self,
        reason: str,
        removed: int,
        before_value: Any,
        after_value: Any,
    ) -> None:
        total = await self._count_entries()
        logger.info(
            "RingBuffer trim reason=%s removed=%d total=%d before=%s after=%s",
            reason,
            removed,
            total,
            before_value,
            after_value,
        )

    async def _count_entries(self) -> int:
        if not self._conn:
            return 0
        async with self._conn.execute("SELECT COUNT(*) FROM ringbuffer") as cur:
            row = await cur.fetchone()
        return row[0] if row else 0

    # ------------------------------------------------------------------
    # EventBus handler
    # ------------------------------------------------------------------

    async def handle_value_event(self, event: Any) -> None:
        """Record a DataValueEvent into the ring buffer."""
        dp_id = str(event.datapoint_id)

        # Capture old value from our own tracking (reliable in asyncio)
        old_value = self._last_values.get(dp_id)
        self._last_values[dp_id] = event.value

        try:
            from obs.core.registry import get_registry

            dp = get_registry().get(event.datapoint_id)
            topic = dp.mqtt_topic if dp else f"dp/{dp_id}/value"
        except RuntimeError:
            topic = f"dp/{dp_id}/value"

        await self.record(
            ts=event.ts.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            datapoint_id=dp_id,
            topic=topic,
            old_value=old_value,
            new_value=event.value,
            source_adapter=event.source_adapter,
            quality=event.quality,
        )

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    async def query(
        self,
        q: str = "",
        adapter: str = "",
        from_ts: str = "",
        limit: int = 100,
        dp_ids: list[str] | None = None,
    ) -> list[RingBufferEntry]:
        if not self._conn:
            return []

        sql = "SELECT * FROM ringbuffer WHERE 1=1"
        params: list[Any] = []

        if q or dp_ids:
            parts: list[str] = []
            if q:
                parts += ["datapoint_id LIKE ?", "source_adapter LIKE ?"]
                params += [f"%{q}%", f"%{q}%"]
            if dp_ids:
                placeholders = ",".join("?" * len(dp_ids))
                parts.append(f"datapoint_id IN ({placeholders})")
                params += dp_ids
            sql += f" AND ({' OR '.join(parts)})"
        if adapter:
            sql += " AND source_adapter=?"
            params.append(adapter)
        if from_ts:
            sql += " AND ts > ?"
            params.append(from_ts)

        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        rows = await self._fetchall(sql, params)
        return [
            RingBufferEntry(
                id=r["id"],
                ts=r["ts"],
                datapoint_id=r["datapoint_id"],
                topic=r["topic"],
                old_value=_safe_loads(r["old_value"]),
                new_value=_safe_loads(r["new_value"]),
                source_adapter=r["source_adapter"],
                quality=r["quality"],
            )
            for r in rows
        ]

    async def stats(self) -> dict:
        if not self._conn:
            return {
                "total": 0,
                "oldest_ts": None,
                "newest_ts": None,
                "storage": self._storage,
                "max_entries": self._max_entries,
            }
        async with self._conn.execute("SELECT COUNT(*) AS c, MIN(ts) AS oldest, MAX(ts) AS newest FROM ringbuffer") as cur:
            row = await cur.fetchone()
        return {
            "total": row[0] if row else 0,
            "oldest_ts": row[1] if row else None,
            "newest_ts": row[2] if row else None,
            "storage": self._storage,
            "max_entries": self._max_entries,
            "max_file_size_bytes": self._max_file_size_bytes,
            "max_age": self._max_age,
            "file_size_bytes": await self._current_storage_bytes(),
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _fetchall(self, sql: str, params: list = []) -> list:
        async with self._conn.execute(sql, params) as cur:
            return await cur.fetchall()


def _safe_loads(s: str | None) -> Any:
    if s is None:
        return None
    try:
        return json.loads(s)
    except Exception:
        return s


def _parse_iso_ts(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value).astimezone(UTC)


def _isoformat_utc(value: datetime) -> str:
    value = value.astimezone(UTC)
    return value.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ---------------------------------------------------------------------------
# Application singleton
# ---------------------------------------------------------------------------

_rb: RingBuffer | None = None


def get_ringbuffer() -> RingBuffer:
    if _rb is None:
        raise RuntimeError("RingBuffer not initialized")
    return _rb


def reset_ringbuffer() -> None:
    """Reset the RingBuffer singleton. For testing only."""
    global _rb
    _rb = None


async def init_ringbuffer(
    storage: str,
    max_entries: int,
    disk_path: str,
    max_file_size_bytes: int | None = None,
    max_age: int | None = None,
) -> RingBuffer:
    global _rb
    _rb = RingBuffer(storage, max_entries, disk_path, max_file_size_bytes, max_age)
    await _rb.start()
    return _rb
