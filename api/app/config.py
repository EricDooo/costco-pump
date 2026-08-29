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
    # (see scraper/client.py's fetch_grid_point). Warehouses open or close
    # rarely enough that this doesn't need hourly cadence; daily is already
    # generous, and it's the price sweep above that stays fast/frequent.
    metadata_sweep_interval_seconds: int = 60 * 60 * 24

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
