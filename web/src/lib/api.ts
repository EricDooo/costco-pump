// Always call through /costcogas/api -- Caddy proxies that prefix to the API
// in production, and vite.config.ts proxies the same path in dev. The app
// never needs to know the API's actual host.
const API_BASE = '/costcogas/api'

export interface StationSummary {
  id: number
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  lat: number
  lon: number
  regular_price: number | null
  premium_price: number | null
  diesel_price: number | null
  as_of: string | null
  /** regular_price at or below its own 7-day low. */
  is_7d_low: boolean
}

export interface PricePoint {
  time: string
  regular_price: number | null
  premium_price: number | null
  diesel_price: number | null
}

export interface DepartmentPhone {
  name: string
  phone: string
}

export interface StationDetailData extends StationSummary {
  history: PricePoint[]
  hours: string[] | null
  /** Only populated for US/CA/UK -- international warehouses don't expose these. */
  gas_hours: string[] | null
  opened_date: string | null
  phone: string | null
  services: string[] | null
  programs: string[] | null
  department_phones: DepartmentPhone[] | null
}

export interface StateStat {
  state: string
  avg_regular_price: number
  avg_premium_price: number | null
  avg_diesel_price: number | null
}

export interface MonthlyAverage {
  month: string
  avg_regular_price: number
}

export interface StatsSummary {
  tracked_days: number
  total_price_moves: number
  hikes: number
  cuts: number
  cheapest_states: StateStat[]
  priciest_states: StateStat[]
  monthly_averages: MonthlyAverage[]
}

export interface TrendPoint {
  date: string
  median_regular: number | null
  median_premium: number | null
  median_diesel: number | null
  stations_reporting: number
}

export interface TrendSummary {
  points: TrendPoint[]
  current_median: number | null
  stations_reporting: number
  move: number | null
  latest_day_hikes: number
  latest_day_cuts: number
}

export interface StateChangeStat {
  state: string
  hikes: number
  cuts: number
  avg_change: number
  biggest_move: number
}

export interface StateFuelStat {
  state: string
  avg_regular: number | null
  avg_premium: number | null
  avg_diesel: number | null
  station_count: number
}

export interface RegionalComparison {
  state: string
  /** EIA PADD (sub-)region code, e.g. "R50" -- see stateNames.ts's PADD_REGION_LABELS. */
  region_code: string
  costco_avg_regular: number
  region_avg_regular: number
  /** region_avg_regular - costco_avg_regular -- positive means Costco is
   * cheaper than its PADD region's own (non-Costco) average. */
  savings: number
  station_count: number
  /** That PADD region's weekly gasoline inventory, thousand barrels -- the
   * "why" a price move happened: near-normal stocks means it's probably
   * just following crude; well below normal is a real regional squeeze. */
  region_stocks_mbbl: number | null
}

export interface BenchmarkSummary {
  as_of: string | null
  national_avg_regular_price: number | null
  national_costco_avg_regular_price: number | null
  national_savings: number | null
  wti_spot_price: number | null
  national_gasoline_stocks_mbbl: number | null
  national_gasoline_demand_mbbl_per_day: number | null
  /** US-only -- EIA's PADD geography has nothing to compare Canada/UK/
   * international warehouses against. */
  by_state: RegionalComparison[]
}

async function getJson<T>(path: string): Promise<T> {
  // no-store: a browser-level cache on top of the API's own short server
  // cache has no upside, and did serve a stale dev response in practice.
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  stations: (state?: string) => getJson<StationSummary[]>(`/stations${state ? `?state=${state}` : ''}`),
  station: (id: number) => getJson<StationDetailData>(`/stations/${id}`),
  statsSummary: (region?: string) => getJson<StatsSummary>(`/stats/summary${region ? `?region=${region}` : ''}`),
  trend: (opts?: { days?: number; region?: string; state?: string }) => {
    const params = new URLSearchParams()
    if (opts?.days) params.set('days', String(opts.days))
    if (opts?.region) params.set('region', opts.region)
    if (opts?.state) params.set('state', opts.state)
    const qs = params.toString()
    return getJson<TrendSummary>(`/stats/trend${qs ? `?${qs}` : ''}`)
  },
  changesByState: (opts?: { hours?: number; region?: string }) => {
    const params = new URLSearchParams()
    if (opts?.hours) params.set('hours', String(opts.hours))
    if (opts?.region) params.set('region', opts.region)
    const qs = params.toString()
    return getJson<StateChangeStat[]>(`/stats/changes-by-state${qs ? `?${qs}` : ''}`)
  },
  states: (region?: string) => getJson<StateFuelStat[]>(`/stats/states${region ? `?region=${region}` : ''}`),
  benchmarks: () => getJson<BenchmarkSummary>('/stats/benchmarks'),
}
