"""Fetch against the U.S. Energy Information Administration's public Open
Data API v2 -- a real, documented, official government API, unlike
client.py/international.py's Costco endpoints. No fingerprint filtering, no
edge WAF: a plain request with a free API key (not a scraping workaround --
just a rate-limit identifier, see config.settings.eia_api_key) works fine.
Kept on curl_cffi anyway (not a new httpx dependency) purely for
CURL_OPTIONS' IPv4 forcing -- see client.py's docstring for why this
project's Docker networks need that regardless of which host is being
called.

Four datasets, all confirmed live against the real API while building this:

  - petroleum/pri/gnd (Gasoline and Diesel Retail Prices): weekly regular-
    gasoline averages. Despite the name this does NOT cover all 50 states --
    confirmed via the `duoarea` facet listing -- only 9 states have their own
    series, plus 10 cities, 4 PADD sub-regions (1A/1B/1C), the 5 PADD
    regions, and the national average. That's why this maps every US state
    to its PADD (sub-)region below rather than trying to fetch per-state:
    full 51-jurisdiction (50 states + DC) coverage that way, at the cost of
    losing state-level granularity EIA itself doesn't have anyway.
  - petroleum/pri/spt (Spot Prices for Crude Oil and Petroleum Products):
    daily WTI (Cushing, OK) spot price, series id RWTC -- cheap context for
    *why* retail prices moved, independent of any region.
  - petroleum/stoc/wstk (Weekly Petroleum Status Report -- Stocks): weekly US
    commercial gasoline inventory. Confirmed the exact same duoarea/region_code
    set as the price series above (NUS + all PADD (sub-)regions) -- same
    REGION_CODES reused as-is.
    Thousand barrels (MBBL).
  - petroleum/cons/wpsup (Weekly Product Supplied): weekly finished-motor-
    gasoline "product supplied" -- EIA's standard demand proxy. National
    only; confirmed this dataset has no duoarea facet at all, unlike every
    other series here. Thousand barrels/day (MBBL/D).

Together, stocks + demand are the "why" a price benchmark alone can't answer:
RegionalBenchmark/CrudeBenchmark show a region running above its own average
or above what WTI would predict, but not whether that's a genuine regional
supply squeeze (stocks well below normal for that PADD) or just following a
national demand/crude move.

Refreshed once a day (see config.settings.benchmark_refresh_interval_seconds)
-- polling more often than that buys nothing: every one of these series
updates at most weekly (WTI's the only daily one).
"""

import logging

from curl_cffi.const import CurlIpResolve, CurlOpt
from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import RequestException

from ..config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.eia.gov"
GASOLINE_PATH = "/v2/petroleum/pri/gnd/data"
CRUDE_PATH = "/v2/petroleum/pri/spt/data"
STOCKS_PATH = "/v2/petroleum/stoc/wstk/data"
DEMAND_PATH = "/v2/petroleum/cons/wpsup/data"

CURL_OPTIONS = {CurlOpt.IPRESOLVE: CurlIpResolve.V4}

# National average + every PADD region and PADD 1's three sub-regions --
# confirmed real duoarea codes via the API's own facet listing. PADD 1's
# aggregate (R10) is fetched too even though PADD_BY_STATE below always maps
# to a sub-region (1A/1B/1C, never plain PADD 1) -- cheap to keep as
# national-level-ish context alongside NUS.
REGION_CODES = ["NUS", "R10", "R1X", "R1Y", "R1Z", "R20", "R30", "R40", "R50"]

# EIA's own PADD (Petroleum Administration for Defense District) geography --
# a fixed, public regional grouping of every US state + DC, not something
# this project invented. Every state maps to a *sub*-region where PADD 1 has
# one (1A/1B/1C); PADD 1's own aggregate code (R10) is never a value here.
PADD_BY_STATE: dict[str, str] = {
    # PADD 1A -- New England
    "CT": "R1X", "ME": "R1X", "MA": "R1X", "NH": "R1X", "RI": "R1X", "VT": "R1X",
    # PADD 1B -- Central Atlantic
    "DE": "R1Y", "DC": "R1Y", "MD": "R1Y", "NJ": "R1Y", "NY": "R1Y", "PA": "R1Y",
    # PADD 1C -- Lower Atlantic
    "FL": "R1Z", "GA": "R1Z", "NC": "R1Z", "SC": "R1Z", "VA": "R1Z", "WV": "R1Z",
    # PADD 2 -- Midwest
    "IL": "R20", "IN": "R20", "IA": "R20", "KS": "R20", "KY": "R20", "MI": "R20",
    "MN": "R20", "MO": "R20", "NE": "R20", "ND": "R20", "OH": "R20", "OK": "R20",
    "SD": "R20", "TN": "R20", "WI": "R20",
    # PADD 3 -- Gulf Coast
    "AL": "R30", "AR": "R30", "LA": "R30", "MS": "R30", "NM": "R30", "TX": "R30",
    # PADD 4 -- Rocky Mountain
    "CO": "R40", "ID": "R40", "MT": "R40", "UT": "R40", "WY": "R40",
    # PADD 5 -- West Coast
    "AK": "R50", "AZ": "R50", "CA": "R50", "HI": "R50", "NV": "R50", "OR": "R50", "WA": "R50",
}  # fmt: skip

