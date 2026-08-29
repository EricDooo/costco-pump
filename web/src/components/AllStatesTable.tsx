import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StateFuelStat } from '../lib/api'
import { stateName } from '../lib/stateNames'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(3)}`
}

type SortKey = 'state' | 'station_count' | 'avg_regular' | 'avg_premium' | 'avg_diesel'

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'state', label: 'State' },
  { key: 'station_count', label: 'Stations', align: 'right' },
  { key: 'avg_regular', label: 'Regular', align: 'right' },
  { key: 'avg_premium', label: 'Premium', align: 'right' },
  { key: 'avg_diesel', label: 'Diesel', align: 'right' },
]

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (!direction) return null
  return <span className="ml-1 inline-block">{direction === 'asc' ? '▲' : '▼'}</span>
}

/** Every state/province in the current region -- searchable, sortable,
 * internally-scrolling, same treatment as StationTable. */
export function AllStatesTable({ rows }: { rows: StateFuelStat[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('avg_regular')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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
      setSortDir('asc')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div className="text-xs font-medium text-muted">All states</div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter states..."
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {sorted.length === 0 ? (
        <p className="p-4 text-sm text-muted">No states match that filter.</p>
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
                  </td>
                  <td className="px-4 py-2 text-right text-muted">{r.station_count}</td>
                  <td className="px-4 py-2 text-right font-mono text-blue-600">{formatPrice(r.avg_regular)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">{formatPrice(r.avg_premium)}</td>
                  <td className="px-4 py-2 text-right font-mono text-green-600">{formatPrice(r.avg_diesel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
