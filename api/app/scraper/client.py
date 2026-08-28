"""Plain-HTTP fetch against Costco's public warehouse-locator endpoint.

NOT what the live sweep job uses -- in production, Costco's Akamai-fronted
site silently drops plain httpx/curl requests regardless of source IP
(confirmed from two different real-world networks), so scraper/jobs.py goes
through scraper/browser.py's real Patchright/Chromium session instead. This
module is kept only as a quick manual diagnostic (worth re-checking
occasionally in case that protection ever eases) via
`python -m app.scraper.ingest --once --dry-run`, which does not touch the
queue or the database.
"""

import asyncio
import logging

import httpx

from ..config import settings
from .grid import grid_points

logger = logging.getLogger(__name__)

BASE_URL = "https://www.costco.com"
LOOKUP_PATH = "/AjaxWarehouseBrowseLookupView"

HEADERS = {
    "User-Agent": "costco-pump/0.1 (+https://ericdoo.com/costcogas -- personal gas-price tracker)",
    "Accept": "application/json",
}

MAX_ATTEMPTS = 3


async def fetch_point(client: httpx.AsyncClient, lat: float, lng: float) -> list[dict]:
    """Fetch and parse one grid point's warehouse list, with retry+backoff."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "hasGas": "true",
        "populateWarehouseDetails": "true",
        "countryCode": "US",
    }
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            resp = await client.get(LOOKUP_PATH, params=params)
            resp.raise_for_status()
            data = resp.json()
            # The response nests the warehouse list under a key that can vary
            # by Costco's front-end version -- accept a couple of likely
            # shapes rather than assuming one.
            if isinstance(data, list):
                return data
            for key in ("warehouses", "whsResponse", "data"):
                if isinstance(data.get(key), list):
                    return data[key]
            logger.warning("Unrecognized response shape from %s,%s: keys=%s", lat, lng, list(data)[:10])
            return []
        except (httpx.HTTPError, ValueError) as exc:
            if attempt == MAX_ATTEMPTS:
                logger.warning("Giving up on grid point %s,%s: %s", lat, lng, exc)
                return []
            await asyncio.sleep(0.5 * attempt)
    return []


async def sweep() -> list[dict]:
    """Fetch every grid point in-process and return deduplicated raw records.

    Manual/dry-run use only -- the hourly production path enqueues one job
    per point instead (see scraper/jobs.py + enqueuer.py).
    """
    points = grid_points(settings.grid_step_degrees)
    semaphore = asyncio.Semaphore(settings.scrape_concurrency)

    async def _bounded(client: httpx.AsyncClient, lat: float, lng: float) -> list[dict]:
        async with semaphore:
            return await fetch_point(client, lat, lng)

    async with httpx.AsyncClient(
        base_url=BASE_URL, headers=HEADERS, timeout=settings.scrape_timeout_seconds
    ) as client:
        results = await asyncio.gather(*(_bounded(client, lat, lng) for lat, lng in points))

    seen: dict[str, dict] = {}
    for batch in results:
        for raw in batch:
            wid = raw.get("warehouseNo") or raw.get("whsNumber") or raw.get("warehouseId") or raw.get("id")
            if wid is None:
                continue
            seen.setdefault(str(wid), raw)

    logger.info("Sweep complete: %d grid points, %d unique warehouses", len(points), len(seen))
    return list(seen.values())
