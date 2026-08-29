import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StationTable } from '../components/StationTable'
import { StatsHeader } from '../components/StatsHeader'
import { useRegion } from '../hooks/useRegion'
import { api, type StationSummary, type StatsSummary } from '../lib/api'

export function Dashboard() {
  const { region } = useRegion()
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

  const regionStations = useMemo(() => stations?.filter(region.matches) ?? [], [stations, region])

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">Fuel Stations</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Every tracked Costco gas station in {region.label}, searchable and sortable. Change the country in the
        header to see another region, or see the <Link to="/" className="text-primary hover:underline">map</Link> for
        a geographic view.
      </p>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !stats && <p className="mt-8 text-sm text-muted">Loading...</p>}
      {stats && stations && stations.length > 0 && (
        <div className="mt-8">
          <StatsHeader stats={stats} />
        </div>
      )}

      {stations &&
        (regionStations.length === 0 ? (
          <p className="mt-8 max-w-md text-sm text-muted">
            No {region.label} stations tracked yet -- the international sweep for this region hasn't landed data. See{' '}
            <Link to="/about" className="text-primary hover:underline">
              About
            </Link>{' '}
            for how data is collected.
          </p>
        ) : (
          <div className="mt-8">
            <StationTable stations={regionStations} />
          </div>
        ))}
    </div>
  )
}