# Product codes -- all confirmed real via the API's own facet listings while
# building this.
GASOLINE_PRODUCT = "EPMR"  # Regular Gasoline (pri/gnd) -- see client.py's own
# regular/premium/diesel scope note: no premium/diesel price benchmark here,
# EIA's retail series is comprehensive for regular but spottier for the
# other two grades at this same region granularity.
WTI_SERIES = "RWTC"  # Cushing, OK WTI Spot Price FOB (pri/spt)
STOCKS_PRODUCT = "EPM0"  # Total Gasoline (stoc/wstk)
DEMAND_PRODUCT = "EPM0F"  # Finished Motor Gasoline (cons/wpsup)

# Rows requested per fetch -- more than len(REGION_CODES)/1 so a fetch that
# lands between two periods (not every region necessarily posts on the exact
# same day) still has enough rows to find each region's latest value from,
# without needing a second round-trip.
REGION_FETCH_ROWS = len(REGION_CODES) * 3
SINGLE_FETCH_ROWS = 5


async def _get(client: AsyncSession, path: str, params: dict) -> dict:
    resp = await client.get(path, params={**params, "api_key": settings.eia_api_key})
    resp.raise_for_status()
    return resp.json()


async def _fetch_by_region(path: str, product: str, frequency: str, what: str) -> dict[str, float]:
    """{region_code: value} for every code in REGION_CODES -- each region's
    most recent reported value, which may not all be the exact same period
    (a region occasionally lags by a week). Shared by fetch_regional_gasoline
    and fetch_gasoline_stocks -- same duoarea set, same "newest row per
    region" logic, just a different dataset/product."""
    if not settings.eia_api_key:
        logger.warning("EIA_API_KEY not set -- skipping %s fetch", what)
        return {}

    params = {
        "frequency": frequency,
        "data[0]": "value",
        "facets[product][0]": product,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": REGION_FETCH_ROWS,
    }
    for i, region in enumerate(REGION_CODES):
        params[f"facets[duoarea][{i}]"] = region

    async with AsyncSession(
        base_url=BASE_URL, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        try:
            data = await _get(client, path, params)
        except (RequestException, ValueError) as exc:
            logger.warning("%s fetch failed: %s", what, exc)
            return {}

    values: dict[str, float] = {}
    for row in data.get("response", {}).get("data", []):
        region = row.get("duoarea")
        value = row.get("value")
        # Rows are sorted newest-first -- first value seen per region is its
        # most recent, so a region that already has one is a stale repeat.
        if region in REGION_CODES and region not in values and value not in (None, ""):
            try:
                values[region] = float(value)
            except ValueError:
                continue
    return values


async def _fetch_single(path: str, frequency: str, facet_key: str, facet_value: str, what: str) -> float | None:
    """Most recent single value from a national-only, no-region series --
    shared by fetch_wti_spot and fetch_gasoline_demand."""
    if not settings.eia_api_key:
        logger.warning("EIA_API_KEY not set -- skipping %s fetch", what)
        return None

    params = {
        "frequency": frequency,
        "data[0]": "value",
        f"facets[{facet_key}][0]": facet_value,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "length": SINGLE_FETCH_ROWS,
    }
    async with AsyncSession(
        base_url=BASE_URL, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        try:
            data = await _get(client, path, params)
        except (RequestException, ValueError) as exc:
            logger.warning("%s fetch failed: %s", what, exc)
            return None

    for row in data.get("response", {}).get("data", []):
        value = row.get("value")
        if value not in (None, ""):
            try:
                return float(value)
            except ValueError:
                continue
    return None


async def fetch_regional_gasoline() -> dict[str, float]:
    """{region_code: avg_regular_price}, $/gal."""
    return await _fetch_by_region(GASOLINE_PATH, GASOLINE_PRODUCT, "weekly", "regional gasoline benchmark")


async def fetch_wti_spot() -> float | None:
    """Most recent WTI (Cushing, OK) spot price, dollars per barrel."""
    return await _fetch_single(CRUDE_PATH, "daily", "series", WTI_SERIES, "WTI crude benchmark")


async def fetch_gasoline_stocks() -> dict[str, float]:
    """{region_code: stocks_mbbl} -- weekly US commercial gasoline
    inventory, thousand barrels."""
    return await _fetch_by_region(STOCKS_PATH, STOCKS_PRODUCT, "weekly", "gasoline stocks benchmark")


async def fetch_gasoline_demand() -> float | None:
    """Most recent weekly US finished-motor-gasoline product supplied --
    EIA's standard demand proxy, thousand barrels/day. National only."""
    return await _fetch_single(DEMAND_PATH, "weekly", "product", DEMAND_PRODUCT, "gasoline demand benchmark")


async def fetch_benchmarks() -> tuple[dict[str, float], float | None, dict[str, float], float | None]:
    """(regional gasoline prices, WTI spot, regional gasoline stocks,
    national gasoline demand) -- what scraper/jobs.py's refresh_benchmarks
    job writes to the four benchmark tables."""
    gasoline = await fetch_regional_gasoline()
    wti = await fetch_wti_spot()
    stocks = await fetch_gasoline_stocks()
    demand = await fetch_gasoline_demand()
    return gasoline, wti, stocks, demand


def region_for_state(state: str) -> str | None:
    """PADD (sub-)region code for a two-letter US state/DC code, or None for
    a state EIA's PADD geography doesn't cover (i.e. not a US state at
    all -- Canada/UK/international warehouses have no PADD region)."""
    return PADD_BY_STATE.get(state.upper())
