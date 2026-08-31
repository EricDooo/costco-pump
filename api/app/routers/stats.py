from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_cached, set_cached
from ..config import settings
from ..db import get_session
from ..limiter import limiter
from ..schemas import (
    BenchmarkSummary,
    MonthlyAverage,
    RegionalComparison,
    StateChangeStat,
    StateFuelStat,
    StateStat,
    StatsSummary,
    TrendPoint,
    TrendSummary,
)
from ..scraper.eia import region_for_state
from ..scraper.international import COUNTRIES

router = APIRouter()

# Mirrors web/src/lib/regions.ts's REGIONS[].matches exactly -- kept here
# as plain constants (not imported from the frontend, obviously) since this
# is the one other place that same id-range/state-code logic has to live.
CA_PROVINCES = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}
_INTL_OFFSETS = {slug: offset for slug, _domain, offset, _tz in COUNTRIES}


def _region_filter(region: str) -> str:
    """SQL WHERE fragment (references table alias `w`) scoping to one
    region. Built from fixed constants after a whitelist lookup below, not
    from `region` itself, so this is safe to inline into the query text."""
    provinces = ",".join(f"'{p}'" for p in CA_PROVINCES)
    if region == "us":
        return f"w.id < 900000 and w.state != '' and w.state not in ({provinces})"
    if region == "ca":
        return f"w.id < 900000 and w.state in ({provinces})"
    if region == "uk":
        return "w.id < 900000 and w.state = ''"
    offset = _INTL_OFFSETS.get(region)
    if offset is None:
        raise HTTPException(status_code=400, detail=f"Unknown region: {region}")
    return f"w.id >= {offset} and w.id < {offset + 10_000}"

# stats_summary's four queries below all take `region` and scope via
# _region_filter, same as the trend/changes/states builders further down --
# unscoped, this silently mixed every country's data into one number under a
# header that reads as region-specific ("Aggregate trends for {region.label}"
# on Analytics.tsx), which is what prompted moving these from module-level
# constants to per-region functions.


def _moves_sql(region: str):
    """Compares each reading to the previous one for the same warehouse (via
    LAG) to count how many individual price moves were cuts vs. hikes --
    mirrors what a human would see paging through one warehouse's history
    over time."""
    return text(
        f"""
        with moves as (
            select
                p.warehouse_id,
                p.regular_price,
                lag(p.regular_price) over (partition by p.warehouse_id order by p.time) as prev_price
            from price_readings p
            join warehouses w on w.id = p.warehouse_id
            where {_region_filter(region)}
        )
        select
            count(*) filter (where regular_price < prev_price) as cuts,
            count(*) filter (where regular_price > prev_price) as hikes
        from moves
        where prev_price is not null and regular_price is not null
        """
    )


def _tracked_days_sql(region: str):
    return text(
        f"""
        select extract(day from max(p.time) - min(p.time))::int as days
        from price_readings p
        join warehouses w on w.id = p.warehouse_id
        where {_region_filter(region)}
        """
    )


def _state_avg_sql(region: str, direction: str):
    return text(
        f"""
        select
            w.state,
            avg(p.regular_price) as avg_regular,
            avg(p.premium_price) filter (where p.premium_price is not null) as avg_premium,
            avg(p.diesel_price) filter (where p.diesel_price is not null) as avg_diesel
        from price_readings p
        join warehouses w on w.id = p.warehouse_id
        where {_region_filter(region)} and p.time > now() - interval '7 days' and p.regular_price is not null
          -- UK warehouses have no state code at all (postcodes, not states --
          -- see scraper/ingest.py's parse_warehouse), so this column is ''
          -- for all of them; group them under one real state instead of an
          -- unlabeled blank row.
          and w.state != ''
        group by w.state
        order by avg_regular {direction}
        limit 20
        """
    )


def _monthly_avg_sql(region: str):
    return text(
        f"""
        select to_char(date_trunc('month', p.time), 'YYYY-MM') as month,
               avg(p.regular_price) as avg_price
        from price_readings p
        join warehouses w on w.id = p.warehouse_id
        where {_region_filter(region)} and p.regular_price is not null
        group by 1
        order by 1
        """
    )

# `region` scopes every query below via _region_filter; `with_state` (where
# present) adds a further `w.state = :state` narrowing for a per-state page
# within a state-having region (us/ca). Built fresh per call, not kept as
# module-level constants, since both fragments vary.


