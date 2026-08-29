"""Fetch against Costco's public warehouse-locator and gas-price APIs --
what the live sweep job uses, and all it's ever needed.

The old locator endpoint this module used to call (AjaxWarehouseBrowseLookupView)
is gone -- Costco rebuilt the site's frontend and replaced it with two separate
public endpoints, found by reading the API-route manifest embedded in the
site's own JS bundle (the same way a browser's dev tools would show it):

  - ecom-api.costco.com/core/warehouse-locator/v1/salesLocations.json --
    location, hours, and services (including whether a warehouse has a gas
    station) by lat/lng. Same 50-results-per-page cap as the old endpoint,
    so the same grid-sweep approach in grid.py still applies. The
    `client-identifier` header below isn't a secret -- it's the same public
    tag the site's own frontend sends, lifted straight from that manifest.
  - www.costco.com/AjaxGetGasPricesService -- live prices, batched by
    warehouse ID (`_`-joined, same delimiter Costco's own frontend uses).

A third source, not an API call at all: www.costco.com/w/-/locations's own
page bundle embeds a static manifest of every warehouse ID Costco has (see
ID_MANIFEST_PATH below). That's the price sweep's ID source now, cached
rather than re-derived from the grid every time -- see
fetch_all_warehouse_ids.

Neither sits behind Akamai's bot-management gate the old endpoint did --
confirmed no WAF block, no JS-sensor challenge, both fully public and
unauthenticated. What they DO have: a plain `httpx` request to either one
just times out with no response at all, while the identical request
succeeds instantly through curl, or through curl_cffi (below) impersonating
a real browser's TLS handshake. That's a client-fingerprint filter on
Costco's edge somewhere, not an active bot-detection system with a
challenge to solve -- there's nothing to defeat, just a TLS handshake that
needs to look like a browser's to get a response at all. Hence curl_cffi
instead of httpx here, unlike the rest of this project.

Two calls instead of one means this module does its own merge (_normalize)
to hand ingest.parse_warehouse the same flat shape it always has -- see
ingest.py, which didn't need to change at all for this swap.
"""

import asyncio
import logging
import re
from typing import Any

from curl_cffi.const import CurlIpResolve, CurlOpt
from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import RequestException

from ..config import settings
from .grid import grid_points

logger = logging.getLogger(__name__)

LOCATOR_BASE_URL = "https://ecom-api.costco.com"
LOCATOR_PATH = "/core/warehouse-locator/v1/salesLocations.json"
# Public client tag Costco's own frontend sends with this call -- see the
# module docstring; not a credential, just an identifier for their routing.
LOCATOR_CLIENT_ID = "7c71124c-7bf1-44db-bc9d-498584cd66e5"

PRICES_BASE_URL = "https://www.costco.com"
PRICES_PATH = "/AjaxGetGasPricesService"
# Matches the batch size Costco's own locator page uses for one price call.
PRICE_BATCH_SIZE = 50

# The full warehouse-locations page -- any query string, any path under
# /w/-/locations, returns the identical Next.js bundle (confirmed: same
# byte count, same content, regardless of location) -- so this is fetched
# with no query at all. Buried in it is a static manifest of every
# warehouse Costco has, as `<id>-wh` slugs (a routing/typeahead list, not
# per-warehouse data -- no address or coordinates, just IDs). That's the
# authoritative ID source now (see get_warehouse_ids in enqueuer.py's
# caller), replacing the grid as how the price sweep knows what to ask
# AjaxGetGasPricesService for. The grid still exists (fetch_grid_point/
# sweep below) because address/lat-lon/hours only come from
# salesLocations.json, which takes lat/lng, not an ID -- confirmed by
# testing salesLocationId as a query param directly (400 Bad Request).
ID_MANIFEST_PATH = "/w/-/locations"
ID_MANIFEST_PATTERN = re.compile(r"(\d{1,6})-wh")

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

MAX_ATTEMPTS = 3


def _has_gas(location: dict) -> bool:
    return any(s.get("code") == "gas" for s in location.get("services") or [])


