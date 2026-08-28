from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://gas:gas@localhost:5432/gas"
    redis_url: str = "redis://localhost:6379/0"

    # How often the enqueuer schedules a fresh price sweep, in seconds.
    # Warehouse hours ride along in the same response as prices (Costco's
    # populateWarehouseDetails payload includes both) -- there's no separate
    # hours job or external API to pay for.
    sweep_interval_seconds: int = 60 * 60

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
