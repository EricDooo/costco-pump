"""RQ job functions -- each call is one unit of work pulled off the queue.

Two job types, matching enqueuer.py's two schedules:
  - refresh_price_batch: the fast, hourly path. Prices only, for a batch of
    warehouse IDs read from Costco's own site -- no locator call, no grid.
    Some IDs in a batch may not have a `warehouses` row yet (a brand new
    warehouse the metadata sweep hasn't reached), so this filters against
    the DB first rather than letting the FK reject them one at a time --
    see ingest.filter_known_warehouse_ids.
  - scrape_grid_point: the slow, daily path. Full metadata sweep that
    discovers new/closed warehouses and refreshes address/hours.

Each is a plain sync callable (SimpleWorker's contract) that does one
`asyncio.run()` covering both the curl_cffi fetch and the DB write. That's
simpler than it sounds only because of what it's NOT doing anymore: earlier
tonight this went through a persistent background-thread event loop
(worker.py's old run_coro), needed because app.db's async engine is
loop-bound -- but that machinery turned out to hang every job under RQ's
real SimpleWorker execution, confirmed repeatedly against the actual
worker container and queue. See worker.py's module docstring for the full
story. Fix was app/db.py switching to NullPool (fresh connection per
checkout, nothing pooled across event loops) instead, which is what makes
a single plain `asyncio.run()` per job -- fetch and write together -- safe
here.
"""

import asyncio
import datetime as dt
import logging

from ..db import SessionLocal
from .client import fetch_grid_point, fetch_prices
from .ingest import filter_known_warehouse_ids, parse_warehouse, upsert_price_reading, upsert_warehouse_and_reading

logger = logging.getLogger(__name__)


def refresh_price_batch(ids: list[int], batch_time: str) -> int:
    """Price sweep job: fetch current prices for a batch of warehouse IDs
    and record one reading each. No location/metadata touched -- see
    scraper/jobs.py's module docstring and ingest.upsert_price_reading."""
    return asyncio.run(_refresh_price_batch(ids, dt.datetime.fromisoformat(batch_time)))


async def _refresh_price_batch(ids: list[int], batch_time: dt.datetime) -> int:
    prices = await fetch_prices([str(i) for i in ids])

    count = 0
    async with SessionLocal() as session:
        known_ids = await filter_known_warehouse_ids(session, ids)
        skipped = len(ids) - len(known_ids)
        if skipped:
            logger.info("%d of %d IDs have no warehouses row yet -- skipping until the next metadata sweep", skipped, len(ids))
        for warehouse_id in known_ids:
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
