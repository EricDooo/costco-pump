"""RQ job functions -- each call is one unit of work pulled off the queue.

The RQ job is a plain sync callable; it just runs the coroutine in a fresh
event loop per call. That used to go through worker.py's persistent
background loop instead, because a Playwright/Patchright browser is tied to
the event loop that created it and needed to be reused across jobs -- now
that scraper/client.py is a plain per-call HTTP fetch with nothing to keep
warm, that machinery is gone and this is back to the simple default.
"""

import asyncio
import datetime as dt
import logging

from ..db import SessionLocal
from .client import fetch_grid_point
from .ingest import parse_warehouse, upsert_warehouse_and_reading

logger = logging.getLogger(__name__)


def scrape_grid_point(lat: float, lng: float, batch_time: str) -> int:
    """Sweep job: fetch one grid point, upsert every warehouse it returned
    (price, location, and hours -- all come from the same normalized record,
    see scraper/client.py)."""
    return asyncio.run(_scrape_grid_point(lat, lng, dt.datetime.fromisoformat(batch_time)))


async def _scrape_grid_point(lat: float, lng: float, batch_time: dt.datetime) -> int:
    raw_warehouses = await fetch_grid_point(lat, lng)

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
