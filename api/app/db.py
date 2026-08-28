from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
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
    async with engine.begin() as conn:
        await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis")
        await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS timescaledb")
        await conn.run_sync(Base.metadata.create_all)
        await conn.exec_driver_sql(
            "SELECT create_hypertable('price_readings', 'time', "
            "if_not_exists => TRUE, migrate_data => TRUE)"
        )
