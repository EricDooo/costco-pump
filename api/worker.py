"""RQ worker -- drains the `sweep` queue that enqueuer.py fills.

Runs one persistent asyncio event loop in a background thread for the whole
process lifetime, instead of a fresh loop per job (`asyncio.run()` per call).
That's not for the scraper's sake -- scraper/client.py's curl_cffi calls
don't care which loop they run on -- it's for app.db's async SQLAlchemy
engine. `engine`/`SessionLocal` are module-level singletons (see db.py), and
asyncpg connections are bound to the event loop that created them: a fresh
`asyncio.run()` per job tears down its loop when the job finishes, so the
next job's new loop inherits a connection pool full of connections attached
to a now-dead loop -- confirmed in production as
`RuntimeError: ... got Future ... attached to a different loop`, thrown
from inside asyncpg's pool checkout. One long-lived loop for the whole
process avoids that entirely.

That's also why this uses RQ's SimpleWorker, not the default Worker -- the
default forks a fresh child process per job for crash isolation, which
would leave each fork without the parent's loop/thread (and so right back
to the same bug, once per fork). Trading that isolation away is fine here:
jobs only ever do network I/O and DB writes, nothing that runs untrusted
code.
"""

import asyncio
import logging
import threading

from redis import Redis
from rq import SimpleWorker

from app.config import settings

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

    connection = Redis.from_url(settings.redis_url)
    worker = SimpleWorker(["sweep"], connection=connection)
    worker.work()
