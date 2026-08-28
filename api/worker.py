"""RQ worker -- drains the `sweep` queue that enqueuer.py fills.

Deliberately one process, no threads/forking: keeping worker concurrency low
preserves the polite, low-volume scraping posture (see scraper/client.py)
regardless of how many jobs are sitting in the queue. Scale throughput later
by running more replicas of this same service, not by adding concurrency
inside one.
"""

import logging

from redis import Redis
from rq import Worker

from app.config import settings

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    connection = Redis.from_url(settings.redis_url)
    worker = Worker(["sweep"], connection=connection)
    worker.work()
