"""Telegram Bot API MESSAGE provider."""

from __future__ import annotations

from typing import Any

import httpx
from pydantic import BaseModel, Field

from obs.adapters.message.providers.base import MessageSendResult


class TelegramConfig(BaseModel):
    enabled: bool = False
    bot_token: str = Field(default="", json_schema_extra={"format": "password"})
    targets: dict[str, "TelegramTarget"] = Field(default_factory=dict)


class TelegramTarget(BaseModel):
    chat_id: str
    disable_notification: bool = False


class TelegramProvider:
    provider_type = "telegram"
    config_schema = TelegramConfig
    target_schema = TelegramTarget

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
        cfg = TelegramConfig(**provider_config)
        target = TelegramTarget(**target_config)
        text = f"{title}\n{message}" if title else message
        payload = {
            "chat_id": target.chat_id,
            "text": text,
            "disable_notification": target.disable_notification,
        }
        url = f"https://api.telegram.org/bot{cfg.bot_token}/sendMessage"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
        if response.status_code >= 400:
            return MessageSendResult("telegram", target_name, False, f"HTTP {response.status_code}")
        return MessageSendResult("telegram", target_name, True)
