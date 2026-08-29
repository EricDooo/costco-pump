from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_cached, set_cached
from ..config import settings
from ..db import get_session
from ..limiter import limiter
from ..schemas import MonthlyAverage, StateChangeStat, StateStat, StatsSummary, TrendPoint, TrendSummary

router = APIRouter()

# Compares each reading to the previous one for the same warehouse (via LAG)
# to count how many individual price moves were cuts vs. hikes -- mirrors
# what a human would see paging through one warehouse's history over time.
_MOVES_SQL = text(
    """
    with moves as (
        select
            warehouse_id,
            regular_price,
            lag(regular_price) over (partition by warehouse_id order by time) as prev_price
        from price_readings
    )
    select
        count(*) filter (where regular_price < prev_price) as cuts,
        count(*) filter (where regular_price > prev_price) as hikes
    from moves
    where prev_price is not null and regular_price is not null
    """
)

_TRACKED_DAYS_SQL = text(
    "select extract(day from max(time) - min(time))::int as days from price_readings"
)

_STATE_AVG_TEMPLATE = """
    select w.state, avg(p.regular_price) as avg_price
    from price_readings p
    join warehouses w on w.id = p.warehouse_id
    where p.time > now() - interval '7 days' and p.regular_price is not null
      -- state/province codes are only meaningful for the domestic (US/CA/UK)
      -- id range -- scraper/international.py's records put the country's own
      -- ISO code in this same column (e.g. Australia's is literally "AU"),
      -- which would otherwise silently show up as if it were a US state or
      -- Canadian province in this ranking.
      and w.id < 900000
      -- UK warehouses have no state code at all (postcodes, not states --
      -- see scraper/ingest.py's parse_warehouse), so this column is '' for
      -- all of them; group them under one real state instead of an
      -- unlabeled blank row.
      and w.state != ''
    group by w.state
    order by avg_price {direction}
    limit 20
    """

_MONTHLY_AVG_SQL = text(
    """
    select to_char(date_trunc('month', time), 'YYYY-MM') as month,
           avg(regular_price) as avg_price
    from price_readings
    where regular_price is not null
    group by 1
    order by 1
    """
)

# Domestic (id < 900000) only -- same reasoning as _STATE_AVG_TEMPLATE above.
# `with_state` toggles an extra `w.state = :state` filter; the three queries
# below are built fresh per call rather than kept as module-level constants
# since that fragment varies.


def _trend_points_sql(with_state: bool):
    state_filter = "and w.state = :state" if with_state else ""
    return text(
        f"""
        with daily_latest as (
            -- One row per station per calendar day -- its last reading that
            -- day, so multiple sweeps in a day don't skew the median.
            select distinct on (warehouse_id, day)
                warehouse_id, day, regular_price, premium_price, diesel_price
            from (
                select
                    p.warehouse_id, date_trunc('day', p.time) as day, p.time,
                    p.regular_price, p.premium_price, p.diesel_price
                from price_readings p
                join warehouses w on w.id = p.warehouse_id
                where w.id < 900000 and p.time > now() - make_interval(days => :days) {state_filter}
            ) sub
            order by warehouse_id, day, time desc
        )
        select
            to_char(day, 'YYYY-MM-DD') as date,
            count(*) as stations_reporting,
            percentile_cont(0.5) within group (order by regular_price) filter (where regular_price is not null) as median_regular,
            percentile_cont(0.5) within group (order by premium_price) filter (where premium_price is not null) as median_premium,
            percentile_cont(0.5) within group (order by diesel_price) filter (where diesel_price is not null) as median_diesel
        from daily_latest
        group by day
        order by day
        """
    )


def _current_median_sql(with_state: bool):
    state_filter = "and w.state = :state" if with_state else ""
    return text(
        f"""
        with latest as (
            select distinct on (p.warehouse_id) p.warehouse_id, p.regular_price
            from price_readings p
            join warehouses w on w.id = p.warehouse_id
            where w.id < 900000 and p.regular_price is not null {state_filter}
            order by p.warehouse_id, p.time desc
        )
        select count(*) as stations_reporting,
               percentile_cont(0.5) within group (order by regular_price) as current_median
        from latest
        """
    )


def _recent_moves_sql(with_state: bool):
    state_filter = "and w.state = :state" if with_state else ""
    return text(
        f"""
        with moves as (
            select
                p.regular_price,
                lag(p.regular_price) over (partition by p.warehouse_id order by p.time) as prev_price,
                p.time
            from price_readings p
            join warehouses w on w.id = p.warehouse_id
            where w.id < 900000 {state_filter}
        )
        select
            count(*) filter (where regular_price < prev_price) as cuts,
            count(*) filter (where regular_price > prev_price) as hikes
        from moves
        where prev_price is not null and regular_price is not null and time > now() - interval '1 day'
        """
    )


