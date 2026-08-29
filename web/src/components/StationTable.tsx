import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StationSummary } from '../lib/api'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(3)}`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

type SortKey = 'name' | 'id' | 'state' | 'regular_price' | 'premium_price' | 'diesel_price'

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Station' },
  { key: 'id', label: '#' },
  { key: 'state', label: 'State' },
  { key: 'regular_price', label: 'Regular', align: 'right' },
  { key: 'premium_price', label: 'Premium', align: 'right' },
  { key: 'diesel_price', label: 'Diesel', align: 'right' },
]

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (!direction) return null
  return <span className="ml-1 inline-block">{direction === 'asc' ? '▲' : '▼'}</span>
}

/** A searchable, sortable, internally-scrolling table of stations -- one
 * component shared by the Fuel Stations page and each per-state page. */
export function StationTable({ stations }: { stations: StationSummary[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('regular_price')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return stations
    return stations.filter((s) => [s.name, s.city, s.state, s.zip_code].join(' ').toLowerCase().includes(q))
  }, [stations, query])

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

  const lastUpdated = useMemo(
    () => stations.reduce<string | null>((latest, s) => (!latest || (s.as_of && s.as_of > latest) ? s.as_of : latest), null),
    [stations],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'state' ? 'asc' : 'asc')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter stations..."
          className="w-full max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <span className="text-xs text-muted">
          {sorted.length.toLocaleString()} station{sorted.length === 1 ? '' : 's'}
          {lastUpdated && ` · updated ${formatRelative(lastUpdated)}`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="p-4 text-sm text-muted">No stations match that filter.</p>
      ) : (
        <div className="scrollbar-thin max-h-[32rem] overflow-y-auto">
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
              {sorted.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-background/50">
                  <td className="px-4 py-2">
                    <Link to={`/stations/${s.id}`} className="block">
                      <div className="font-medium text-foreground">{s.name}</div>
                      <div className="text-xs text-muted">
                        {s.city}, {s.state}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">#{s.id}</td>
                  <td className="px-4 py-2 text-muted">{s.state || '--'}</td>
                  <td className="px-4 py-2 text-right font-mono text-blue-600">{formatPrice(s.regular_price)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">{formatPrice(s.premium_price)}</td>
                  <td className="px-4 py-2 text-right font-mono text-green-600">{formatPrice(s.diesel_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
