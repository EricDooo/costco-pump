import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StationList } from '../components/StationList'
import { StatsHeader } from '../components/StatsHeader'
import { api, type StationSummary, type StatsSummary } from '../lib/api'

export function Dashboard() {
  const [stations, setStations] = useState<StationSummary[] | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    Promise.all([api.stations(), api.statsSummary()])
      .then(([s, summary]) => {
        setStations(s)
        setStats(summary)
      })
      .catch(() => setError('Could not load live data right now.'))
  }, [])

  const filtered = useMemo(() => {
    if (!stations) return []
    const q = query.trim().toLowerCase()
    if (!q) return stations
    return stations.filter((s) =>
      [s.name, s.city, s.state, s.zip_code].join(' ').toLowerCase().includes(q),
    )
  }, [stations, query])

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">Costco Gas Tracker</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Every US Costco with a gas station, swept and re-checked on a schedule, so you
        can see how prices at any warehouse have actually moved over time.
      </p>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !stats && <p className="mt-8 text-sm text-muted">Loading...</p>}
      {stats && stations && stations.length > 0 && (
        <div className="mt-8">
          <StatsHeader stats={stats} />
        </div>
      )}

      {stations && stations.length === 0 ? (
        <p className="mt-8 max-w-md text-sm text-muted">
          No stations tracked yet -- the first sweep hasn't landed. See{' '}
          <Link to="/about" className="text-primary hover:underline">
            About
          </Link>{' '}
          for how data is collected.
        </p>
      ) : (
        <>
          <div className="mt-8 max-w-sm">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by warehouse, city, state, or zip"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {stations && <StationList stations={filtered} />}
        </>
      )}
    </div>
  )
}
