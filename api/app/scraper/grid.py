"""Lat/lng points to sweep so a 50-results-per-call warehouse lookup still
covers every Costco gas station in the US.

Costco's locator endpoint sorts results by distance from the point you give it
and caps the page at 50 warehouses, so one call from the middle of the country
would miss everything past the 50 nearest. Laying a grid across the continental
US (with a handful of hand-placed points for Alaska and Hawaii, which a regular
grid would otherwise skip) gives enough overlapping coverage that every
warehouse shows up in at least one response.
"""

# Hand-placed because a regular CONUS grid step never lands near these.
NON_CONUS_ANCHORS: list[tuple[float, float]] = [
    (61.2181, -149.9003),  # Anchorage, AK
    (64.8378, -147.7164),  # Fairbanks, AK
    (21.3069, -157.8583),  # Honolulu, HI
    (20.8783, -156.6825),  # Kahului, HI
]


def grid_points(step_degrees: int = 3) -> list[tuple[float, float]]:
    """CONUS lat/lng grid at `step_degrees` spacing, plus the non-CONUS anchors."""
    points = [
        (float(lat), float(lng))
        for lat in range(24, 50, step_degrees)
        for lng in range(-125, -66, step_degrees)
    ]
    points.extend(NON_CONUS_ANCHORS)
    return points
