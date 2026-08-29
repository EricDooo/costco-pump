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
  statsSummary: () => getJson<StatsSummary>('/stats/summary'),
  trend: (opts?: { days?: number; state?: string }) => {
    const params = new URLSearchParams()
    if (opts?.days) params.set('days', String(opts.days))
    if (opts?.state) params.set('state', opts.state)
    const qs = params.toString()
    return getJson<TrendSummary>(`/stats/trend${qs ? `?${qs}` : ''}`)
  },
  changesByState: (hours?: number) => getJson<StateChangeStat[]>(`/stats/changes-by-state${hours ? `?hours=${hours}` : ''}`),
}
