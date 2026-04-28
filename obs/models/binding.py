"""AdapterBinding Pydantic model — Phase 1 / erweitert Phase 5 (Multi-Instance)."""

from __future__ import annotations

import datetime
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class AdapterBinding(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    datapoint_id: uuid.UUID
    adapter_type: str  # "KNX" | "MODBUS_TCP" | ...
    adapter_instance_id: uuid.UUID | None = None  # UUID der Adapter-Instanz
    direction: Literal["SOURCE", "DEST", "BOTH"]
    config: dict[str, Any] = Field(default_factory=dict)  # Validated by Adapter schema
    enabled: bool = True
    send_throttle_ms: int | None = None  # Min. Abstand zwischen zwei Sends (ms)
    send_on_change: bool = False  # Nur senden wenn Wert geändert hat
    send_min_delta: float | None = None  # Nur senden bei abs. Abweichung >= X
    send_min_delta_pct: float | None = None  # Nur senden bei rel. Abweichung >= X %
    value_formula: str | None = None  # Transformation: "x * 0.1", "x / 3600"
    value_map: dict[str, str] | None = None  # Wertzuordnung: z.B. {"0": "off", "1": "on"}
    created_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(datetime.UTC))
    updated_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(datetime.UTC))


class AdapterBindingCreate(BaseModel):
    adapter_instance_id: uuid.UUID  # Pflicht: referenziert eine Instanz
    adapter_type: str | None = None  # Optional: wird aus Instanz abgeleitet
    direction: Literal["SOURCE", "DEST", "BOTH"]
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    send_throttle_ms: int | None = None
    send_on_change: bool = False
    send_min_delta: float | None = None
    send_min_delta_pct: float | None = None
    value_formula: str | None = None
    value_map: dict[str, str] | None = None


class AdapterBindingUpdate(BaseModel):
    direction: Literal["SOURCE", "DEST", "BOTH"] | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None
    send_throttle_ms: int | None = None
    send_on_change: bool | None = None
    send_min_delta: float | None = None
    send_min_delta_pct: float | None = None
    value_formula: str | None = None
    value_map: dict[str, str] | None = None
