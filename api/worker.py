"""RQ worker -- drains the `sweep` queue that enqueuer.py fills.

Plain RQ SimpleWorker, no persistent event loop. That machinery (a
background thread running one long-lived asyncio loop for the whole
process, jobs submitted to it via run_coroutine_threadsafe) was carried
over from the original Playwright-based design and kept through several
rewrites tonight to solve a real problem -- app.db's async engine needs a
stable loop, since asyncpg connections are bound to the loop that created
them (see app/db.py). But it turned out to cause a *worse* one: every job
routed through it hung indefinitely under RQ's actual SimpleWorker
execution (confirmed repeatedly against the real worker container, the
real queue, and coordinates that completed instantly every time they were
run by hand outside that path) -- something about SimpleWorker's
SIGALRM-based per-job timeout interacting badly with a background thread's
event loop, never fully root-caused, so removed rather than chased further.

Each job now just does `asyncio.run()` once for its own work, fetch and DB
write together -- the DB engine's loop-affinity problem is solved instead
by app/db.py using NullPool (a fresh connection per checkout, nothing
pooled across event loops), so there's no shared loop-bound resource left
that needs one to persist.

SimpleWorker (not the default forking Worker) is still the right choice --
jobs are quick, independent network calls, and the default's fork-per-job
isolation isn't worth the overhead here.
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
