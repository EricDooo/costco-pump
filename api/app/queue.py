"""Redis-backed job queue (RQ) that decouples scheduling from execution.

One job per grid point, enqueued hourly by enqueuer.py. That's the actual
payoff of a queue here -- a failed or slow point doesn't block the others,
RQ retries it independently, and more `worker` replicas can be added later
to drain the queue faster without any code change.
"""

import redis
from rq import Queue

from .config import settings

_redis = redis.from_url(settings.redis_url)

sweep_queue = Queue("sweep", connection=_redis)
