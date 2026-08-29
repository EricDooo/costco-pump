import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StationTable } from '../components/StationTable'
import { api, type StationSummary, type TrendSummary } from '../lib/api'
import { CA_PROVINCES } from '../lib/regions'
import { stateName } from '../lib/stateNames'
import { TrendChart } from './Analytics'

const TREND_DAYS = 30

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(3)}`
}

function formatCents(dollars: number): string {
  const cents = Math.round(Math.abs(dollars) * 100 * 10) / 10
  return `${dollars >= 0 ? '+' : '-'}${cents.toFixed(1)}¢`
}

/** Per-state analytics -- same trend chart as the national page, scoped to
 * one state/province, plus that state's own stations, searchable/sortable. */
export function AnalyticsState() {
  const { code } = useParams<{ code: string }>()
  const [trend, setTrend] = useState<TrendSummary | null>(null)
  const [stations, setStations] = useState<StationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    setTrend(null)
    setStations(null)
    setError(null)
    const region = CA_PROVINCES.has(code.toUpperCase()) ? 'ca' : 'us'
    Promise.all([api.trend({ days: TREND_DAYS, region, state: code }), api.stations(code)])
      .then(([t, s]) => {
        setTrend(t)
        setStations(s)
      })
      .catch(() => setError('Could not load live data right now.'))
  }, [code])

  if (!code) return null

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <Link to="/analytics" className="text-sm text-muted hover:text-foreground">
        &larr; Analytics
      </Link>

      <h1 className="mt-4 text-2xl font-bold text-foreground">{stateName(code.toUpperCase())}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Price trend and every tracked Costco gas station in {stateName(code.toUpperCase())}.
      </p>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-sm font-bold text-foreground">{stateName(code.toUpperCase())} trend</div>
          <p className="text-xs text-muted">Median regular/premium/diesel price -- last {TREND_DAYS} days</p>
          <TrendChart trend={trend} />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-[10px] font-medium tracking-wide text-muted uppercase">Current median</div>
            <div className="mt-1 text-xl font-bold text-foreground">{formatPrice(trend?.current_median ?? null)}</div>
            {trend && <div className="mt-1 text-xs text-muted">{trend.stations_reporting} stations reporting</div>}
          </div>
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-[10px] font-medium tracking-wide text-muted uppercase">{TREND_DAYS}-day move</div>
            <div className="mt-1 text-xl font-bold text-foreground">
              {trend?.move !== null && trend?.move !== undefined ? formatCents(trend.move) : '--'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">{stations && <StationTable stations={stations} />}</div>
    </div>
  )
}
