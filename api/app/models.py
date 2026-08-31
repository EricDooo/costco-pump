import datetime as dt

from geoalchemy2 import Geography
from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    # Costco's own numeric warehouse id -- stable, so it doubles as our PK.
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(2), index=True)
    zip_code: Mapped[str] = mapped_column(String(10))
    lat: Mapped[float]
    lon: Mapped[float]
    geom: Mapped[str] = mapped_column(Geography(geometry_type="POINT", srid=4326))
    # Display-string hours, e.g. ["Monday: 10:00 AM - 8:30 PM", ...] -- comes
    # free from the same sweep response as prices (see scraper/ingest.py's
    # _hours()), refreshed every sweep alongside everything else.
    hours: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    # The rest of these: only populated for US/CA/UK (scraper/client.py) --
    # international.py's platform doesn't expose them, so they're just None
    # there, same as any other field it lacks.
    gas_hours: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    opened_date: Mapped[dt.date | None] = mapped_column(nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    services: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    programs: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    department_phones: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    readings: Mapped[list["PriceReading"]] = relationship(back_populates="warehouse")


class PriceReading(Base):
    __tablename__ = "price_readings"

    # No surrogate id -- (time, warehouse_id) is the natural key and this table
    # is a Timescale hypertable partitioned on time.
    time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), primary_key=True)
    # (7, 3): 5,3 (max 99.999) overflowed on Japan's yen-per-liter prices
    # (~¥150) -- every Japan upsert was silently failing on this before.
    regular_price: Mapped[float | None] = mapped_column(Numeric(7, 3), nullable=True)
    premium_price: Mapped[float | None] = mapped_column(Numeric(7, 3), nullable=True)
    diesel_price: Mapped[float | None] = mapped_column(Numeric(7, 3), nullable=True)

    warehouse: Mapped[Warehouse] = relationship(back_populates="readings")


class RegionalBenchmark(Base):
    """One row per (fetch, region) -- national + each PADD region/sub-region's
    average retail regular-gasoline price, from EIA's public gnd dataset (see
    scraper/eia.py). A real time series, unlike PriceReading's per-warehouse
    granularity isn't needed here: this is small (9 regions, refreshed daily)
    and the whole point is trend/comparison ("Costco vs. this state's PADD
    region over time"), so history is kept rather than overwritten in place.
    """

    __tablename__ = "regional_benchmarks"

    time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    # "NUS" (national) or an EIA PADD/sub-PADD code ("R10", "R1X", "R1Y",
    # "R1Z", "R20", "R30", "R40", "R50") -- see scraper/eia.py's
    # PADD_BY_STATE for the state -> region_code mapping.
    region_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    avg_regular_price: Mapped[float] = mapped_column(Numeric(7, 3))


class CrudeBenchmark(Base):
    """WTI (Cushing, OK) crude spot price -- daily, no region dimension, so
    it's its own tiny table rather than a magic row in RegionalBenchmark.
    Context for *why* prices moved, not a per-region comparison."""

    __tablename__ = "crude_benchmarks"

    time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    wti_spot_price: Mapped[float] = mapped_column(Numeric(7, 3))


class GasolineStocksBenchmark(Base):
    """Weekly US commercial gasoline inventory, national + PADD region, from
    EIA's Weekly Petroleum Status Report (petroleum/stoc/wstk -- confirmed
    the same region_code set as RegionalBenchmark's price series). Thousand
    barrels. The "why" behind a price move that RegionalBenchmark/
    CrudeBenchmark alone can't distinguish: a regional spike with normal
    stocks is probably just following crude: with stocks well below normal
    for that region, it's a genuine local supply squeeze."""

    __tablename__ = "gasoline_stocks_benchmarks"

    time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    region_code: Mapped[str] = mapped_column(String(10), primary_key=True)
    stocks_mbbl: Mapped[float] = mapped_column(Numeric(10, 1))


class GasolineDemandBenchmark(Base):
    """Weekly US finished-motor-gasoline "product supplied" -- EIA's
    standard demand proxy (petroleum/cons/wpsup). National only; that
    dataset has no duoarea/region facet at all, unlike every other EIA
    series this project pulls."""

    __tablename__ = "gasoline_demand_benchmarks"

    time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    demand_mbbl_per_day: Mapped[float] = mapped_column(Numeric(10, 1))
