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
