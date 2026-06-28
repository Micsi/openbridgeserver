"""seven.io SMS and Voice MESSAGE provider."""

from __future__ import annotations

from enum import Enum
from typing import Any

import httpx
from pydantic import BaseModel, Field

from obs.adapters.message.providers.base import MessageSendResult


class SevenIoChannel(str, Enum):
    SMS = "sms"
    VOICE = "voice"


class SevenIoConfig(BaseModel):
    enabled: bool = False
    api_key: str = Field(default="", json_schema_extra={"format": "password"})
    sender: str | None = None
    targets: dict[str, "SevenIoTarget"] = Field(default_factory=dict)


class SevenIoTarget(BaseModel):
    to: str
    channel: SevenIoChannel = SevenIoChannel.SMS
    sender: str | None = None


class SevenIoProvider:
    provider_type = "seven.io"
    config_schema = SevenIoConfig
    target_schema = SevenIoTarget

    async def send(
        self,
        *,
        provider_config: dict[str, Any],
        target_name: str,
        target_config: dict[str, Any],
        title: str | None,
        message: str,
        context: dict[str, Any],
    ) -> MessageSendResult:
        cfg = SevenIoConfig(**provider_config)
        target = SevenIoTarget(**target_config)
        text = f"{title}: {message}" if title else message
        payload: dict[str, Any] = {"to": target.to, "text": text}
        sender = target.sender or cfg.sender
        if sender:
            payload["from"] = sender
        endpoint = "voice" if target.channel == SevenIoChannel.VOICE else "sms"
        headers = {"X-Api-Key": cfg.api_key}
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(f"https://gateway.seven.io/api/{endpoint}", data=payload, headers=headers)
        if response.status_code >= 400:
            return MessageSendResult("seven.io", target_name, False, f"HTTP {response.status_code}")
        return MessageSendResult("seven.io", target_name, True)
