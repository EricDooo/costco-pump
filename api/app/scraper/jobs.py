"""RQ job functions -- each call is one unit of work pulled off the queue.

Three job types, matching enqueuer.py's three schedules:
  - refresh_price_batch: the fast, hourly path. US/CA/UK prices only, for a
    batch of warehouse IDs read off warehouses.json -- no locator call, no
    grid. Some IDs in a batch may not have a `warehouses` row yet (a brand
    new warehouse the metadata sweep hasn't reached), so this filters
    against the DB first rather than letting the FK reject them one at a
    time -- see ingest.filter_known_warehouse_ids.
  - refresh_metadata: the slow-ish path for US/CA/UK. One call to
    warehouses.json (no grid, no pagination -- see scraper/client.py's
    module docstring), upserting every warehouse's location/hours. Doesn't
    touch price_readings -- see ingest.upsert_warehouse_metadata for why
    combining metadata and price writes here would be actively wrong now
    that they're two separate calls.
  - refresh_international_country: one country's full metadata+price
    refresh via the SAP Commerce Cloud API (scraper/international.py) --
    unlike the US/CA/UK split above, this DOES combine metadata and price
    in one upsert, because the SAP API itself returns both together in one
    call, so there's no stale-null-price risk the way there is for the
    warehouses.json path.
  - refresh_benchmarks: national/PADD-region average gas prices + WTI crude
    spot, from EIA's public API (scraper/eia.py) -- unrelated to Costco
    entirely, just written alongside everything else this queue already
    does. Runs once a day; see config.settings.benchmark_refresh_interval_seconds.

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

from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..db import SessionLocal
from ..models import CrudeBenchmark, RegionalBenchmark
from . import international
from .client import fetch_all_warehouses, fetch_prices
from .eia import fetch_benchmarks
from .ingest import (
    filter_known_warehouse_ids,
    parse_warehouse,
    upsert_price_reading,
    upsert_warehouse_and_reading,
    upsert_warehouse_metadata,
)

logger = logging.getLogger(__name__)


def refresh_price_batch(ids: list[int], batch_time: str) -> int:
    """Price sweep job: fetch current prices for a batch of US/CA/UK
    warehouse IDs and record one reading each. No location/metadata
    touched -- see scraper/jobs.py's module docstring and
    ingest.upsert_price_reading."""
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


def refresh_metadata(batch_time: str) -> int:
    """US/CA/UK metadata sweep job: one call to warehouses.json, upsert
    every gas warehouse's location/hours. See module docstring for why
    this deliberately doesn't write price_readings."""
    return asyncio.run(_refresh_metadata(dt.datetime.fromisoformat(batch_time)))


async def _refresh_metadata(batch_time: dt.datetime) -> int:
    raw_warehouses = await fetch_all_warehouses()

    count = 0
    async with SessionLocal() as session:
        for raw in raw_warehouses:
            row = parse_warehouse(raw)
            if row is None:
                continue
            await upsert_warehouse_metadata(session, row, batch_time)
            count += 1
        await session.commit()
    return count


def refresh_international_country(country: str, domain: str, offset: int, batch_time: str) -> int:
    """International sweep job: one country's full metadata+price refresh
    via the SAP Commerce Cloud API (scraper/international.py). Unlike the
    US/CA/UK jobs above, this writes both metadata and a price reading in
    one upsert -- see module docstring."""
    return asyncio.run(_refresh_international_country(country, domain, offset, dt.datetime.fromisoformat(batch_time)))


async def _refresh_international_country(country: str, domain: str, offset: int, batch_time: dt.datetime) -> int:
    raw_warehouses = await international.fetch_country(country, domain, offset)

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


def refresh_benchmarks(batch_time: str) -> int:
    """Regional-benchmark job: national/PADD-region average gas prices + WTI
    crude spot from EIA's public API (scraper/eia.py). Entirely independent
    of Costco -- just another row written on the same queue/worker
    machinery as everything else here."""
    return asyncio.run(_refresh_benchmarks(dt.datetime.fromisoformat(batch_time)))


async def _refresh_benchmarks(batch_time: dt.datetime) -> int:
    gasoline, wti = await fetch_benchmarks()

    count = 0
    async with SessionLocal() as session:
        for region_code, price in gasoline.items():
            stmt = (
                pg_insert(RegionalBenchmark)
                .values(time=batch_time, region_code=region_code, avg_regular_price=price)
                .on_conflict_do_update(
                    index_elements=[RegionalBenchmark.time, RegionalBenchmark.region_code],
                    set_={"avg_regular_price": price},
                )
            )
            await session.execute(stmt)
            count += 1

        if wti is not None:
            stmt = (
                pg_insert(CrudeBenchmark)
                .values(time=batch_time, wti_spot_price=wti)
                .on_conflict_do_update(
                    index_elements=[CrudeBenchmark.time],
                    set_={"wti_spot_price": wti},
                )
            )
            await session.execute(stmt)
            count += 1

        await session.commit()
    return count
