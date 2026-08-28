import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PriceChart } from '../components/PriceChart'
import { api, type StationDetailData } from '../lib/api'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(2)}`
}

export function StationDetail() {
  const { id } = useParams<{ id: string }>()
  const [station, setStation] = useState<StationDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api
      .station(Number(id))
      .then(setStation)
      .catch(() => setError('Could not load this station right now.'))
  }, [id])

  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <Link to="/" className="text-sm text-muted hover:text-foreground">
        &larr; All stations
      </Link>

      {error && <p className="mt-8 text-sm text-negative">{error}</p>}
      {!error && !station && <p className="mt-8 text-sm text-muted">Loading...</p>}

      {station && (
        <>
          <h1 className="mt-4 text-2xl font-bold text-foreground">{station.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {station.address}, {station.city}, {station.state} {station.zip_code}
          </p>

          <div className="mt-6 flex gap-8 font-mono text-sm">
            <div>
              <div className="text-lg font-bold text-foreground">
                {formatPrice(station.regular_price)}
              </div>
              <div className="text-xs text-muted">regular</div>
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">
                {formatPrice(station.premium_price)}
              </div>
              <div className="text-xs text-muted">premium</div>
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">
                {formatPrice(station.diesel_price)}
              </div>
              <div className="text-xs text-muted">diesel</div>
            </div>
          </div>

          <PriceChart history={station.history} />

          {station.hours && (
            <div className="mt-8">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Hours</h2>
              <ul className="mt-2 space-y-0.5 text-sm text-muted">
                {station.hours.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
