from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import get_cached, set_cached
from ..config import settings
from ..db import get_session
from ..limiter import limiter
from ..schemas import MonthlyAverage, StateStat, StatsSummary

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
