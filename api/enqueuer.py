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
  - international sweep (`international_check_interval_seconds`, default 2
    hours): NOT one shared round like the other two -- each country in
    scraper/international.py's COUNTRIES is checked independently, on its
    own clock, and only enqueued while it's currently daytime there (see
    INTERNATIONAL_BUSINESS_START_HOUR/END_HOUR below). A single shared UTC
    schedule made no sense across 8 countries spanning nearly every
    timezone: "every 3 hours" would hit some countries at 3am local and
    others at 3pm. Polling each country's local hour independently instead
    means Australia's evening checks happen on Australia's clock, Mexico's
    on Mexico's, with no coordination between them needed.

The price sweep still trickles its batch jobs across most of its interval
(see SPREAD_FRACTION) -- with scraper/client.py's curl_cffi calls being
near-instant, enqueuing all ~80 batch jobs at once and letting SimpleWorker
drain them back-to-back reproduced the exact silent-drop hangs seen
elsewhere in this project when request volume spikes. The metadata sweep
doesn't need pacing: the whole US/CA/UK database is one job. The
international scheduler doesn't either, for a different reason -- see above,
it's not a batch round at all.

  - benchmark refresh (`benchmark_refresh_interval_seconds`, default daily):
    national/PADD-region average gas prices + WTI crude spot from EIA's
    public API (scraper/eia.py) -- entirely unrelated to Costco, just riding
    the same queue/worker/schedule machinery as everything else here. A
    single job, like the metadata sweep -- nothing to batch or pace.

This process only enqueues; `worker.py` is what actually does the work.
Separating them is the point of using a queue at all -- a slow or failed
job never blocks the schedule, and scraping throughput can be scaled by
running more `worker` replicas without touching this file.
"""

import asyncio
import datetime as dt
import logging
import zoneinfo

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

# The international scheduler's "is it worth checking this country right
# now" window, in that country's own local time -- gas prices don't move
# overnight, so there's no point sweeping a country at 3am local. Wide on
# purpose (covers early risers through late closers) rather than trying to
# match each country's actual warehouse hours, which vary per-warehouse
# anyway (see scraper/international.py's _format_hours).
INTERNATIONAL_BUSINESS_START_HOUR = 6
INTERNATIONAL_BUSINESS_END_HOUR = 22

# How often the international scheduler wakes up to check every country's
# local clock -- not itself a per-country cadence (that's
# international_check_interval_seconds), just how granular the "did a
# country's window open, or has 2 hours passed" check is.
INTERNATIONAL_POLL_SECONDS = 300

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


async def enqueue_benchmark_refresh() -> None:
    batch_time = dt.datetime.now(dt.timezone.utc).isoformat()
    sweep_queue.enqueue("app.scraper.jobs.refresh_benchmarks", batch_time, job_timeout=60)
    logger.info("Enqueued regional-benchmark refresh job (batch %s)", batch_time)


async def _international_scheduler() -> None:
    """Independently paces each country in COUNTRIES -- see module
    docstring's "international sweep" section for why this isn't a shared
    round like the other two schedules. `last_run` is in-memory only (keyed
    by monotonic loop time, not wall clock, so it's immune to any system
    clock jump): resets on an enqueuer restart, which just means every
    country becomes immediately eligible again on the next poll rather than
    waiting out whatever was left of its 2 hours -- fine for a handful of
    cheap calls, and simpler than persisting it anywhere."""
    last_run: dict[str, float] = {}
    loop = asyncio.get_event_loop()
    while True:
        now_utc = dt.datetime.now(dt.timezone.utc)
        for country, domain, offset, tz_name in COUNTRIES:
            try:
                local_hour = now_utc.astimezone(zoneinfo.ZoneInfo(tz_name)).hour
                if not (INTERNATIONAL_BUSINESS_START_HOUR <= local_hour < INTERNATIONAL_BUSINESS_END_HOUR):
                    continue
                # Unset means "never run" -- treat as already overdue rather
                # than requiring a first full interval to pass after startup.
                due_at = last_run.get(country, -settings.international_check_interval_seconds)
                if loop.time() - due_at < settings.international_check_interval_seconds:
                    continue
                sweep_queue.enqueue(
                    "app.scraper.jobs.refresh_international_country",
                    country,
                    domain,
                    offset,
                    now_utc.isoformat(),
                    job_timeout=120,
                )
                logger.info("Enqueued international sweep for %s (local hour %d)", country, local_hour)
                last_run[country] = loop.time()
            except Exception:
                # One country's tz lookup or enqueue failing (e.g. a bad
                # tzdata install) shouldn't take the other 7 -- or the price
                # and metadata schedules running in the same gather -- down
                # with it.
                logger.exception("International scheduler failed for %s; will retry next poll", country)
        await asyncio.sleep(INTERNATIONAL_POLL_SECONDS)


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
        _schedule("benchmark refresh", enqueue_benchmark_refresh, settings.benchmark_refresh_interval_seconds),
        _international_scheduler(),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
