"""Scheduling loop -- the `enqueuer` service's entrypoint.

Enqueues one sweep job per grid point every `sweep_interval_seconds` (default
hourly), trickled in across the interval rather than dumped in all at once.
A plain sleep loop is enough at this scale -- one process, one cheap
scheduling step, no missed-run bookkeeping worth a real scheduler's
complexity.

The trickle matters more than it used to: with the old Playwright session,
each job took long enough on its own that ~184 jobs/hour was naturally
spread out. Now that scraper/client.py is near-instant (curl_cffi, no
browser), enqueuing all ~184 at once and letting SimpleWorker drain them
back-to-back turns "roughly one request every ~20s" into "the whole hour's
requests in a couple of minutes" -- confirmed in production as jobs that
just silently hung with no response at all, the same silent-drop symptom
seen everywhere else in this project when request volume spikes.
enqueue_sweep spaces the enqueue() calls themselves across most of the
interval so the queue is never more than one grid point deep at a time.

This process only enqueues; `worker.py` is what actually does the work.
Separating them is the point of using a queue at all -- a slow or failed
grid point never blocks the schedule, and scraping throughput can be scaled
by running more `worker` replicas without touching this file.
"""

import asyncio
import datetime as dt
import logging

from app.config import settings
from app.db import init_models
from app.queue import sweep_queue
from app.scraper.grid import grid_points

logger = logging.getLogger(__name__)

# Fraction of the sweep interval spent trickling jobs in -- not the full
# interval, so a round that starts slightly late (or a slow point along the
# way) still leaves headroom before the next one begins.
SPREAD_FRACTION = 0.9


async def enqueue_sweep() -> None:
    # One shared timestamp for the whole round -- see upsert_warehouse_and_reading
    # for why that matters for retries.
    batch_time = dt.datetime.now(dt.timezone.utc).isoformat()
    points = grid_points(settings.grid_step_degrees)
    spacing = (settings.sweep_interval_seconds * SPREAD_FRACTION) / max(len(points) - 1, 1)
    for i, (lat, lng) in enumerate(points):
        # Plain HTTP calls (scraper/client.py) finish in a couple seconds
        # normally; 240s is just headroom for a slow retry chain, not
        # something jobs are expected to approach.
        sweep_queue.enqueue(
            "app.scraper.jobs.scrape_grid_point", lat, lng, batch_time, job_timeout=240
        )
        if i < len(points) - 1:
            await asyncio.sleep(spacing)
    logger.info("Enqueued %d sweep jobs (batch %s)", len(points), batch_time)


async def main() -> None:
    await init_models()
    loop = asyncio.get_event_loop()
    while True:
        started = loop.time()
        try:
            await enqueue_sweep()
        except Exception:
            logger.exception("Scheduling round failed; will retry next interval")
        # enqueue_sweep already spent most of the interval pacing itself
        # out -- sleep whatever's left rather than the full interval again,
        # so one round still lands roughly every sweep_interval_seconds.
        elapsed = loop.time() - started
        await asyncio.sleep(max(settings.sweep_interval_seconds - elapsed, 0))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
