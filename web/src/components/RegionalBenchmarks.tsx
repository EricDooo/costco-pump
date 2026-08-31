import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BenchmarkSummary, RegionalComparison } from '../lib/api'
import { paddRegionLabel, stateName } from '../lib/stateNames'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(3)}`
}

function formatCents(dollars: number): string {
  const cents = Math.round(Math.abs(dollars) * 100 * 10) / 10
  return `${dollars >= 0 ? '+' : '-'}${cents.toFixed(1)}¢`
}

// EIA reports these in MBBL/MBBL-per-day -- "thousand barrels" in petroleum
// industry convention (Roman numeral M), not "million" -- so this converts
// to an actual million-barrels figure for a general audience instead of
// echoing EIA's own confusing unit.
function formatMbbl(thousandBarrels: number | null, perDay: boolean): string {
  if (thousandBarrels === null) return '--'
  return `${(thousandBarrels / 1000).toFixed(1)}M bbl${perDay ? '/day' : ''}`
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-[10px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-xl font-bold text-foreground">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}

type SortKey = 'state' | 'costco_avg_regular' | 'region_avg_regular' | 'savings' | 'region_stocks_mbbl'

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'state', label: 'State' },
  { key: 'costco_avg_regular', label: 'Costco avg', align: 'right' },
  { key: 'region_avg_regular', label: 'Region avg', align: 'right' },
  { key: 'savings', label: 'Savings', align: 'right' },
  { key: 'region_stocks_mbbl', label: 'Region stocks', align: 'right' },
]

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (!direction) return null
  return <span className="ml-1 inline-block">{direction === 'asc' ? '▲' : '▼'}</span>
}

function BenchmarkTable({ rows }: { rows: RegionalComparison[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('savings')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.state} ${stateName(r.state)}`.toLowerCase().includes(q))
  }, [rows, query])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null) return bv === null ? 0 : 1
      if (bv === null) return -1
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir
      return (av - bv) * dir
    })
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <div className="text-xs font-medium text-muted">Costco vs. EIA regional average, by state</div>
          <p className="mt-0.5 text-[11px] text-muted">
            &quot;Region avg&quot; is EIA&apos;s own public retail average for that state&apos;s PADD region (not
            Costco) -- government data, refreshed daily.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter states..."
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {sorted.length === 0 ? (
        <p className="p-4 text-sm text-muted">{rows.length === 0 ? 'No benchmark data yet.' : 'No states match that filter.'}</p>
      ) : (
        <div className="scrollbar-thin max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-xs text-muted">
                {COLUMNS.map((col) => (
                  <th key={col.key} className={col.align === 'right' ? 'text-right' : ''}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`w-full px-4 py-2 font-medium uppercase tracking-wide hover:text-foreground ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      } ${sortKey === col.key ? 'text-foreground' : ''}`}
                    >
                      {col.label}
                      <SortIcon direction={sortKey === col.key ? sortDir : null} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.state} className="border-t border-border hover:bg-background/50">
                  <td className="px-4 py-2">
                    <Link to={`/analytics/state/${r.state}`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {stateName(r.state)}
                    </Link>
                    <div className="text-xs text-muted">{paddRegionLabel(r.region_code)}</div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-foreground">{formatPrice(r.costco_avg_regular)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted">{formatPrice(r.region_avg_regular)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${r.savings >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {formatCents(r.savings)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted">{formatMbbl(r.region_stocks_mbbl, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Costco's own US prices against EIA's public national/PADD-region
 * averages + WTI crude spot -- US-only (see api's /stats/benchmarks). */
export function RegionalBenchmarks({ data }: { data: BenchmarkSummary | null }) {
  if (!data) return <p className="mt-4 text-sm text-muted">Loading...</p>

  if (data.by_state.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs font-medium text-muted">Costco vs. regional averages</div>
        <p className="mt-3 text-sm text-muted">
          No benchmark data yet -- this refreshes once a day from EIA's public API. Check back soon.
        </p>
      </div>
    )
  }

  const savings = data.national_savings

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Costco US average" value={formatPrice(data.national_costco_avg_regular_price)} />
        <StatCard label="EIA national average" value={formatPrice(data.national_avg_regular_price)} />
        <StatCard
          label="Costco vs. national avg"
          value={savings !== null ? formatCents(savings) : '--'}
          sub={savings !== null ? (savings >= 0 ? 'Costco is cheaper' : 'Costco is pricier') : undefined}
        />
        <StatCard label="WTI crude spot" value={data.wti_spot_price !== null ? `$${data.wti_spot_price.toFixed(2)}/bbl` : '--'} />
        <StatCard
          label="US gasoline stocks"
          value={formatMbbl(data.national_gasoline_stocks_mbbl, false)}
          sub="Weekly commercial inventory"
        />
        <StatCard
          label="US gasoline demand"
          value={formatMbbl(data.national_gasoline_demand_mbbl_per_day, true)}
          sub="Weekly product supplied"
        />
      </div>

      <BenchmarkTable rows={data.by_state} />
    </div>
  )
}
