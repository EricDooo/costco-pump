"""Scheduling loop -- the `enqueuer` service's entrypoint.

Two independent schedules, run concurrently:
  - price sweep (hourly, `sweep_interval_seconds`): prices only, for every
    warehouse ID already known -- read straight from our own `warehouses`
    table (ingest.get_all_warehouse_ids), not rediscovered via the grid
    every time. Costco's locator caps results at 50/page, which is why the
    grid-sweep approach existed at all; the price endpoint takes a batch of
    IDs directly, so once IDs are known there's no reason to keep
    re-deriving them hourly. ~674 warehouses / 50 per batch is ~14 jobs,
    down from ~184 grid-point jobs -- most of which used to exist only to
    re-discover IDs we'd already seen.
  - metadata sweep (daily, `metadata_sweep_interval_seconds`): the original
    full grid sweep, discovering new/closed warehouses and refreshing
    address/hours. Warehouses don't change that often; daily is generous.

Both trickle their enqueue() calls across most of their interval rather
than dumping everything in at once -- see SPREAD_FRACTION. That matters
more than it used to: with the old Playwright session, each job took long
enough on its own that ~184 jobs/hour was naturally spread out. Now that
scraper/client.py is near-instant (curl_cffi, no browser), enqueuing
everything at once and letting SimpleWorker drain it back-to-back turns
"roughly one request every ~20s" into "the whole round's requests in a
couple of minutes" -- confirmed in production as jobs that silently hung
with no response at all, the same silent-drop symptom seen everywhere else
in this project when request volume spikes.

On a genuinely empty database (never swept before) the price sweep has
nothing to read and skips until the metadata sweep -- itself trickled
across up to `metadata_sweep_interval_seconds` -- has covered enough of the
country to seed it. Not a concern for this project's actual database, which
already has warehouses in it, but worth knowing for a from-scratch setup.

This process only enqueues; `worker.py` is what actually does the work.
Separating them is the point of using a queue at all -- a slow or failed
job never blocks the schedule, and scraping throughput can be scaled by
running more `worker` replicas without touching this file.
"""

import asyncio
import datetime as dt
import logging

from app.config import settings
from app.db import SessionLocal, init_models
from app.queue import sweep_queue
from app.scraper.grid import grid_points
from app.scraper.ingest import get_all_warehouse_ids

logger = logging.getLogger(__name__)

# Fraction of the interval spent trickling jobs in -- not the full interval,
# so a round that starts slightly late (or a slow job along the way) still
# leaves headroom before the next one begins.
SPREAD_FRACTION = 0.9

# Matches scraper/client.py's PRICE_BATCH_SIZE -- the batch size Costco's
# own locator page uses for one price call.
PRICE_BATCH_SIZE = 50


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
    async with SessionLocal() as session:
        ids = await get_all_warehouse_ids(session)
    if not ids:
        logger.warning("No warehouses known yet -- skipping price sweep until a metadata sweep seeds some")
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
    points = grid_points(settings.grid_step_degrees)
    # Plain HTTP calls (scraper/client.py) finish in a couple seconds
    # normally; 240s is just headroom for a slow retry chain.
    await _enqueue_paced(
        "app.scraper.jobs.scrape_grid_point",
        points,
        batch_time,
        settings.metadata_sweep_interval_seconds,
        job_timeout=240,
    )
    logger.info("Enqueued %d metadata sweep jobs (batch %s)", len(points), batch_time)


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
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
