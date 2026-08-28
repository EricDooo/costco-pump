import { Link } from 'react-router-dom'
import type { StationSummary } from '../lib/api'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(2)}`
}

export function StationList({ stations }: { stations: StationSummary[] }) {
  if (stations.length === 0) {
    return <p className="mt-8 text-sm text-muted">No stations match that filter.</p>
  }

  return (
    <ul className="mt-6 divide-y divide-border">
      {stations.map((station) => (
        <li key={station.id}>
          <Link
            to={`/stations/${station.id}`}
            className="flex items-center justify-between gap-4 py-4 hover:bg-surface"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{station.name}</div>
              <div className="truncate text-sm text-muted">
                {station.city}, {station.state}
              </div>
            </div>
            <div className="flex-shrink-0 text-right font-mono text-sm">
              <div className="text-foreground">{formatPrice(station.regular_price)}</div>
              <div className="text-xs text-muted">regular</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
