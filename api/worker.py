"""RQ worker -- drains the `sweep` queue that enqueuer.py fills.

Plain RQ SimpleWorker: jobs are quick, independent HTTP calls now
(scraper/client.py), so there's no shared resource -- like the old
Playwright/Patchright browser session -- that needs to survive across jobs
or stay pinned to one event loop. SimpleWorker (in-process, no fork per job)
is still the better fit than the default forking Worker purely because
these jobs are short and cheap enough that fork overhead would dominate;
that's the only reason left to prefer it, not resource reuse.
"""

import logging

from redis import Redis
from rq import SimpleWorker

from app.config import settings

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    connection = Redis.from_url(settings.redis_url)
    worker = SimpleWorker(["sweep"], connection=connection)
    worker.work()
