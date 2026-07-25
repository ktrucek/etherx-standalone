#!/usr/bin/env python3
"""Small stdout bridge for isaackogan/TikTokLive.

The Electron renderer owns the feed and deduplication. This process only turns
TikTokLive events into one JSON object per line, so it can be stopped cleanly
when the AI Live Chat toggle is switched off.
"""
import asyncio
import json
import signal
import sys
import time

from TikTokLive import TikTokLiveClient
from TikTokLive.events import (
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


def emit(payload):
    payload.setdefault("ts", int(time.time() * 1000))
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def user_fields(event):
    user = getattr(event, "user", None)
    handle = str(getattr(user, "unique_id", "") or "").lstrip("@")
    name = str(getattr(user, "nickname", "") or handle or "unknown")
    return {"user": name[:80], "userHandle": handle[:80]}


async def run(unique_id):
    client = TikTokLiveClient(unique_id=unique_id.lstrip("@"))
    stopping = asyncio.Event()

    @client.on(ConnectEvent)
    async def on_connect(event):
        emit({"kind": "status", "status": "connected", "uniqueId": unique_id})

    @client.on(DisconnectEvent)
    async def on_disconnect(event):
        emit({"kind": "status", "status": "disconnected", "uniqueId": unique_id})
        stopping.set()

    @client.on(CommentEvent)
    async def on_comment(event):
        emit({"kind": "event", "type": "chat", "text": str(getattr(event, "comment", "") or ""), **user_fields(event)})

    @client.on(GiftEvent)
    async def on_gift(event):
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
    async def on_like(event):
        count = max(1, int(getattr(event, "likes", 0) or getattr(event, "like_count", 0) or 1))
        emit({"kind": "event", "type": "like", "text": f"liked ×{count}", "quantity": count, **user_fields(event)})

    @client.on(JoinEvent)
    async def on_join(event):
        emit({"kind": "event", "type": "join", "text": "joined", **user_fields(event)})

    @client.on(FollowEvent)
    async def on_follow(event):
        emit({"kind": "event", "type": "subscriber", "text": "followed", **user_fields(event)})

    @client.on(SubNotifyEvent)
    async def on_sub(event):
        emit({"kind": "event", "type": "subscriber", "text": "subscribed", "giftName": "Subscriber", **user_fields(event)})

    @client.on(ShareEvent)
    async def on_share(event):
        emit({"kind": "event", "type": "share", "text": "shared the live", **user_fields(event)})

    try:
        await client.connect(fetch_gift_info=True)
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        emit({"kind": "error", "error": str(exc)[:500]})
        raise


def main():
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
