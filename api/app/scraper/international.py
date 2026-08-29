"""Fetch against Costco's international sites -- everywhere outside the
US/Canada/UK cluster scraper/client.py handles.

Those countries run a completely different platform: SAP Commerce Cloud,
confirmed by finding "Spartacus" (SAP's storefront framework) in
costco.com.au's own JS bundle while investigating why the US-linked system
never returned real data for these countries. Its REST API is, unlike
everything in client.py, actually clean: one call per country returns
every warehouse, complete with address, hours, AND live gas prices already
embedded -- no grid, no batching, no silent truncation to work around.

  GET https://www.<country-domain>/rest/v2/<country>/stores
      ?fields=FULL&query=<country>&radius=3000000
      &returnAllStores=true&pageSize=999

Confirmed real, country-appropriate results (not the same-fallback-country
symptom client.py's docstring describes) for the eight countries below;
costco.com.cn returned an HTML page at this path instead of JSON (China
runs on yet another, unrelated platform, out of scope here) so isn't
included. Korea has zero GAS_STATION services at all in this data, and
France/Spain have the service listed but no gasTypes price array -- not
bugs, just genuinely no price data available there right now. Rather than
special-case excluding those three, COUNTRIES includes all eight and the
has-gas filter below (checking for actual gasTypes price entries, not just
the service tag) naturally yields zero records for them; if Costco ever
starts exposing prices there this picks it up with no code change.

ID collisions: this API's own IDs (`warehouseCode`) are small clean
integers in some countries (Australia's is "107") but descriptive strings
in others (Japan's is "CostcoJapanMinamiAlpsiWarehouse"), and none of them
know about the numbering the US/CA/UK system uses -- an Australian "107"
and a US warehouse 107 are two different real places. So _derive_id hashes
each country's native code into a small, stable, per-country block of the
shared `warehouses.id` space (see the offsets in COUNTRIES) rather than
using warehouseCode directly. Deterministic -- the same warehouse always
lands on the same id across runs -- and collision risk is negligible at a
few dozen warehouses per 9,000-slot block, but it does mean this id has no
meaning to Costco itself the way the US system's does.
"""

import asyncio
import logging
import re

import zlib

from curl_cffi.const import CurlIpResolve, CurlOpt
from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import RequestException

from ..config import settings

logger = logging.getLogger(__name__)

# (country slug for the API's own `query`/path segment, site domain,
# offset into warehouses.id's shared integer space -- see module
# docstring's "ID collisions" section). 10,000-wide blocks per country --
# the largest seen so far (Mexico) has 44 warehouses.
COUNTRIES: list[tuple[str, str, int]] = [
    ("australia", "costco.com.au", 900_000),
    ("japan", "costco.co.jp", 910_000),
    ("mexico", "costco.com.mx", 920_000),
    ("taiwan", "costco.com.tw", 930_000),
    ("spain", "costco.es", 940_000),
    ("france", "costco.fr", 950_000),
    ("korea", "costco.co.kr", 960_000),
    ("iceland", "costco.is", 970_000),
]

STORES_PATH_TEMPLATE = "/rest/v2/{country}/stores"
STORES_PARAMS = {
    "fields": "FULL",
    "radius": 3_000_000,
    "returnAllStores": "true",
    "pageSize": 999,
}

HEADERS = {"Accept": "application/json"}
IMPERSONATE = "chrome131"
CURL_OPTIONS = {CurlOpt.IPRESOLVE: CurlIpResolve.V4}

_DIESEL_KEYWORDS = ("diesel", "gazole", "gasóleo", "gasoleo")
_EXCLUDE_KEYWORDS = ("kerosene",)

MAX_ATTEMPTS = 3


def _derive_id(offset: int, code: str) -> int:
    """A stable, per-country-block integer for a warehouse whose own code
    isn't reliably a small int -- see module docstring's "ID collisions"."""
    return offset + (zlib.crc32(code.encode()) % 9_000) + 1


