"""RQ worker -- drains the `sweep` queue that enqueuer.py fills.

Runs one persistent asyncio event loop in a background thread for the whole
process lifetime, instead of a fresh loop per job (`asyncio.run()` per
call, the previous design). This is specifically for Playwright: a browser
is tied to the event loop that created it, so reusing one Chromium instance
across all ~184 jobs/hour (scraper/browser.py) requires a loop that outlives
any single job. SQLAlchemy's async engine benefits the same way.

That reuse is also why this uses RQ's SimpleWorker, not the default Worker --
the default forks a fresh child process per job for crash isolation, which
would leave each fork without the parent's browser or background thread.
Trading that isolation away is fine here: jobs only ever do network I/O and
DB writes, nothing that runs untrusted code.
"""

import asyncio
import logging
import threading

from redis import Redis
from rq import SimpleWorker

from app.config import settings
from app.scraper.browser import warm_up

logger = logging.getLogger(__name__)

_loop = asyncio.new_event_loop()


def _run_loop_forever() -> None:
    asyncio.set_event_loop(_loop)
    _loop.run_forever()


def run_coro(coro):
    """Submit a coroutine to the persistent loop and block for its result --
    what scraper/jobs.py calls instead of asyncio.run()."""
    return asyncio.run_coroutine_threadsafe(coro, _loop).result()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    threading.Thread(target=_run_loop_forever, daemon=True).start()

    logger.info("Warming up the Playwright session before taking any jobs...")
    run_coro(warm_up())
    logger.info("Warm-up done; starting to consume the sweep queue")

    connection = Redis.from_url(settings.redis_url)
    worker = SimpleWorker(["sweep"], connection=connection)
    worker.work()
