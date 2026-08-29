import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StationDetailContent } from '../components/StationDetailContent'
import { api, type StationDetailData, type StationSummary } from '../lib/api'
import { priceComparisons } from '../lib/priceComparisons'
import { REGIONS } from '../lib/regions'

/** Standalone per-station page, reached from the Fuel Stations list --
 * same fetch and content as the map sidebar's StationPanel, full page. */
export function StationDetail() {
  const { id } = useParams<{ id: string }>()
  const [station, setStation] = useState<StationDetailData | null>(null)
  const [stations, setStations] = useState<StationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setStation(null)
    setError(null)
    api
      .station(Number(id))
      .then(setStation)
      .catch(() => setError('Could not load this station right now.'))
  }, [id])

  // For the comparison bars -- fetched once, separately from the station
  // itself, so a slow full-list fetch never blocks the price cards above.
  useEffect(() => {
    api.stations().then(setStations).catch(() => {})
  }, [])

  const comparisons = useMemo(() => {
    if (!station || !stations) return null
    const region = REGIONS.find((r) => r.matches(station))
    const peers = region ? stations.filter(region.matches) : stations
    return priceComparisons(station, peers)
  }, [station, stations])

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <Link to="/stations" className="text-sm text-muted hover:text-foreground">
        &larr; All stations
      </Link>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !station && <p className="mt-8 text-sm text-muted">Loading...</p>}

      {station && (
        <div className="mt-6 max-w-xl">
          <StationDetailContent station={station} detail={station} comparisons={comparisons} />
        </div>
      )}
    </div>
  )
}
