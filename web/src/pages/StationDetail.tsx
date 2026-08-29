import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StationDetailContent } from '../components/StationDetailContent'
import { api, type StationDetailData } from '../lib/api'

/** Standalone per-station page, reached from the Fuel Stations list --
 * same fetch and content as the map sidebar's StationPanel, full page. */
export function StationDetail() {
  const { id } = useParams<{ id: string }>()
  const [station, setStation] = useState<StationDetailData | null>(null)
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

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <Link to="/stations" className="text-sm text-muted hover:text-foreground">
        &larr; All stations
      </Link>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !station && <p className="mt-8 text-sm text-muted">Loading...</p>}

      {station && (
        <div className="mt-6 max-w-xl">
          <StationDetailContent station={station} detail={station} regionMedian={null} />
        </div>
      )}
    </div>
  )
}
