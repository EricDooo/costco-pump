"""Parsing + upsert logic shared by the per-point RQ job (jobs.py) and the
manual/dry-run CLI below.

Costco's response field names aren't publicly documented and can drift, so
`_first` tries a short list of plausible keys per field rather than assuming
one exact shape. Run `python -m app.scraper.ingest --once --dry-run` after any
change to Costco's site to confirm these still line up with the real payload
(see the README's verification section).
"""

import argparse
import asyncio
import datetime as dt
import logging
from typing import Any

from geoalchemy2.elements import WKTElement
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionLocal, init_models
from ..models import PriceReading, Warehouse
from .client import sweep

logger = logging.getLogger(__name__)


def _first(raw: dict, *keys: str) -> Any:
    for key in keys:
        if raw.get(key) not in (None, ""):
            return raw[key]
    return None


def _price(raw: dict, *keys: str) -> float | None:
    value = _first(raw, *keys)
    if value in (None, "", "N/A"):
        return None
    try:
        return float(str(value).replace("$", "").strip())
    except ValueError:
        return None


def _hours(raw: dict) -> list[str] | None:
    """Pull warehouse hours out of the same populateWarehouseDetails payload
    that already carries prices -- no separate lookup, no cost. Costco's
    locator page shows hours as separate blocks (regular vs. senior/holiday);
    we keep it as a flat list of display strings rather than guessing at a
    stricter schema, same spirit as the price field matching above.
    """
    value = _first(raw, "warehouseHours", "hours", "regularHours", "hoursOfOperation")
    if value is None:
        return None
    if isinstance(value, list):
        # Accept either plain strings or {day, hours}-shaped dicts.
        return [v if isinstance(v, str) else " ".join(str(x) for x in v.values()) for v in value]
    if isinstance(value, str):
        return [line.strip() for line in value.splitlines() if line.strip()]
    return None


def parse_warehouse(raw: dict) -> dict | None:
    wid = _first(raw, "warehouseNo", "whsNumber", "warehouseId", "id")
    lat = _first(raw, "latitude", "lat")
    lon = _first(raw, "longitude", "lng", "lon")
    if wid is None or lat is None or lon is None:
        return None
    return {
        "id": int(wid),
        "name": _first(raw, "warehouseName", "locationName", "name") or f"Costco #{wid}",
        "address": _first(raw, "address1", "address") or "",
        "city": _first(raw, "city") or "",
        "state": (_first(raw, "state", "stateCode") or "")[:2].upper(),
        "zip_code": str(_first(raw, "zipCode", "zip") or ""),
        "lat": float(lat),
        "lon": float(lon),
        "regular_price": _price(raw, "regularPrice", "regGasPrice", "unlead87"),
        "premium_price": _price(raw, "premiumPrice", "premGasPrice", "unlead91"),
        "diesel_price": _price(raw, "dieselPrice", "diesel"),
        "hours": _hours(raw),
    }


async def upsert_warehouse_and_reading(session: AsyncSession, row: dict, batch_time: dt.datetime) -> None:
    """Upsert one warehouse's location/metadata/hours and record one price
    reading. `batch_time` is passed in (not `now()` per call) so that
    retrying a job -- or re-running the same grid point twice in one hourly
    round -- overwrites the same `price_readings` row via its
    (time, warehouse_id) key instead of inserting a near-duplicate a few
    seconds apart.
    """
    geom = WKTElement(f"POINT({row['lon']} {row['lat']})", srid=4326)
    warehouse_values = {k: v for k, v in row.items() if k not in ("regular_price", "premium_price", "diesel_price")}
    stmt = (
        pg_insert(Warehouse)
        .values(**warehouse_values, geom=geom)
        .on_conflict_do_update(
            index_elements=[Warehouse.id],
            set_={
                "name": row["name"],
                "address": row["address"],
                "city": row["city"],
                "state": row["state"],
                "zip_code": row["zip_code"],
                "lat": row["lat"],
                "lon": row["lon"],
                "geom": geom,
                "hours": row["hours"],
                "updated_at": batch_time,
            },
        )
    )
    await session.execute(stmt)

    reading_stmt = (
        pg_insert(PriceReading)
        .values(
            time=batch_time,
            warehouse_id=row["id"],
            regular_price=row["regular_price"],
            premium_price=row["premium_price"],
            diesel_price=row["diesel_price"],
        )
        .on_conflict_do_update(
            index_elements=[PriceReading.time, PriceReading.warehouse_id],
            set_={
                "regular_price": row["regular_price"],
                "premium_price": row["premium_price"],
                "diesel_price": row["diesel_price"],
            },
        )
    )
    await session.execute(reading_stmt)


async def ingest(session: AsyncSession, raw_warehouses: list[dict], batch_time: dt.datetime | None = None) -> int:
    batch_time = batch_time or dt.datetime.now(dt.timezone.utc)
    parsed = [row for raw in raw_warehouses if (row := parse_warehouse(raw)) is not None]

    for row in parsed:
        await upsert_warehouse_and_reading(session, row, batch_time)

    await session.commit()
    return len(parsed)


async def run_once(dry_run: bool = False) -> None:
    raw_warehouses = await sweep()
    if dry_run:
        logger.info("Dry run: fetched %d raw warehouse records, not writing to the database", len(raw_warehouses))
        if raw_warehouses:
            logger.info("Sample record: %s", raw_warehouses[0])
        return

    async with SessionLocal() as session:
        count = await ingest(session, raw_warehouses)
        logger.info("Ingested %d warehouses", count)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run a single sweep+ingest and exit")
    parser.add_argument("--dry-run", action="store_true", help="fetch but don't write to the database")
    parser.add_argument("--init-db", action="store_true", help="create tables/hypertable first")
    args = parser.parse_args()

    async def _main() -> None:
        if args.init_db:
            await init_models()
        await run_once(dry_run=args.dry_run)

    asyncio.run(_main())
