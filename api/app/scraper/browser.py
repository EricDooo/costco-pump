"""Persistent Patchright session used by the sweep job.

Costco's site is Akamai-protected and JS-challenge-gated -- plain httpx
requests (see client.py, now unused by the live path) get silently dropped
regardless of source IP, and stock Playwright's automation tells
(navigator.webdriver, CDP artifacts, etc.) get it flagged and blocked too.
Patchright (a patched Playwright fork, same API) strips those tells, so the
session reads as an ordinary Chromium browsing session instead of an
instrumented one -- that's a deliberate choice to get past Akamai's bot
protection, not a side effect.

Two things patchright's own docs call out as necessary to actually get that
benefit, both different from the old Playwright setup below:
  - launch_persistent_context() instead of launch()+new_context() -- a
    profile-backed launch reads as a real Chrome session; a fresh incognito
    context is itself a fingerprint signal.
  - no custom user_agent override -- patchright derives UA/header details
    from the real patched binary; overriding it reintroduces a mismatch
    between the UA string and the browser's actual fingerprint.
Staying headless=True despite patchright's docs preferring a headed browser
is a deliberate tradeoff for this box: there's no display and no Xvfb in the
image, so going headed would mean adding that to the worker Dockerfile. If
Costco's challenge still blocks the headless profile, that's the next lever.

One browser/page is launched lazily on the first job and reused for the
worker process's entire lifetime -- launching Chromium fresh for each of the
~184 sweep jobs/hour would be real, avoidable CPU/memory cost on a shared
2-vCPU box. Reuse requires everything to run on one persistent event loop
(see worker.py's run_coro) rather than a fresh loop per job, since a
Patchright browser is tied to the loop that created it.
"""

import asyncio
import logging
import tempfile
from pathlib import Path

from patchright.async_api import BrowserContext, Page, async_playwright

logger = logging.getLogger(__name__)

# A real (if throwaway) profile dir -- launch_persistent_context requires
# one. Doesn't need to survive container restarts: losing it just means the
# next warm-up starts from a clean profile instead of a warmed-up one,
# exactly like a fresh install would.
_USER_DATA_DIR = Path(tempfile.gettempdir()) / "costco-pump-patchright-profile"

_page: Page | None = None
_context: BrowserContext | None = None
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
    global _page, _context
    async with _init_lock:
        if _page is not None:
            return _page
        playwright = await async_playwright().start()
        _context = await playwright.chromium.launch_persistent_context(
            user_data_dir=str(_USER_DATA_DIR),
            headless=True,
        )
        page = await _context.new_page()
        await page.goto(
            "https://www.costco.com/warehouse-locator",
            wait_until="networkidle",
            timeout=45_000,
        )
        logger.info("Patchright session established")
        _page = page
        return page


async def warm_up() -> None:
    """Establish the session up front, at worker startup -- not lazily on
    whatever job happens to run first. Launching Chromium + a networkidle
    page load can take longer than RQ's default 180s job timeout on its
    own; paying that cost during startup (uncounted against any job) rather
    than inside the first scrape_grid_point call is what actually fixes
    that, not just a bigger timeout number."""
    await _get_page()


async def fetch_grid_point(lat: float, lng: float) -> list[dict]:
    global _page, _context
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
        if _context is not None:
            try:
                await _context.close()
            except Exception:
                # Already dead in whatever way killed the page above --
                # nothing left to release.
                pass
        _page = None
        _context = None
        return []

    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    for key in ("warehouses", "whsResponse", "data"):
        if isinstance(raw.get(key), list):
            return raw[key]
    return []
