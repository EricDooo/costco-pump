"""RQ job functions -- each call is one unit of work pulled off the queue.

The RQ job is a plain sync callable; it wraps a small async operation with
`asyncio.run` so the rest of the app can stay on the async httpx/SQLAlchemy
stack without pulling in an async-aware queue framework for a handful of
jobs per hour.
"""

import asyncio
import datetime as dt
import logging

import httpx

from ..db import SessionLocal
from .client import BASE_URL, HEADERS, fetch_point
from .ingest import parse_warehouse, upsert_warehouse_and_reading

logger = logging.getLogger(__name__)


def scrape_grid_point(lat: float, lng: float, batch_time: str) -> int:
    """Sweep job: fetch one grid point, upsert every warehouse it returned
    (price, location, and hours -- all come from the same response)."""
    return asyncio.run(_scrape_grid_point(lat, lng, dt.datetime.fromisoformat(batch_time)))


async def _scrape_grid_point(lat: float, lng: float, batch_time: dt.datetime) -> int:
    async with httpx.AsyncClient(base_url=BASE_URL, headers=HEADERS, timeout=30) as client:
        raw_warehouses = await fetch_point(client, lat, lng)

    count = 0
    async with SessionLocal() as session:
        for raw in raw_warehouses:
            row = parse_warehouse(raw)
            if row is None:
                continue
            await upsert_warehouse_and_reading(session, row, batch_time)
            count += 1
        await session.commit()
    return count
