from __future__ import annotations

from typing import Any


def redact_write_only_fields(config: dict[str, Any], schema_cls: Any) -> dict[str, Any]:
    """Return a config copy with writeOnly schema fields removed."""
    if not config:
        return {}

    redacted = dict(config)
    model_fields = getattr(schema_cls, "model_fields", {})
    for field_name, field_info in model_fields.items():
        extra = field_info.json_schema_extra or {}
        if extra.get("writeOnly"):
            redacted.pop(field_name, None)
    return redacted
