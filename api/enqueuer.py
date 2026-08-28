"""Scheduling loop -- the `enqueuer` service's entrypoint.

Enqueues one sweep job per grid point every `sweep_interval_seconds` (default
hourly). A plain sleep loop is enough at this scale -- one process, one cheap
scheduling step, no missed-run bookkeeping worth a real scheduler's
complexity.

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


def enqueue_sweep() -> None:
    # One shared timestamp for the whole round -- see upsert_warehouse_and_reading
    # for why that matters for retries.
    batch_time = dt.datetime.now(dt.timezone.utc).isoformat()
    points = grid_points(settings.grid_step_degrees)
    for lat, lng in points:
        sweep_queue.enqueue("app.scraper.jobs.scrape_grid_point", lat, lng, batch_time)
    logger.info("Enqueued %d sweep jobs (batch %s)", len(points), batch_time)


async def main() -> None:
    await init_models()
    while True:
        try:
            enqueue_sweep()
        except Exception:
            logger.exception("Scheduling round failed; will retry next interval")
        await asyncio.sleep(settings.sweep_interval_seconds)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
