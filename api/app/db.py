from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from .config import settings

# NullPool -- no connection pooling, a fresh asyncpg connection per checkout
# and closed again after use. The one process that matters most here is
# worker.py: RQ's SimpleWorker runs each job's DB access under its own
# `asyncio.run()` (a fresh event loop per job -- see jobs.py), and asyncpg
# connections are bound to the loop that created them. A pooled connection
# from job N's loop is unusable -- and unrecoverable, not just slow -- once
# that loop is gone, which is exactly the
# "RuntimeError: ... attached to a different loop" this project hit before.
# NullPool sidesteps that by never handing out a connection older than the
# current checkout. api/enqueuer run on one stable loop each and would
# benefit from real pooling, but this project's traffic is light enough
# that a fresh connection per checkout (rather than two engines to keep
# straight) isn't worth the complexity.
engine = create_async_engine(settings.database_url, poolclass=NullPool)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_models() -> None:
    """Create tables and hypertable/PostGIS setup on a fresh database.

    A personal-scale project doesn't need a migration framework yet -- this is
    idempotent and safe to run on every startup. Reach for Alembic if the
    schema starts changing shape after data already exists.
    """
    # Local import: Warehouse/PriceReading only register themselves on
    # Base.metadata once app.models is actually imported somewhere. api's
    # module chain imports it transitively (via routers), but enqueuer.py
    # doesn't -- without this, its call to create_all() silently creates
    # nothing, and the create_hypertable() below fails on a table that was
    # never made.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis")
        await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS timescaledb")
        await conn.run_sync(Base.metadata.create_all)
        await conn.exec_driver_sql(
            "SELECT create_hypertable('price_readings', 'time', "
            "if_not_exists => TRUE, migrate_data => TRUE)"
        )
