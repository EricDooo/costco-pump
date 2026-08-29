# costco-pump

Tracks the price at every Costco gas station worldwide, over time, plus each
warehouse's business hours. Served at [ericdoo.com/costcogas](https://ericdoo.com/costcogas).

## How it works

Costco doesn't publish a nationwide (or worldwide) price feed, but it turns
out to have three undocumented-but-public API calls that add up to one:

- `warehouses.json` -- one call returns every US/Canada/UK warehouse's
  location and hours, no lat/lng grid needed (see `app/scraper/client.py`).
- `AjaxGetGasPricesService` -- live prices for a batch of US/CA/UK warehouse
  IDs at a time (it silently caps a response at 10 no matter how many IDs
  are requested, so batches are sized to match).
- everywhere else Costco operates runs on a completely different platform
  (SAP Commerce Cloud), whose own per-country stores endpoint returns
  location, hours, *and* live prices together in one call (see
  `app/scraper/international.py`).

The `enqueuer` service turns those into three schedules -- a US/CA/UK price
sweep, a US/CA/UK metadata sweep, and one job per international country --
enqueued onto a Redis-backed queue (RQ) that `worker` drains. Splitting work
into small independent jobs means a slow or failed one never blocks the
rest, and throughput scales by running more `worker` replicas, not by
touching any code.

Everything lives in Postgres with the TimescaleDB + PostGIS extensions:
prices are a hypertable partitioned on time, locations are geography points.

This stack is entirely independent of `ericdoo-infra`'s Caddy stack -- see
its README for how the two are joined by one shared Docker network.

## Develop

```sh
cp .env.example .env   # fill in POSTGRES_PASSWORD at minimum
docker compose up -d postgres redis
cd api && uv sync
uv run python -m app.scraper.ingest --once --dry-run   # confirm the live scrape still parses
uv run python -m app.scraper.ingest --once --init-db   # first real ingest, creates the schema
uv run uvicorn app.main:app --reload

cd ../web && bun install && bun run dev
```

Dependencies for both `api` (uv, `pyproject.toml`/`uv.lock`) and `web` (bun,
`bunfig.toml`) refuse to resolve any package version published less than 14
days ago -- same supply-chain policy, same reasoning, in both.

## Deploy

Push to `main`. GitHub Actions builds the frontend and rsyncs it to
`~/infra/site/costcogas/`, and builds+pushes the API image (arm64, for the
Oracle VM) to GHCR. The server pulls and restarts `api`/`worker`/`enqueuer` --
Caddy is never touched by this repo's deploys.
