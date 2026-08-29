import { useEffect, useMemo, useState } from 'react'
import { GasMap } from '../components/GasMap'
import { api, type StationSummary, type StatsSummary } from '../lib/api'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(2)}`
}

// warehouses.json's US/Canada/UK ids stay below this; scraper/international.py
// hashes every other country into 900_000+ blocks (see that module's
// docstring). Matches the "domestic" bucket this default map view shows --
// per-country views (see costco-pump README's "by region" plan) come later.
const DOMESTIC_ID_CEILING = 900_000

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function MapView() {
  const [stations, setStations] = useState<StationSummary[] | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.stations(), api.statsSummary()])
      .then(([s, summary]) => {
        setStations(s)
        setStats(summary)
      })
      .catch(() => setError('Could not load live data right now.'))
  }, [])

  const domestic = useMemo(() => stations?.filter((s) => s.id < DOMESTIC_ID_CEILING) ?? [], [stations])

  const summary = useMemo(() => {
    const priced = domestic.filter((s): s is StationSummary & { regular_price: number } => s.regular_price !== null)
    if (priced.length === 0) return null
    const med = median(priced.map((s) => s.regular_price))
    const lowest = priced.reduce((a, b) => (a.regular_price < b.regular_price ? a : b))
    const highest = priced.reduce((a, b) => (a.regular_price > b.regular_price ? a : b))
    return { median: med, lowest, highest }
  }, [domestic])

  return (
    <div>
      <div className="mx-auto max-w-content px-6 pt-8 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Costco Gas Prices</h1>
        <p className="mt-1 text-sm text-muted">
          Every US, Canada, and UK Costco with a gas station, swept and re-checked on a
          schedule.
        </p>
      </div>

      {error && <p className="mx-auto max-w-content px-6 text-sm text-negative">{error}</p>}

      {/* Full-bleed below this point, unlike the rest of the site's
          max-w-content pages -- a map wants the width. */}
      <div className="flex flex-col gap-4 px-4 sm:px-6 lg:flex-row lg:items-start">
        <aside className="flex-shrink-0 space-y-6 lg:w-72">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs font-medium text-muted">National median (regular)</div>
            <div className="mt-1 text-3xl font-bold text-foreground">
              {summary ? formatPrice(summary.median) : '--'}
            </div>
            {summary && (
              <div className="mt-3 flex justify-between text-xs">
                <div>
                  <div className="text-muted">Lowest</div>
                  <div className="font-mono text-positive">{formatPrice(summary.lowest.regular_price)}</div>
                  <div className="text-muted">
                    {summary.lowest.city}, {summary.lowest.state}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-muted">Highest</div>
                  <div className="font-mono text-negative">{formatPrice(summary.highest.regular_price)}</div>
                  <div className="text-muted">
                    {summary.highest.city}, {summary.highest.state}
                  </div>
                </div>
              </div>
            )}
          </div>

          {stats && stats.cheapest_states.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-xs font-medium text-muted">Cheapest states (7-day avg)</div>
              <ol className="mt-3 space-y-2">
                {stats.cheapest_states.map((s, i) => (
                  <li key={s.state} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">
                      <span className="mr-2 text-muted">{i + 1}</span>
                      {s.state}
                    </span>
                    <span className="font-mono text-muted">${s.avg_regular_price.toFixed(2)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>

        <div className="h-[75vh] min-h-[500px] w-full overflow-hidden rounded-lg border border-border">
          {domestic.length > 0 && <GasMap stations={domestic} />}
        </div>
      </div>
    </div>
  )
}
