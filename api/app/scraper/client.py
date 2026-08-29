"""Fetch against Costco's public warehouse-locator and gas-price APIs --
what the live sweep job uses, and all it's ever needed. Two calls, that's it:

  - ecom-api.costco.com/core/warehouse-locator/v1/warehouses.json --
    every US/Canada/UK warehouse in ONE call. The API-route manifest
    embedded in the site's own JS bundle only documented this endpoint's
    sibling, salesLocations.json -- lat/lng-based, capped at 50 results a
    page, which is why this project spent a whole night building a
    geographic grid-sweep system around it. warehouses.json was never
    mentioned in that manifest at all; found by trying plausible parameter
    names against it directly. It paginates by plain `offset`/`limit`
    instead of lat/lng, and asking for limit=1000 just returns all 797
    warehouses with lastPage:true in one shot -- no grid, no per-point
    fetching, no pacing needed for metadata at all anymore.
  - www.costco.com/AjaxGetGasPricesService -- live prices, batched by
    warehouse ID (`_`-joined). Silently caps its response at 10 no matter
    how many IDs are requested -- confirmed empirically (asked for 10, 15,
    20, 25 in one call; got exactly 10 back every time, no truncation
    flag, no error).

Neither sits behind Akamai's bot-management gate the old (now-dead)
locator endpoint did -- confirmed no WAF block, no JS-sensor challenge,
both fully public and unauthenticated. What they DO have: a plain `httpx`
request to either one just times out with no response at all, while the
identical request succeeds instantly through curl, or through curl_cffi
(below) impersonating a real browser's TLS handshake. That's a
client-fingerprint filter on Costco's edge somewhere, not an active
bot-detection system with a challenge to solve -- there's nothing to
defeat, just a TLS handshake that needs to look like a browser's to get a
response at all. Hence curl_cffi instead of httpx here, unlike the rest of
this project.

This only covers US, Canada, and UK warehouses -- confirmed the only
countries this system actually indexes (querying near Mexico, Japan,
Korea, Taiwan, Australia, Spain, France, or Iceland all fall back to the
nearest indexed country's warehouses instead of returning nothing).
Everywhere else Costco operates runs on a completely separate platform
(SAP Commerce Cloud, its own complete-in-one-call REST API per country,
prices included) -- out of scope here.
"""

import logging
from typing import Any

from curl_cffi.const import CurlIpResolve, CurlOpt
from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import RequestException

from ..config import settings

logger = logging.getLogger(__name__)

LOCATOR_BASE_URL = "https://ecom-api.costco.com"
WAREHOUSES_PATH = "/core/warehouse-locator/v1/warehouses.json"
# Public client tag Costco's own frontend sends with this call -- not a
# credential, just an identifier for their routing; lifted from the
# API-route manifest embedded in the site's JS bundle.
LOCATOR_CLIENT_ID = "7c71124c-7bf1-44db-bc9d-498584cd66e5"
# High enough to cover the whole database in one page -- confirmed 797
# total warehouses, lastPage:true at this limit (see fetch_all_warehouses,
# which logs a warning if that ever stops being true -- Costco's US/CA/UK
# footprint growing past this would mean warehouses silently go missing
# rather than erroring, so that log line is the only thing that would
# catch it).
WAREHOUSES_LIMIT = 1000

PRICES_BASE_URL = "https://www.costco.com"
PRICES_PATH = "/AjaxGetGasPricesService"
PRICE_BATCH_SIZE = 10

HEADERS = {
    "Accept": "application/json",
}
# A specific, pinned Chrome version rather than "latest" -- curl_cffi ships a
# fixed set of fingerprints, and pinning here keeps behavior reproducible
# across curl_cffi upgrades instead of silently changing.
#
# Deliberately no custom User-Agent here (this project's other HTTP calls
# self-identify with one) -- curl_cffi's impersonation sets its own,
# consistent with the TLS handshake it's also matching. Overriding it with a
# self-identifying UA breaks that consistency (TLS says Chrome 131, header
# says a bot script) and got silently dropped every time in testing;
# stripping it out is what actually fixed that, not a longer timeout.
IMPERSONATE = "chrome131"

# Both Costco hosts resolve to both an A and an AAAA record, but this
# project's Docker networks (costco-pump_egress/_backend) have IPv6
# disabled -- no route, no interface. A client that tries the AAAA address
# doesn't get a fast "network unreachable"; it just hangs until the OS-level
# TCP connect eventually gives up, which is minutes, not seconds. Forcing
# IPv4 here is what actually fixed the multi-minute silent hangs seen in
# production -- confirmed by reproducing the exact hang on the real
# `egress` network and watching CurlIpResolve.V4 fix it in place.
CURL_OPTIONS = {CurlOpt.IPRESOLVE: CurlIpResolve.V4}


