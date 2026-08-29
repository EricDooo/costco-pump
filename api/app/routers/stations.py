import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_cached, set_cached
from ..config import settings
from ..db import get_session
from ..limiter import limiter
from ..models import PriceReading, Warehouse
from ..schemas import PricePoint, StationDetail, StationSummary

router = APIRouter()

# Subquery: the most recent price_readings row per warehouse.
_latest_time = (
    select(PriceReading.warehouse_id, func.max(PriceReading.time).label("time"))
    .group_by(PriceReading.warehouse_id)
    .subquery()
)


@router.get("/stations", response_model=list[StationSummary])
@limiter.limit("60/minute")
async def list_stations(
    request: Request,
    state: str | None = Query(default=None, max_length=2),
    session: AsyncSession = Depends(get_session),
) -> list[StationSummary]:
    cache_key = f"stations:{state or 'all'}"
    if cached := await get_cached(cache_key):
        return [StationSummary(**row) for row in cached]

    stmt = (
        select(Warehouse, PriceReading)
        .join(_latest_time, _latest_time.c.warehouse_id == Warehouse.id)
        .join(
            PriceReading,
            (PriceReading.warehouse_id == _latest_time.c.warehouse_id)
            & (PriceReading.time == _latest_time.c.time),
        )
    )
    if state:
        stmt = stmt.where(Warehouse.state == state.upper())

    rows = (await session.execute(stmt)).all()
    result = [
        StationSummary(
            id=wh.id,
            name=wh.name,
            address=wh.address,
            city=wh.city,
            state=wh.state,
            zip_code=wh.zip_code,
            lat=wh.lat,
            lon=wh.lon,
            regular_price=float(pr.regular_price) if pr.regular_price is not None else None,
            premium_price=float(pr.premium_price) if pr.premium_price is not None else None,
            diesel_price=float(pr.diesel_price) if pr.diesel_price is not None else None,
            as_of=pr.time,
        )
        for wh, pr in rows
    ]
    await set_cached(cache_key, [r.model_dump() for r in result], settings.stations_cache_seconds)
    return result


@router.get("/stations/{warehouse_id}", response_model=StationDetail)
@limiter.limit("60/minute")
async def get_station(
    request: Request,
    warehouse_id: int,
    days: int = Query(default=30, ge=1, le=365),
    session: AsyncSession = Depends(get_session),
) -> StationDetail:
    wh = await session.get(Warehouse, warehouse_id)
    if wh is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    history_stmt = (
        select(PriceReading)
        .where(PriceReading.warehouse_id == warehouse_id, PriceReading.time >= since)
        .order_by(PriceReading.time)
    )
    history = (await session.execute(history_stmt)).scalars().all()
    latest = history[-1] if history else None

    return StationDetail(
        id=wh.id,
        name=wh.name,
        address=wh.address,
        city=wh.city,
        state=wh.state,
        zip_code=wh.zip_code,
        lat=wh.lat,
        lon=wh.lon,
        regular_price=float(latest.regular_price) if latest and latest.regular_price is not None else None,
        premium_price=float(latest.premium_price) if latest and latest.premium_price is not None else None,
        diesel_price=float(latest.diesel_price) if latest and latest.diesel_price is not None else None,
        as_of=latest.time if latest else None,
        hours=wh.hours,
        gas_hours=wh.gas_hours,
        opened_date=wh.opened_date,
        phone=wh.phone,
        services=wh.services,
        programs=wh.programs,
        department_phones=wh.department_phones,
        history=[
            PricePoint(
                time=r.time,
                regular_price=float(r.regular_price) if r.regular_price is not None else None,
                premium_price=float(r.premium_price) if r.premium_price is not None else None,
                diesel_price=float(r.diesel_price) if r.diesel_price is not None else None,
            )
            for r in history
        ],
    )