_CHANGES_BY_STATE_SQL = text(
    """
    with moves as (
        select
            w.state, p.regular_price,
            lag(p.regular_price) over (partition by p.warehouse_id order by p.time) as prev_price,
            p.time
        from price_readings p
        join warehouses w on w.id = p.warehouse_id
        where w.id < 900000 and w.state != ''
    ),
    deltas as (
        select state, regular_price - prev_price as delta
        from moves
        where prev_price is not null and regular_price is not null and regular_price != prev_price
          and time > now() - make_interval(hours => :hours)
    )
    select
        state,
        count(*) filter (where delta > 0) as hikes,
        count(*) filter (where delta < 0) as cuts,
        avg(delta) as avg_change,
        max(abs(delta)) as biggest_move
    from deltas
    group by state
    order by count(*) desc
    """
)


@router.get("/stats/summary", response_model=StatsSummary)
@limiter.limit("30/minute")
async def stats_summary(request: Request, session: AsyncSession = Depends(get_session)) -> StatsSummary:
    if cached := await get_cached("stats:summary"):
        return StatsSummary(**cached)

    moves = (await session.execute(_MOVES_SQL)).mappings().one()
    tracked_days = (await session.execute(_TRACKED_DAYS_SQL)).scalar() or 0

    cheapest = (await session.execute(text(_STATE_AVG_TEMPLATE.format(direction="asc")))).mappings().all()
    priciest = (await session.execute(text(_STATE_AVG_TEMPLATE.format(direction="desc")))).mappings().all()
    monthly = (await session.execute(_MONTHLY_AVG_SQL)).mappings().all()

    result = StatsSummary(
        tracked_days=tracked_days,
        total_price_moves=(moves["cuts"] or 0) + (moves["hikes"] or 0),
        hikes=moves["hikes"] or 0,
        cuts=moves["cuts"] or 0,
        cheapest_states=[StateStat(state=r["state"], avg_regular_price=float(r["avg_price"])) for r in cheapest],
        priciest_states=[StateStat(state=r["state"], avg_regular_price=float(r["avg_price"])) for r in priciest],
        monthly_averages=[
            MonthlyAverage(month=r["month"], avg_regular_price=float(r["avg_price"])) for r in monthly
        ],
    )
    await set_cached("stats:summary", result.model_dump(), settings.stats_cache_seconds)
    return result


@router.get("/stats/trend", response_model=TrendSummary)
@limiter.limit("30/minute")
async def stats_trend(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    state: str | None = Query(default=None, max_length=2),
    session: AsyncSession = Depends(get_session),
) -> TrendSummary:
    state_code = state.upper() if state else None
    cache_key = f"stats:trend:{days}:{state_code or 'all'}"
    if cached := await get_cached(cache_key):
        return TrendSummary(**cached)

    state_params = {"state": state_code} if state_code else {}
    points_rows = (
        (await session.execute(_trend_points_sql(bool(state_code)), {"days": days, **state_params})).mappings().all()
    )
    median_row = (await session.execute(_current_median_sql(bool(state_code)), state_params)).mappings().one()
    moves_row = (await session.execute(_recent_moves_sql(bool(state_code)), state_params)).mappings().one()

    points = [
        TrendPoint(
            date=r["date"],
            median_regular=float(r["median_regular"]) if r["median_regular"] is not None else None,
            median_premium=float(r["median_premium"]) if r["median_premium"] is not None else None,
            median_diesel=float(r["median_diesel"]) if r["median_diesel"] is not None else None,
            stations_reporting=r["stations_reporting"],
        )
        for r in points_rows
    ]
    # move: first vs last *reported* median in the window, not necessarily
    # the very first/last day -- a window's edge days can have zero reports.
    first_regular = next((p.median_regular for p in points if p.median_regular is not None), None)
    last_regular = next((p.median_regular for p in reversed(points) if p.median_regular is not None), None)
    move = last_regular - first_regular if first_regular is not None and last_regular is not None else None

    result = TrendSummary(
        points=points,
        current_median=float(median_row["current_median"]) if median_row["current_median"] is not None else None,
        stations_reporting=median_row["stations_reporting"] or 0,
        move=move,
        latest_day_hikes=moves_row["hikes"] or 0,
        latest_day_cuts=moves_row["cuts"] or 0,
    )
    await set_cached(cache_key, result.model_dump(), settings.stats_cache_seconds)
    return result


@router.get("/stats/changes-by-state", response_model=list[StateChangeStat])
@limiter.limit("30/minute")
async def stats_changes_by_state(
    request: Request,
    hours: int = Query(default=24, ge=1, le=720),
    session: AsyncSession = Depends(get_session),
) -> list[StateChangeStat]:
    cache_key = f"stats:changes-by-state:{hours}"
    if cached := await get_cached(cache_key):
        return [StateChangeStat(**row) for row in cached]

    rows = (await session.execute(_CHANGES_BY_STATE_SQL, {"hours": hours})).mappings().all()
    result = [
        StateChangeStat(
            state=r["state"],
            hikes=r["hikes"] or 0,
            cuts=r["cuts"] or 0,
            avg_change=float(r["avg_change"]) if r["avg_change"] is not None else 0.0,
            biggest_move=float(r["biggest_move"]) if r["biggest_move"] is not None else 0.0,
        )
        for r in rows
    ]
    await set_cached(cache_key, [r.model_dump() for r in result], settings.stats_cache_seconds)
    return result
