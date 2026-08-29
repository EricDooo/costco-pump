"""Lat/lng points to sweep so a 50-results-per-call warehouse lookup still
covers every Costco gas station the locator endpoint actually knows about --
the US, Canada, and the UK (see below for why not more).

Costco's locator endpoint sorts results by distance from the point you give it
and caps the page at 50 warehouses, so one call from the middle of a country
would miss everything past the 50 nearest. A regular grid handles this well
for the US, where warehouses are dense and spread across a huge area; laying
one across the continental US (plus hand-placed points for Alaska and Hawaii,
which a regular grid step skips) gives enough overlapping coverage that every
US warehouse shows up in at least one response.

Costco operates in more countries than that, but salesLocations.json
doesn't actually index all of them -- confirmed empirically by querying
near a major city in each country Costco lists and checking whether real
local warehouses came back or a distant country's did instead (the
locator falls back to "nearest available" rather than returning nothing):

  - Canada: real results (Victoria, Langley, Abbotsford near Vancouver)
  - United Kingdom: real results (Surrey, Watford, Southampton near London)
  - Mexico: fell back to south Texas (San Antonio, Pharr) near Mexico City
  - Japan, South Korea, Taiwan, China: fell back to Hawaii/Alaska
  - Australia: fell back to Hawaii
  - Spain, France, Iceland: fell back to the UK

So only Canada and the UK get international anchors below, alongside the
US's Alaska/Hawaii -- anchors for the others would just re-discover
warehouses this project already finds some other way, not their country's
real locations, which apparently aren't in this system at all.
"""

# Hand-placed because a regular CONUS grid step never lands near these, or
# because the whole country doesn't need (and would waste requests on) a
# full grid -- one or two points per major metro area is enough to pull in
# that country's entire Costco footprint within the locator's 50-result cap.
NON_CONUS_ANCHORS: list[tuple[float, float]] = [
    (61.2181, -149.9003),  # Anchorage, AK
    (64.8378, -147.7164),  # Fairbanks, AK
    (21.3069, -157.8583),  # Honolulu, HI
    (20.8783, -156.6825),  # Kahului, HI
    # Canada
    (49.2827, -123.1207),  # Vancouver, BC
    (51.0447, -114.0719),  # Calgary, AB
    (53.5461, -113.4938),  # Edmonton, AB
    (49.8951, -97.1384),  # Winnipeg, MB
    (43.6532, -79.3832),  # Toronto, ON
    (45.4215, -75.6972),  # Ottawa, ON
    (45.5017, -73.5673),  # Montreal, QC
    (46.8139, -71.2080),  # Quebec City, QC
    (44.6488, -63.5752),  # Halifax, NS
    # United Kingdom
    (51.5074, -0.1278),  # London
    (53.4808, -2.2426),  # Manchester
    (52.4862, -1.8904),  # Birmingham
    (55.8642, -4.2518),  # Glasgow
]


def grid_points(step_degrees: int = 3) -> list[tuple[float, float]]:
    """CONUS lat/lng grid at `step_degrees` spacing, plus the non-CONUS
    (Alaska, Hawaii) and international anchors."""
    points = [
        (float(lat), float(lng))
        for lat in range(24, 50, step_degrees)
        for lng in range(-125, -66, step_degrees)
    ]
    points.extend(NON_CONUS_ANCHORS)
    return points
