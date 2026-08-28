"""Per-IP rate limiting for the public API (slowapi, backed by Redis so
limits hold across restarts and would stay correct if `api` is ever scaled
to more than one replica).

Caddy is the only thing that ever connects to this container directly, so
`request.client.host` is always Caddy's container IP, not the real visitor --
the key function reads X-Forwarded-For (which Caddy's reverse_proxy sets by
default) instead, falling back to the connection IP for local/dev use where
there's no proxy in front at all.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from .config import settings


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=_client_ip,
    storage_uri=settings.redis_url,
    # Backstop for any endpoint added later without its own @limiter.limit --
    # each router applies a tighter, endpoint-specific limit on top of this.
    default_limits=["120/minute"],
)
