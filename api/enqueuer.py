"""Scheduling loop -- the `enqueuer` service's entrypoint.

Three independent schedules, run concurrently:
  - price sweep (hourly, `sweep_interval_seconds`): US/CA/UK prices only,
    for every warehouse ID warehouses.json lists (scraper/client.py's
    fetch_all_warehouses -- one call, no grid, cheap enough to just call
    fresh every round instead of caching the ID list the way this used to).
    ~797 warehouses / 10 per batch (the price endpoint's own silent
    per-call cap, see client.py's PRICE_BATCH_SIZE) is ~80 jobs.
  - metadata sweep (`metadata_sweep_interval_seconds`): also warehouses.json
    -- one call returns the whole US/CA/UK database with lastPage:true, so
    this is a single job, not a grid of ~184 points anymore. Discovers
    new/closed warehouses and refreshes address/hours; doesn't touch prices
    (see scraper/jobs.py's refresh_metadata for why).
  - international sweep (`international_sweep_interval_seconds`): one job
    per country in scraper/international.py's COUNTRIES, each a full
    metadata+price refresh via that country's SAP Commerce Cloud API in one
    call.

The price sweep still trickles its batch jobs across most of its interval
(see SPREAD_FRACTION) -- with scraper/client.py's curl_cffi calls being
near-instant, enqueuing all ~80 batch jobs at once and letting SimpleWorker
drain them back-to-back reproduced the exact silent-drop hangs seen
elsewhere in this project when request volume spikes. Metadata and
international sweeps don't need pacing: each country/the whole US/CA/UK
database is one job, so there's nothing to spread out.

This process only enqueues; `worker.py` is what actually does the work.
Separating them is the point of using a queue at all -- a slow or failed
job never blocks the schedule, and scraping throughput can be scaled by
running more `worker` replicas without touching this file.
"""

import asyncio
import datetime as dt
import logging

from app.config import settings
from app.db import init_models
from app.queue import sweep_queue
from app.scraper.client import fetch_all_warehouses
from app.scraper.international import COUNTRIES

logger = logging.getLogger(__name__)

# Fraction of the interval spent trickling jobs in -- not the full interval,
# so a round that starts slightly late (or a slow job along the way) still
# leaves headroom before the next one begins.
SPREAD_FRACTION = 0.9

# Matches scraper/client.py's PRICE_BATCH_SIZE -- the endpoint silently
# caps its response at 10 prices no matter how many IDs are requested (see
# that module's comment), confirmed after warehouses past position 10 in a
# 50-ID batch kept null prices forever in production.
PRICE_BATCH_SIZE = 10


async def _enqueue_paced(job_name: str, jobs_args: list[tuple], batch_time: str, interval_seconds: float, job_timeout: int) -> None:
    """Enqueue one job per entry in jobs_args, spread across most of
    interval_seconds so the queue is never more than one job deep at a
    time."""
    spacing = (interval_seconds * SPREAD_FRACTION) / max(len(jobs_args) - 1, 1)
    for i, args in enumerate(jobs_args):
        sweep_queue.enqueue(job_name, *args, batch_time, job_timeout=job_timeout)
        if i < len(jobs_args) - 1:
            await asyncio.sleep(spacing)


async def enqueue_price_sweep() -> None:
    # One shared timestamp for the whole round -- see upsert_warehouse_and_reading
    # for why that matters for retries.
    batch_time = dt.datetime.now(dt.timezone.utc).isoformat()
    records = await fetch_all_warehouses()
    ids = [int(r["warehouseNo"]) for r in records if r["warehouseNo"]]
    if not ids:
        logger.warning("Couldn't fetch the warehouse list -- skipping this price sweep round")
        return

    batches = [ids[i : i + PRICE_BATCH_SIZE] for i in range(0, len(ids), PRICE_BATCH_SIZE)]
    # Prices finish in well under a second normally; 60s is headroom for a
    # slow response, not something jobs are expected to approach.
    await _enqueue_paced(
        "app.scraper.jobs.refresh_price_batch",
        [(batch,) for batch in batches],
        batch_time,
        settings.sweep_interval_seconds,
        job_timeout=60,
    )
    logger.info("Enqueued %d price-batch jobs covering %d warehouses (batch %s)", len(batches), len(ids), batch_time)


async def enqueue_metadata_sweep() -> None:
    batch_time = dt.datetime.now(dt.timezone.utc).isoformat()
    # One call covers the entire US/CA/UK database -- see scraper/client.py
    # -- so this is a single job, not a grid to pace out.
    sweep_queue.enqueue("app.scraper.jobs.refresh_metadata", batch_time, job_timeout=240)
    logger.info("Enqueued metadata sweep job (batch %s)", batch_time)


async def enqueue_international_sweep() -> None:
    batch_time = dt.datetime.now(dt.timezone.utc).isoformat()
    await _enqueue_paced(
        "app.scraper.jobs.refresh_international_country",
        list(COUNTRIES),
        batch_time,
        settings.international_sweep_interval_seconds,
        job_timeout=120,
    )
    logger.info("Enqueued %d international sweep jobs (batch %s)", len(COUNTRIES), batch_time)


async def _schedule(name: str, run_round, interval_seconds: float) -> None:
    loop = asyncio.get_event_loop()
    while True:
        started = loop.time()
        try:
            await run_round()
        except Exception:
            logger.exception("%s round failed; will retry next interval", name)
        # run_round already spent most of the interval pacing itself out --
        # sleep whatever's left rather than the full interval again, so one
        # round still lands roughly every interval_seconds.
        elapsed = loop.time() - started
        await asyncio.sleep(max(interval_seconds - elapsed, 0))


async def main() -> None:
    await init_models()
    await asyncio.gather(
        _schedule("price sweep", enqueue_price_sweep, settings.sweep_interval_seconds),
        _schedule("metadata sweep", enqueue_metadata_sweep, settings.metadata_sweep_interval_seconds),
        _schedule("international sweep", enqueue_international_sweep, settings.international_sweep_interval_seconds),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