def _trend_points_sql(region: str, with_state: bool):
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
                where {_region_filter(region)} and p.time > now() - make_interval(days => :days) {state_filter}
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


def _current_median_sql(region: str, with_state: bool):
    state_filter = "and w.state = :state" if with_state else ""
    return text(
        f"""
        with latest as (
            select distinct on (p.warehouse_id) p.warehouse_id, p.regular_price
            from price_readings p
            join warehouses w on w.id = p.warehouse_id
            where {_region_filter(region)} and p.regular_price is not null {state_filter}
            order by p.warehouse_id, p.time desc
        )
        select count(*) as stations_reporting,
               percentile_cont(0.5) within group (order by regular_price) as current_median
        from latest
        """
    )


def _recent_moves_sql(region: str, with_state: bool):
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
            where {_region_filter(region)} {state_filter}
        )
        select
            count(*) filter (where regular_price < prev_price) as cuts,
            count(*) filter (where regular_price > prev_price) as hikes
        from moves
        where prev_price is not null and regular_price is not null and time > now() - interval '1 day'
        """
    )


def _changes_by_state_sql(region: str):
    return text(
        f"""
        with moves as (
            select
                w.state, p.regular_price,
                lag(p.regular_price) over (partition by p.warehouse_id order by p.time) as prev_price,
                p.time
            from price_readings p
            join warehouses w on w.id = p.warehouse_id
            where {_region_filter(region)}
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


_LATEST_REGIONAL_BENCHMARKS_SQL = text(
    """
    select distinct on (region_code) region_code, avg_regular_price, time
    from regional_benchmarks
    order by region_code, time desc
    """
)

_LATEST_CRUDE_SQL = text("select wti_spot_price, time from crude_benchmarks order by time desc limit 1")


def _states_sql(region: str):
    return text(
        f"""
        select
            w.state,
            avg(p.regular_price) filter (where p.regular_price is not null) as avg_regular,
            avg(p.premium_price) filter (where p.premium_price is not null) as avg_premium,
            avg(p.diesel_price) filter (where p.diesel_price is not null) as avg_diesel,
            count(distinct w.id) as station_count
        from price_readings p
        join warehouses w on w.id = p.warehouse_id
        where {_region_filter(region)} and p.time > now() - interval '7 days'
        group by w.state
        order by avg_regular asc
        """
    )


def _state_stat(r) -> StateStat:
    return StateStat(
        state=r["state"],
        avg_regular_price=float(r["avg_regular"]),
        avg_premium_price=float(r["avg_premium"]) if r["avg_premium"] is not None else None,
        avg_diesel_price=float(r["avg_diesel"]) if r["avg_diesel"] is not None else None,
    )


@router.get("/stats/summary", response_model=StatsSummary)
@limiter.limit("30/minute")
async def stats_summary(
    request: Request, region: str = Query(default="us"), session: AsyncSession = Depends(get_session)
) -> StatsSummary:
    cache_key = f"stats:summary:{region}"
    if cached := await get_cached(cache_key):
        return StatsSummary(**cached)

    moves = (await session.execute(_moves_sql(region))).mappings().one()
    tracked_days = (await session.execute(_tracked_days_sql(region))).scalar() or 0

    cheapest = (await session.execute(_state_avg_sql(region, "asc"))).mappings().all()
    priciest = (await session.execute(_state_avg_sql(region, "desc"))).mappings().all()
    monthly = (await session.execute(_monthly_avg_sql(region))).mappings().all()

    result = StatsSummary(
        tracked_days=tracked_days,
        total_price_moves=(moves["cuts"] or 0) + (moves["hikes"] or 0),
        hikes=moves["hikes"] or 0,
        cuts=moves["cuts"] or 0,
        cheapest_states=[_state_stat(r) for r in cheapest],
        priciest_states=[_state_stat(r) for r in priciest],
        monthly_averages=[
            MonthlyAverage(month=r["month"], avg_regular_price=float(r["avg_price"])) for r in monthly
        ],
    )
    await set_cached(cache_key, result.model_dump(), settings.stats_cache_seconds)
    return result


@router.get("/stats/trend", response_model=TrendSummary)
@limiter.limit("30/minute")
async def stats_trend(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    region: str = Query(default="us"),
    state: str | None = Query(default=None, max_length=2),
    session: AsyncSession = Depends(get_session),
) -> TrendSummary:
    state_code = state.upper() if state else None
    cache_key = f"stats:trend:{region}:{days}:{state_code or 'all'}"
    if cached := await get_cached(cache_key):
        return TrendSummary(**cached)

    state_params = {"state": state_code} if state_code else {}
    points_rows = (
        (await session.execute(_trend_points_sql(region, bool(state_code)), {"days": days, **state_params}))
        .mappings()
        .all()
    )
    median_row = (await session.execute(_current_median_sql(region, bool(state_code)), state_params)).mappings().one()
    moves_row = (await session.execute(_recent_moves_sql(region, bool(state_code)), state_params)).mappings().one()

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
    region: str = Query(default="us"),
    session: AsyncSession = Depends(get_session),
) -> list[StateChangeStat]:
    cache_key = f"stats:changes-by-state:{region}:{hours}"
    if cached := await get_cached(cache_key):
        return [StateChangeStat(**row) for row in cached]

    rows = (await session.execute(_changes_by_state_sql(region), {"hours": hours})).mappings().all()
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