def _parse_price(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return float(re.sub(r"[^\d.]", "", raw))
    except ValueError:
        return None


def _match_gas_types(gas_types: list[dict]) -> dict[str, float | None]:
    """Map a store's gasTypes (name/price pairs -- English words in some
    countries, raw octane numbers in others, e.g. Taiwan's "95"/"98") to
    regular/premium/diesel. Diesel is reliably labeled as such everywhere
    seen, even where the other grades are just numbers; kerosene (a
    heating fuel, seen in Japan) is dropped. Whatever's left is sorted by
    price -- cheapest is regular, priciest is premium -- which works
    whether a country spells it out or just gives an octane number, since
    higher octane costs more everywhere observed.
    """
    diesel = None
    candidates: list[float] = []
    for g in gas_types or []:
        name = (g.get("name") or "").lower()
        price = _parse_price(g.get("price"))
        if any(kw in name for kw in _DIESEL_KEYWORDS):
            diesel = price
        elif any(kw in name for kw in _EXCLUDE_KEYWORDS):
            continue
        elif price is not None:
            candidates.append(price)
    candidates.sort()
    regular = candidates[0] if candidates else None
    premium = candidates[-1] if len(candidates) > 1 else None
    return {"regular": regular, "premium": premium, "diesel": diesel}


def _format_hours(store: dict) -> list[str] | None:
    """Store-level openingHours.weekDayOpeningList -- structurally
    consistent across countries even though the weekDay abbreviations
    themselves are locale-specific (Mexico's "dom"/"lun" vs an English
    site's "Sun"/"Mon")."""
    week = ((store.get("openingHours") or {}).get("weekDayOpeningList")) or []
    lines = []
    for day in week:
        if day.get("closed"):
            continue
        weekday = day.get("weekDay")
        open_ = (day.get("openingTime") or {}).get("formattedHour")
        close = (day.get("closingTime") or {}).get("formattedHour")
        if weekday and open_ and close:
            lines.append(f"{weekday}: {open_}-{close}")
    return lines or None


def _normalize(store: dict, offset: int) -> dict:
    """Flatten one SAP store record into the flat shape
    ingest.parse_warehouse expects -- same field names client.py's US/CA/UK
    records use, so ingest.py needed no changes for this either."""
    address = store.get("address") or {}
    geo = store.get("geoPoint") or {}
    prices = _match_gas_types(store.get("gasTypes") or [])
    code = str(store.get("warehouseCode") or store.get("name") or "")
    return {
        "warehouseNo": str(_derive_id(offset, code)),
        "warehouseName": store.get("displayName") or store.get("name") or "Costco",
        "address1": address.get("line1"),
        "city": address.get("town"),
        "state": (address.get("country") or {}).get("isocode"),
        "zipCode": address.get("postalCode"),
        "latitude": geo.get("latitude"),
        "longitude": geo.get("longitude"),
        "regularPrice": prices["regular"],
        "premiumPrice": prices["premium"],
        "dieselPrice": prices["diesel"],
        "hours": _format_hours(store),
    }


async def fetch_country(country: str, domain: str, offset: int) -> list[dict]:
    """Every gas warehouse in one country, normalized and ready for
    ingest.parse_warehouse -- location, hours, AND price all in this one
    call, unlike the US/CA/UK system. Filters to stores with actual
    gasTypes price entries (not just a GAS_STATION service tag) -- see
    module docstring for why that's the right filter here."""
    headers = {**HEADERS}
    params = {**STORES_PARAMS, "query": country}
    path = STORES_PATH_TEMPLATE.format(country=country)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            async with AsyncSession(
                base_url=f"https://www.{domain}",
                impersonate=IMPERSONATE,
                curl_options=CURL_OPTIONS,
                timeout=settings.scrape_timeout_seconds,
            ) as client:
                resp = await client.get(path, params=params, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            stores = [s for s in (data.get("stores") or []) if s.get("gasTypes")]
            return [_normalize(s, offset) for s in stores]
        except (RequestException, ValueError) as exc:
            if attempt == MAX_ATTEMPTS:
                logger.warning("Giving up on %s: %s", country, exc)
                return []
            await asyncio.sleep(0.5 * attempt)
    return []


async def fetch_all() -> list[dict]:
    """Every gas warehouse across all confirmed-working international
    countries, normalized. Manual/dry-run use only -- the hourly
    production path enqueues one job per country instead (see
    scraper/jobs.py's refresh_international_country + enqueuer.py)."""
    records: list[dict] = []
    for country, domain, offset in COUNTRIES:
        records.extend(await fetch_country(country, domain, offset))
    return records
