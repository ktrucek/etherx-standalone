#!/usr/bin/env python3
# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportUnknownMemberType=false, reportMissingParameterType=false
"""Small stdout bridge for isaackogan/TikTokLive.

The Electron renderer owns the feed and deduplication. This process only turns
TikTokLive events into one JSON object per line, so it can be stopped cleanly
when the AI Live Chat toggle is switched off.
"""
import asyncio
import json
import re
import sys
import time
import traceback
from typing import Any, cast

from TikTokLive import TikTokLiveClient as _TikTokLiveClient  # pyright: ignore[reportMissingImports]
from TikTokLive.events import (  # pyright: ignore[reportMissingImports]
    CommentEvent,
    ConnectEvent,
    DisconnectEvent,
    FollowEvent,
    GiftEvent,
    JoinEvent,
    LikeEvent,
    ShareEvent,
    SubNotifyEvent,
)

TikTokLiveClient = cast(Any, _TikTokLiveClient)


def emit(payload: dict[str, Any]) -> None:
    payload.setdefault("ts", int(time.time() * 1000))
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def clean_user_text(value: Any) -> str:
    return str(value or "").replace("\r", " ").replace("\n", " ").strip()


def explicit_user_level(user: Any) -> int:
    """Return only a level explicitly present in TikTok's user/badge payload."""
    if user is None:
        return 0

    candidates = [
        getattr(getattr(user, "pay_grade", None), "level", 0),
        getattr(getattr(user, "payGrade", None), "level", 0),
        getattr(user, "user_level", 0),
        getattr(user, "userLevel", 0),
    ]
    for candidate in candidates:
        try:
            level = int(candidate or 0)
        except (TypeError, ValueError):
            continue
        if 0 < level < 500:
            return level

    badge_list = getattr(user, "badge_list", None) or getattr(user, "badgeList", None) or []
    for badge in badge_list:
        badge_sources = [
            getattr(badge, "name", ""),
            getattr(badge, "text", ""),
            getattr(badge, "display_name", ""),
            getattr(badge, "badge_display_type", ""),
        ]
        for source in badge_sources:
            match = re.search(r"\b(?:lv|lvl|level)\.?\s*[:#-]?\s*(\d{1,3})\b", clean_user_text(source), re.IGNORECASE)
            level = int(match.group(1)) if match else 0
            if 0 < level < 500:
                return level
    return 0


def user_fields(event: Any) -> dict[str, Any]:
    user = getattr(event, "user", None)
    handle = clean_user_text(getattr(user, "unique_id", "")).lstrip("@")
    display_name = clean_user_text(getattr(user, "nickname", "")).lstrip("@")
    if display_name and handle and display_name.casefold() == handle.casefold():
        display_name = handle
    # Downstream UI and summaries primarily read `user`, so keep it as the
    # stable TikTok handle and expose the nickname separately.
    name = handle or display_name or "unknown"
    fields: dict[str, Any] = {
        "user": name[:80],
        "displayName": (display_name or handle or "unknown")[:80],
        "userHandle": handle[:80],
        "profileHandle": handle[:80],
    }
    level = explicit_user_level(user)
    if level:
        fields["userLevel"] = level
        fields["joinLevel"] = level
    return fields


async def run(unique_id: str) -> None:
    client = TikTokLiveClient(unique_id=unique_id.lstrip("@"))
    stopping = asyncio.Event()

    @client.on(ConnectEvent)
    async def on_connect(event: Any) -> None:
        emit({"kind": "status", "status": "connected", "uniqueId": unique_id})

    @client.on(DisconnectEvent)
    async def on_disconnect(event: Any) -> None:
        emit({"kind": "status", "status": "disconnected", "uniqueId": unique_id})
        stopping.set()

    @client.on(CommentEvent)
    async def on_comment(event: Any) -> None:
        emit({"kind": "event", "type": "chat", "text": str(getattr(event, "comment", "") or ""), **user_fields(event)})

    @client.on(GiftEvent)
    async def on_gift(event: Any) -> None:
        gift = getattr(event, "gift", None)
        gift_name = str(getattr(gift, "name", "") or "Gift")
        quantity = max(1, int(getattr(event, "repeat_count", 1) or 1))
        unit_coins = max(0, int(getattr(gift, "diamond_count", 0) or getattr(gift, "coin_count", 0) or 0))
        # Streakable gifts are emitted for every step; only forward the final
        # step, matching the existing DOM scanner's gift semantics.
        if bool(getattr(event, "streaking", False)):
            return
        emit({"kind": "event", "type": "gift", "text": gift_name, "giftName": gift_name,
              "quantity": quantity, "unitCoins": unit_coins, "coins": quantity * unit_coins,
              **user_fields(event)})

    @client.on(LikeEvent)
    async def on_like(event: Any) -> None:
        count = max(1, int(getattr(event, "likes", 0) or getattr(event, "like_count", 0) or 1))
        emit({"kind": "event", "type": "like", "text": f"liked ×{count}", "quantity": count, **user_fields(event)})

    @client.on(JoinEvent)
    async def on_join(event: Any) -> None:
        emit({"kind": "event", "type": "join", "text": "joined", **user_fields(event)})

    @client.on(FollowEvent)
    async def on_follow(event: Any) -> None:
        emit({"kind": "event", "type": "subscriber", "text": "followed", **user_fields(event)})

    @client.on(SubNotifyEvent)
    async def on_sub(event: Any) -> None:
        emit({"kind": "event", "type": "subscriber", "text": "subscribed", "giftName": "Subscriber", **user_fields(event)})

    @client.on(ShareEvent)
    async def on_share(event: Any) -> None:
        emit({"kind": "event", "type": "share", "text": "shared the live", **user_fields(event)})

    try:
        # Gift metadata is optional. Some TikTok regions return an empty gift
        # catalog, which currently makes TikTokLive fail the whole connection
        # with a NoneType/TypeError before chat events can start. Gift events
        # still contain their own name, quantity and coin fields when TikTok
        # provides them, so do not make the catalog a startup dependency.
        await client.connect(fetch_gift_info=False)
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        error_type = type(exc).__name__
        error_text = str(exc).strip()
        trace_tail = traceback.format_exc(limit=4).strip().splitlines()[-8:]
        emit({
            "kind": "error",
            "phase": "connect",
            "errorType": error_type,
            "error": f"{error_type}: {error_text or 'bez dodatnog opisa'}"[:1000],
            "trace": "\n".join(trace_tail)[-2000:],
        })
        raise


def main() -> int:
    if len(sys.argv) < 2 or not str(sys.argv[1]).strip():
        print("unique_id is required", file=sys.stderr)
        return 2
    try:
        asyncio.run(run(str(sys.argv[1]).strip()))
    except KeyboardInterrupt:
        return 0
    except Exception:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
