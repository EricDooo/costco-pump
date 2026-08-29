import { useEffect, useMemo, useState } from 'react'
import { api, type StationDetailData, type StationSummary } from '../lib/api'
import { priceComparisons } from '../lib/priceComparisons'
import { StationDetailContent } from './StationDetailContent'

/** Map sidebar's station view -- a "Back" button plus the shared detail
 * content, rendered instantly from the already-loaded summary row. */
export function StationPanel({
  station: initial,
  regionStations,
  onClose,
}: {
  station: StationSummary
  /** The current region's station list -- peers for the comparison bars. */
  regionStations: StationSummary[]
  onClose: () => void
}) {
  const [detail, setDetail] = useState<StationDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setError(null)
    api
      .station(initial.id)
      .then(setDetail)
      .catch(() => setError('Could not load price history for this station right now.'))
  }, [initial.id])

  const comparisons = useMemo(() => priceComparisons(initial, regionStations), [initial, regionStations])

  return (
    <div className="space-y-4">
      <button type="button" onClick={onClose} className="text-sm text-muted hover:text-foreground">
        &larr; Back
      </button>
      {error && <p className="text-sm text-negative">{error}</p>}
      <StationDetailContent station={initial} detail={detail} comparisons={comparisons} />
    </div>
  )
}
