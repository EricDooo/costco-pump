import datetime as dt

from pydantic import BaseModel


class StationSummary(BaseModel):
    id: int
    name: str
    address: str
    city: str
    state: str
    zip_code: str
    lat: float
    lon: float
    regular_price: float | None
    premium_price: float | None
    diesel_price: float | None
    as_of: dt.datetime | None
    # regular_price at or below its own 7-day low -- see stations.py's
    # _is_7d_low.
    is_7d_low: bool

    model_config = {"from_attributes": True}


class PricePoint(BaseModel):
    time: dt.datetime
    regular_price: float | None
    premium_price: float | None
    diesel_price: float | None


class DepartmentPhone(BaseModel):
    name: str
    phone: str


class StationDetail(StationSummary):
    history: list[PricePoint]
    hours: list[str] | None
    gas_hours: list[str] | None
    opened_date: dt.date | None
    phone: str | None
    services: list[str] | None
    programs: list[str] | None
    department_phones: list[DepartmentPhone] | None


class StateStat(BaseModel):
    state: str
    avg_regular_price: float


class MonthlyAverage(BaseModel):
    month: str
    avg_regular_price: float


class StatsSummary(BaseModel):
    tracked_days: int
    total_price_moves: int
    hikes: int
    cuts: int
    cheapest_states: list[StateStat]
    priciest_states: list[StateStat]
    monthly_averages: list[MonthlyAverage]


class TrendPoint(BaseModel):
    date: str
    median_regular: float | None
    median_premium: float | None
    median_diesel: float | None
    stations_reporting: int


class TrendSummary(BaseModel):
    points: list[TrendPoint]
    current_median: float | None
    stations_reporting: int
    # Dollars, current minus the value `days` ago -- null until the window
    # has two real endpoints to compare.
    move: float | None
    latest_day_hikes: int
    latest_day_cuts: int


class StateChangeStat(BaseModel):
    state: str
    hikes: int
    cuts: int
    avg_change: float
    biggest_move: float


class StateFuelStat(BaseModel):
    state: str
    avg_regular: float | None
    avg_premium: float | None
    avg_diesel: float | None
    station_count: int


class RegionalComparison(BaseModel):
    state: str
    region_code: str
    costco_avg_regular: float
    region_avg_regular: float
    # region_avg_regular - costco_avg_regular -- positive means Costco is
    # cheaper than its EIA PADD region's non-Costco average.
    savings: float
    station_count: int


class BenchmarkSummary(BaseModel):
    as_of: dt.datetime | None
    national_avg_regular_price: float | None
    # Costco's own US-wide average regular price, station-count-weighted --
    # same 7-day window _states_sql already uses, just rolled up.
    national_costco_avg_regular_price: float | None
    national_savings: float | None
    wti_spot_price: float | None
    by_state: list[RegionalComparison]
