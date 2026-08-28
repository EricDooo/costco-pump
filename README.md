# costco-pump

Tracks the price at every US Costco with a gas station, over time, plus each
warehouse's business hours. Served at [ericdoo.com/costcogas](https://ericdoo.com/costcogas).

## How it works

Costco doesn't publish a nationwide price feed, so the `enqueuer` service
lays a grid of lat/lng points across the US and, once an hour, enqueues one
job per point onto a Redis-backed queue (RQ). Each job hits Costco's own
public warehouse-locator endpoint -- the same one `costco.com`'s "find a
warehouse" search uses -- and upserts whatever it finds. `worker` drains that
queue; splitting the sweep into one job per point means a slow or failed
point never blocks the rest, and throughput scales by running more `worker`
replicas, not by touching any code.

Business hours ride along for free in that same response -- Costco's own
`populateWarehouseDetails=true` payload already includes them, so there's no
separate lookup, no second API, and nothing to pay for.

Everything lives in Postgres with the TimescaleDB + PostGIS extensions:
prices are a hypertable partitioned on time, locations are geography points.

This stack is entirely independent of `ericdoo-infra`'s Caddy stack -- see
its README for how the two are joined by one shared Docker network.

## Develop

```sh
cp .env.example .env   # fill in POSTGRES_PASSWORD at minimum
docker compose up -d postgres redis
cd api && pip install -r requirements.txt
python -m app.scraper.ingest --once --dry-run   # confirm the live scrape still parses
python -m app.scraper.ingest --once --init-db   # first real ingest, creates the schema
python -m uvicorn app.main:app --reload

cd ../web && bun install && bun run dev
```

## Deploy

Push to `main`. GitHub Actions builds the frontend and rsyncs it to
`~/infra/site/costcogas/`, and builds+pushes the API image (arm64, for the
Oracle VM) to GHCR. The server pulls and restarts `api`/`worker`/`enqueuer` --
Caddy is never touched by this repo's deploys.
