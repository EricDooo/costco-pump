"""Persistent Playwright session used by the sweep job.

Costco's site is Akamai-protected and JS-challenge-gated -- plain httpx
requests (see client.py, now unused by the live path) get silently dropped
regardless of source IP. A real Chromium instance executing the page's
actual JS is what gets through, since it's genuinely just automating normal
browsing, not spoofing a fingerprint.

One browser/page is launched lazily on the first job and reused for the
worker process's entire lifetime -- launching Chromium fresh for each of the
~184 sweep jobs/hour would be real, avoidable CPU/memory cost on a shared
2-vCPU box. Reuse requires everything to run on one persistent event loop
(see worker.py's run_coro) rather than a fresh loop per job, since a
Playwright browser is tied to the loop that created it.
"""

import asyncio
import logging

from playwright.async_api import Page, async_playwright

logger = logging.getLogger(__name__)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_page: Page | None = None
_init_lock = asyncio.Lock()

# Fetches inside the page's own JS context (see fetch_grid_point) so the
# request carries the already-loaded page's cookies/session -- same as any
# AJAX call a real visitor's browser would make after the page loads.
_FETCH_JS = """async (url) => {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
}"""


async def _get_page() -> Page:
    global _page
    async with _init_lock:
        if _page is not None:
            return _page
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=_UA)
        page = await context.new_page()
        await page.goto(
            "https://www.costco.com/warehouse-locator",
            wait_until="networkidle",
            timeout=45_000,
        )
        logger.info("Playwright session established")
        _page = page
        return page


async def fetch_grid_point(lat: float, lng: float) -> list[dict]:
    global _page
    url = (
        "/AjaxWarehouseBrowseLookupView"
        f"?latitude={lat}&longitude={lng}&hasGas=true"
        "&populateWarehouseDetails=true&countryCode=US"
    )
    try:
        page = await _get_page()
        raw = await page.evaluate(_FETCH_JS, url)
    except Exception:
        # The page/context/browser died (crash, navigated away, killed by
        # Costco) -- drop it so the next call re-establishes a fresh
        # session instead of retrying against a known-broken one.
        logger.warning("Grid point %s,%s failed; resetting session", lat, lng, exc_info=True)
        _page = None
        return []

    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    for key in ("warehouses", "whsResponse", "data"):
        if isinstance(raw.get(key), list):
            return raw[key]
    return []