@router.get("/stats/benchmarks", response_model=BenchmarkSummary)
@limiter.limit("30/minute")
async def stats_benchmarks(request: Request, session: AsyncSession = Depends(get_session)) -> BenchmarkSummary:
    """Costco's US prices against EIA's public national/PADD-region
    averages + WTI crude spot (see scraper/eia.py) -- US-only, since EIA's
    PADD geography has nothing to compare Canada/UK/international warehouses
    against. Empty/all-null until worker.py's refresh_benchmarks job has run
    at least once (needs EIA_API_KEY set -- see .env.example)."""
    if cached := await get_cached("stats:benchmarks"):
        return BenchmarkSummary(**cached)

    benchmark_rows = (await session.execute(_LATEST_REGIONAL_BENCHMARKS_SQL)).mappings().all()
    by_region = {r["region_code"]: float(r["avg_regular_price"]) for r in benchmark_rows}
    as_of = max((r["time"] for r in benchmark_rows), default=None)

    crude_row = (await session.execute(_LATEST_CRUDE_SQL)).mappings().first()
    wti = float(crude_row["wti_spot_price"]) if crude_row else None
    if crude_row and (as_of is None or crude_row["time"] > as_of):
        as_of = crude_row["time"]

    state_rows = (await session.execute(_states_sql("us"))).mappings().all()

    by_state: list[RegionalComparison] = []
    weighted_sum = 0.0
    total_stations = 0
    for r in state_rows:
        if r["avg_regular"] is None:
            continue
        region_code = region_for_state(r["state"])
        region_avg = by_region.get(region_code) if region_code else None
        if region_avg is None:
            continue
        costco_avg = float(r["avg_regular"])
        by_state.append(
            RegionalComparison(
                state=r["state"],
                region_code=region_code,
                costco_avg_regular=costco_avg,
                region_avg_regular=region_avg,
                savings=region_avg - costco_avg,
                station_count=r["station_count"],
            )
        )
        weighted_sum += costco_avg * r["station_count"]
        total_stations += r["station_count"]

    national_costco_avg = weighted_sum / total_stations if total_stations else None
    national_avg = by_region.get("NUS")
    national_savings = (
        national_avg - national_costco_avg if national_avg is not None and national_costco_avg is not None else None
    )

    result = BenchmarkSummary(
        as_of=as_of,
        national_avg_regular_price=national_avg,
        national_costco_avg_regular_price=national_costco_avg,
        national_savings=national_savings,
        wti_spot_price=wti,
        by_state=by_state,
    )
    await set_cached("stats:benchmarks", result.model_dump(), settings.stats_cache_seconds)
    return result


@router.get("/stats/states", response_model=list[StateFuelStat])
@limiter.limit("30/minute")
async def stats_states(
    request: Request,
    region: str = Query(default="us"),
    session: AsyncSession = Depends(get_session),
) -> list[StateFuelStat]:
    cache_key = f"stats:states:{region}"
    if cached := await get_cached(cache_key):
        return [StateFuelStat(**row) for row in cached]

    rows = (await session.execute(_states_sql(region))).mappings().all()
    result = [
        StateFuelStat(
            state=r["state"],
            avg_regular=float(r["avg_regular"]) if r["avg_regular"] is not None else None,
            avg_premium=float(r["avg_premium"]) if r["avg_premium"] is not None else None,
            avg_diesel=float(r["avg_diesel"]) if r["avg_diesel"] is not None else None,
            station_count=r["station_count"],
        )
        for r in rows
    ]
    await set_cached(cache_key, [r.model_dump() for r in result], settings.stats_cache_seconds)
    return result
