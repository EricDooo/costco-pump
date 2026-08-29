"""RQ job functions -- each call is one unit of work pulled off the queue.

Two job types, matching enqueuer.py's two schedules:
  - refresh_price_batch: the fast, hourly path. Prices only, for a batch of
    already-known warehouse IDs -- no locator call, no grid.
  - scrape_grid_point: the slow, daily path. Full metadata sweep that
    discovers new/closed warehouses and refreshes address/hours.

Each job runs its HTTP fetch and its DB write on two different event loops,
deliberately:
  - the curl_cffi fetch runs under a plain `asyncio.run()` -- a fresh loop,
    on the RQ job's own thread. Confirmed reliable every time it was tested
    this way (including manually inside the actual worker container against
    the actual coordinate that was hanging).
  - the DB write runs via worker.py's persistent background-thread loop
    (`run_coro`), which app.db's async engine needs (see worker.py).

Routing the curl_cffi call through that same persistent loop instead was
tried first and reproduced the "job starts, never completes, no error" hang
in production every time, even after the IPv4 fix -- but not when the exact
same fetch was run by hand inside the same container against the same
coordinate. That pointed at something about SimpleWorker's per-job
SIGALRM-based timeout interacting badly with curl_cffi's async I/O when
both share the background thread's loop, rather than the fetch itself.
Splitting the two loops sidesteps the interaction entirely rather than
chasing it further.
"""

import asyncio
import datetime as dt
import logging

from worker import run_coro

from ..db import SessionLocal
from .client import fetch_grid_point, fetch_prices
from .ingest import parse_warehouse, upsert_price_reading, upsert_warehouse_and_reading

logger = logging.getLogger(__name__)


def refresh_price_batch(ids: list[int], batch_time: str) -> int:
    """Price sweep job: fetch current prices for a batch of already-known
    warehouse IDs and record one reading each. No location/metadata touched
    -- see scraper/jobs.py's module docstring and ingest.upsert_price_reading."""
    prices = asyncio.run(fetch_prices([str(i) for i in ids]))
    return run_coro(_write_price_batch(ids, prices, dt.datetime.fromisoformat(batch_time)))


async def _write_price_batch(ids: list[int], prices: dict[str, dict], batch_time: dt.datetime) -> int:
    count = 0
    async with SessionLocal() as session:
        for warehouse_id in ids:
            price = prices.get(str(warehouse_id))
            if price is None:
                continue
            if await upsert_price_reading(session, warehouse_id, price, batch_time):
                count += 1
        await session.commit()
    return count


def scrape_grid_point(lat: float, lng: float, batch_time: str) -> int:
    """Metadata sweep job: fetch one grid point, upsert every warehouse it
    returned (price, location, and hours -- all come from the same
    normalized record, see scraper/client.py)."""
    raw_warehouses = asyncio.run(fetch_grid_point(lat, lng))
    return run_coro(_write_grid_point(raw_warehouses, dt.datetime.fromisoformat(batch_time)))


async def _write_grid_point(raw_warehouses: list[dict], batch_time: dt.datetime) -> int:
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
