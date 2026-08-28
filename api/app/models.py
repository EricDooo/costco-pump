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
    regular_price: Mapped[float | None] = mapped_column(Numeric(5, 3), nullable=True)
    premium_price: Mapped[float | None] = mapped_column(Numeric(5, 3), nullable=True)
    diesel_price: Mapped[float | None] = mapped_column(Numeric(5, 3), nullable=True)

    warehouse: Mapped[Warehouse] = relationship(back_populates="readings")
