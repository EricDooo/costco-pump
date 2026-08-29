from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://gas:gas@localhost:5432/gas"
    redis_url: str = "redis://localhost:6379/0"

    # How often the enqueuer schedules a fresh price sweep, in seconds --
    # reads warehouse IDs from Costco's own site (see
    # scraper/client.py's fetch_all_warehouse_ids, cached per
    # warehouse_ids_cache_seconds below) rather than rediscovering them via
    # the grid every time, so this can run often without hammering the
    # locator endpoint at all.
    sweep_interval_seconds: int = 60 * 60

    # How long the warehouse ID list (fetch_all_warehouse_ids) is cached
    # for before the price sweep re-fetches it. Warehouse counts change
    # rarely; a day between refetches is already generous, not a
    # correctness concern -- a brand new warehouse just doesn't get price
    # readings until the next refetch.
    warehouse_ids_cache_seconds: int = 60 * 60 * 24

    # How often the enqueuer runs a full grid-based metadata sweep -- the
    # one that discovers new/closed warehouses and refreshes address/hours
    # (see scraper/client.py's fetch_grid_point, scraper/grid.py for the
    # ~197 points it now covers -- CONUS grid plus Canada/UK anchors, the
    # only international regions the locator endpoint actually indexes).
    # Started at daily, since warehouses open/close rarely; shortened to
    # every 3 hours once the underlying fetch pipeline proved reliable, so
    # a full round (previously ~22 hours to cover the whole grid at the
    # old pace) finishes in under 2 hours instead of trickling in over a
    # day -- still gentle (~197 points * 0.9 / 3h ≈ one every ~50s).
    metadata_sweep_interval_seconds: int = 60 * 60 * 3

    # Grid spacing in degrees for the lat/lng sweep. Smaller = more overlap,
    # more requests. 3 degrees comfortably covers every CONUS warehouse with a
    # 50-result page size.
    grid_step_degrees: int = 3

    # Bounded concurrency for the sweep, and how long each response is cached.
    scrape_concurrency: int = 6
    scrape_timeout_seconds: float = 30.0

    stats_cache_seconds: int = 300
    stations_cache_seconds: int = 300


settings = Settings()