def _has_gas(warehouse: dict) -> bool:
    return any(s.get("code") == "gas" for s in warehouse.get("services") or [])


def _format_hours(warehouse: dict) -> list[str] | None:
    entries = warehouse.get("hours") or []
    lines = []
    for h in entries:
        title = (h.get("title") or [{}])[0].get("value", "")
        open_, close = h.get("open"), h.get("close")
        if title and open_ and close:
            lines.append(f"{title}: {open_}-{close}")
    return lines or None


def _normalize(warehouse: dict, prices: dict[str, dict]) -> dict:
    """Flatten one warehouses.json entry (+ its matched price batch entry,
    if any) into the flat shape ingest.parse_warehouse expects -- same
    field names the old Costco payload used, so ingest.py needed no
    changes across any of tonight's rewrites."""
    address = warehouse.get("address") or {}
    wid = str(warehouse.get("warehouseId") or "")
    price = prices.get(wid) or {}
    name: list[dict[str, Any]] = warehouse.get("name") or []
    return {
        "warehouseNo": wid,
        "warehouseName": (name[0].get("value") if name else None) or f"Costco #{wid}",
        "address1": address.get("line1"),
        "city": address.get("city"),
        "state": address.get("territory"),
        "zipCode": address.get("postalCode"),
        "latitude": address.get("latitude"),
        "longitude": address.get("longitude"),
        "regularPrice": price.get("regular"),
        "premiumPrice": price.get("premium"),
        "dieselPrice": price.get("diesel"),
        "hours": _format_hours(warehouse),
    }


async def fetch_all_warehouses() -> list[dict]:
    """Every US/Canada/UK gas-station warehouse, normalized and ready for
    ingest.parse_warehouse -- one call, no grid, no prices (that's the
    separate, batched price sweep's job; see fetch_prices below). This is
    what both scraper/jobs.py's refresh_metadata (upserts location/hours)
    and enqueuer.py's price sweep (just needs the ID list) call."""
    headers = {**HEADERS, "client-identifier": LOCATOR_CLIENT_ID}
    async with AsyncSession(
        base_url=LOCATOR_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        try:
            resp = await client.get(WAREHOUSES_PATH, params={"offset": 0, "limit": WAREHOUSES_LIMIT}, headers=headers)
            resp.raise_for_status()
        except RequestException as exc:
            logger.warning("Failed to fetch the warehouse list: %s", exc)
            return []

    data = resp.json()
    if not data.get("context", {}).get("lastPage"):
        logger.warning(
            "warehouses.json didn't report lastPage=true at limit=%d -- Costco's US/CA/UK footprint may have grown "
            "past this page size; some warehouses could be silently missing from this sweep",
            WAREHOUSES_LIMIT,
        )

    warehouses = [w for w in (data.get("warehouses") or []) if _has_gas(w)]
    return [_normalize(w, {}) for w in warehouses]


async def _fetch_prices(client: AsyncSession, ids: list[str]) -> dict[str, dict]:
    """Live prices for a batch of warehouse IDs -- {id: {regular, premium,
    diesel}}, whichever of those three a given warehouse actually has."""
    if not ids:
        return {}
    params = {"warehouseid": "_".join(ids)}
    try:
        resp = await client.get(PRICES_PATH, params=params, headers=HEADERS)
        resp.raise_for_status()
        return resp.json()
    except (RequestException, ValueError) as exc:
        logger.warning("Price fetch failed for %d warehouses: %s", len(ids), exc)
        return {}


async def fetch_prices(ids: list[str]) -> dict[str, dict]:
    """Live prices for a batch of warehouse IDs (at most PRICE_BATCH_SIZE
    -- enqueuer.py splits the full ID list into batches this size, one job
    per batch)."""
    async with AsyncSession(
        base_url=PRICES_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        return await _fetch_prices(client, ids)


async def sweep() -> list[dict]:
    """Fetch every warehouse plus its current price in one pass, normalized.
    Manual/dry-run use only -- the hourly production path runs metadata and
    price refreshes as two separate, independent jobs instead (see
    scraper/jobs.py + enqueuer.py).
    """
    records = await fetch_all_warehouses()
    ids = [r["warehouseNo"] for r in records if r["warehouseNo"]]

    prices: dict[str, dict] = {}
    async with AsyncSession(
        base_url=PRICES_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        for i in range(0, len(ids), PRICE_BATCH_SIZE):
            prices.update(await _fetch_prices(client, ids[i : i + PRICE_BATCH_SIZE]))

    for r in records:
        p = prices.get(r["warehouseNo"]) or {}
        r["regularPrice"] = p.get("regular")
        r["premiumPrice"] = p.get("premium")
        r["dieselPrice"] = p.get("diesel")

    logger.info("Sweep complete: %d gas warehouses, %d with prices", len(records), len(prices))
    return records
