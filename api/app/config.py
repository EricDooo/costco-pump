from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://gas:gas@localhost:5432/gas"
    redis_url: str = "redis://localhost:6379/0"

    # How often the enqueuer schedules a fresh US/CA/UK price sweep, in
    # seconds -- reads warehouse IDs straight off warehouses.json (see
    # scraper/client.py's fetch_all_warehouses) rather than a cached
    # manifest, since that call is cheap enough to just make every round.
    sweep_interval_seconds: int = 60 * 60

    # How often the enqueuer runs a full US/CA/UK metadata sweep -- the one
    # that discovers new/closed warehouses and refreshes address/hours (see
    # scraper/client.py's fetch_all_warehouses, one call to
    # warehouses.json?offset=0&limit=1000 covering the whole database, no
    # grid). Started at daily, since warehouses open/close rarely;
    # shortened to every 3 hours once the underlying fetch pipeline proved
    # reliable -- cheap now that it's one HTTP call instead of ~184 grid
    # points, so there's no real cost to running it more often.
    metadata_sweep_interval_seconds: int = 60 * 60 * 3

    # How often the enqueuer refreshes the international countries (see
    # scraper/international.py) -- one job per country, each a combined
    # metadata+price call via that country's SAP Commerce Cloud API. Same
    # cadence as the US/CA/UK metadata sweep by default; kept as its own
    # setting since the two schedules cover unrelated platforms and may
    # want different intervals later.
    international_sweep_interval_seconds: int = 60 * 60 * 3

    scrape_timeout_seconds: float = 30.0

    stats_cache_seconds: int = 300
    stations_cache_seconds: int = 300


settings = Settings()
