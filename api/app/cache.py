import json
from typing import Any

import redis.asyncio as redis

from .config import settings

_redis: redis.Redis = redis.from_url(settings.redis_url, decode_responses=True)


async def get_cached(key: str) -> Any | None:
    raw = await _redis.get(key)
    return json.loads(raw) if raw is not None else None


async def set_cached(key: str, value: Any, ttl_seconds: int) -> None:
    await _redis.set(key, json.dumps(value, default=str), ex=ttl_seconds)