async def _fetch_locations(client: AsyncSession, lat: float, lng: float) -> list[dict]:
    """One grid point's nearby sales locations, with retry+backoff --
    filtered down to warehouses that actually have a gas station."""
    params = {"latitude": lat, "longitude": lng, "limit": 50}
    headers = {**HEADERS, "client-identifier": LOCATOR_CLIENT_ID}
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = await client.get(LOCATOR_PATH, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            locations = data.get("salesLocations") or []
            return [loc for loc in locations if _has_gas(loc)]
        except (RequestException, ValueError) as exc:
            if attempt == MAX_ATTEMPTS:
                logger.warning("Giving up on grid point %s,%s: %s", lat, lng, exc)
                return []
            await asyncio.sleep(0.5 * attempt)
    return []


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


def _format_hours(location: dict) -> list[str] | None:
    entries = location.get("hours") or []
    lines = []
    for h in entries:
        title = (h.get("title") or [{}])[0].get("value", "")
        open_, close = h.get("open"), h.get("close")
        if title and open_ and close:
            lines.append(f"{title}: {open_}-{close}")
    return lines or None


def _normalize(location: dict, prices: dict[str, dict]) -> dict:
    """Flatten one salesLocations entry (+ its matched price batch entry,
    if any) into the flat shape ingest.parse_warehouse expects -- same field
    names the old Costco payload used, so ingest.py needed no changes."""
    address = location.get("address") or {}
    wid = str(location.get("salesLocationId") or "")
    price = prices.get(wid) or {}
    name: list[dict[str, Any]] = location.get("name") or []
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
        "hours": _format_hours(location),
    }


async def fetch_all_warehouse_ids() -> list[int]:
    """Every warehouse ID Costco's own site knows about -- see
    ID_MANIFEST_PATH's comment above for where this comes from. Cached by
    the caller (enqueuer.py, via app.cache) rather than re-fetched every
    sweep; warehouse counts change rarely enough that a fresh page load
    each time would be wasted work, not freshness."""
    async with AsyncSession(
        base_url=PRICES_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        try:
            resp = await client.get(ID_MANIFEST_PATH, headers=HEADERS)
            resp.raise_for_status()
        except RequestException as exc:
            logger.warning("Failed to fetch the warehouse ID manifest: %s", exc)
            return []
    ids = {int(m) for m in ID_MANIFEST_PATTERN.findall(resp.text)}
    return sorted(ids)


async def fetch_prices(ids: list[str]) -> dict[str, dict]:
    """Live prices for a batch of already-known warehouse IDs (at most
    PRICE_BATCH_SIZE -- enqueuer.py splits the full ID list into batches
    this size, one job per batch). This is the fast, frequent hourly path:
    no locator call at all -- see fetch_all_warehouse_ids for where the IDs
    come from instead."""
    async with AsyncSession(
        base_url=PRICES_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        return await _fetch_prices(client, ids)


async def fetch_grid_point(lat: float, lng: float) -> list[dict]:
    """One grid point, fully resolved: nearby gas warehouses plus their
    current prices, normalized and ready for ingest.parse_warehouse. This is
    the metadata-sweep path (scraper/jobs.py's scrape_grid_point) --
    discovers new/closed warehouses and refreshes address/hours, run daily
    rather than hourly (see enqueuer.py)."""
    async with AsyncSession(
        base_url=LOCATOR_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as locator_client:
        locations = await _fetch_locations(locator_client, lat, lng)
    if not locations:
        return []

    ids = [str(loc.get("salesLocationId")) for loc in locations if loc.get("salesLocationId")]
    async with AsyncSession(
        base_url=PRICES_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as prices_client:
        prices = await _fetch_prices(prices_client, ids)

    return [_normalize(loc, prices) for loc in locations]


async def sweep() -> list[dict]:
    """Fetch every grid point in-process and return deduplicated, normalized
    records. Manual/dry-run use only -- the hourly production path enqueues
    one job per point instead (see scraper/jobs.py + enqueuer.py). Batches
    price lookups across the whole deduplicated ID set rather than per grid
    point, since this path isn't split across separate jobs anyway.
    """
    points = grid_points(settings.grid_step_degrees)
    semaphore = asyncio.Semaphore(settings.scrape_concurrency)

    async def _bounded(client: AsyncSession, lat: float, lng: float) -> list[dict]:
        async with semaphore:
            return await _fetch_locations(client, lat, lng)

    async with AsyncSession(
        base_url=LOCATOR_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        results = await asyncio.gather(*(_bounded(client, lat, lng) for lat, lng in points))

    seen: dict[str, dict] = {}
    for batch in results:
        for loc in batch:
            wid = str(loc.get("salesLocationId") or "")
            if wid:
                seen.setdefault(wid, loc)

    ids = list(seen.keys())
    prices: dict[str, dict] = {}
    async with AsyncSession(
        base_url=PRICES_BASE_URL, impersonate=IMPERSONATE, curl_options=CURL_OPTIONS, timeout=settings.scrape_timeout_seconds
    ) as client:
        for i in range(0, len(ids), PRICE_BATCH_SIZE):
            prices.update(await _fetch_prices(client, ids[i : i + PRICE_BATCH_SIZE]))

    logger.info(
        "Sweep complete: %d grid points, %d unique gas warehouses, %d with prices",
        len(points), len(seen), len(prices),
    )
    return [_normalize(loc, prices) for loc in seen.values()]
