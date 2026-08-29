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

export interface StationDetailData extends StationSummary {
  history: PricePoint[]
  hours: string[] | null
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

async function getJson<T>(path: string): Promise<T> {
  // no-store: this is live price data (and the API already sets its own
  // short server-side cache, see app/cache.py's stations/stats caching) --
  // a browser-level HTTP cache serving an even-staler copy on top of that
  // has no upside, and did happen in practice serving a years-old dev
  // response after a local proxy target change.
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  stations: (state?: string) => getJson<StationSummary[]>(`/stations${state ? `?state=${state}` : ''}`),
  station: (id: number) => getJson<StationDetailData>(`/stations/${id}`),
  statsSummary: () => getJson<StatsSummary>('/stats/summary'),
}
