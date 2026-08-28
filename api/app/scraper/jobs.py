"""RQ job functions -- each call is one unit of work pulled off the queue.

The RQ job is a plain sync callable (SimpleWorker's contract); it submits a
coroutine to worker.py's persistent event loop and blocks for the result,
rather than `asyncio.run()`-ing a fresh loop per call -- see worker.py for
why that persistence matters here (app.db's async engine, not the
scraper -- scraper/client.py's curl_cffi calls are loop-agnostic).
"""

import datetime as dt
import logging

from worker import run_coro

from ..db import SessionLocal
from .client import fetch_grid_point
from .ingest import parse_warehouse, upsert_warehouse_and_reading

logger = logging.getLogger(__name__)


def scrape_grid_point(lat: float, lng: float, batch_time: str) -> int:
    """Sweep job: fetch one grid point, upsert every warehouse it returned
    (price, location, and hours -- all come from the same normalized record,
    see scraper/client.py)."""
    return run_coro(_scrape_grid_point(lat, lng, dt.datetime.fromisoformat(batch_time)))


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
