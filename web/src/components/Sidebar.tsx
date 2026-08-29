import { TrendChart } from '../pages/Analytics'
import { StationPanel } from './StationPanel'
import type { StateStat, StationSummary, TrendSummary } from '../lib/api'
import type { Region, RegionId } from '../lib/regions'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(2)}`
}

interface RegionSummary {
  median: number | null
  lowest: StationSummary & { regular_price: number }
  highest: StationSummary & { regular_price: number }
}

/** Map page's left panel -- national summary or a selected station,
 * switched in place (no route change, no loading flash). */
export function Sidebar({
  region,
  regionId,
  summary,
  stateBreakdown,
  regionStations,
  trend,
  recentStations,
  onSelectStation,
  selectedStation,
  onCloseStation,
}: {
  region: Region
  regionId: RegionId
  summary: RegionSummary | null
  stateBreakdown: StateStat[]
  regionStations: StationSummary[]
  trend: TrendSummary | null
  recentStations: StationSummary[]
  onSelectStation: (id: number) => void
  selectedStation: StationSummary | null
  onCloseStation: () => void
}) {
  if (selectedStation) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <StationPanel station={selectedStation} regionStations={regionStations} onClose={onCloseStation} />
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs font-medium text-muted">{region.label} median (regular)</div>
        <div className="mt-1 text-3xl font-bold text-foreground">{summary ? formatPrice(summary.median) : '--'}</div>
        {summary && (
          <div className="mt-3 flex justify-between text-xs">
            <div>
              <div className="text-muted">Lowest</div>
              <div className="font-mono text-positive">{formatPrice(summary.lowest.regular_price)}</div>
              <div className="text-muted">
                {summary.lowest.city}, {summary.lowest.state}
              </div>
            </div>
            <div className="text-right">
              <div className="text-muted">Highest</div>
              <div className="font-mono text-negative">{formatPrice(summary.highest.regular_price)}</div>
              <div className="text-muted">
                {summary.highest.city}, {summary.highest.state}
              </div>
            </div>
          </div>
        )}
      </div>

      {stateBreakdown.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs font-medium text-muted">
            Cheapest {regionId === 'ca' ? 'provinces' : 'states'} (7-day avg)
          </div>
          <ol className="mt-3 space-y-2">
            {stateBreakdown.map((s, i) => (
              <li key={s.state} className="flex items-center justify-between text-sm">
                <span className="text-foreground">
                  <span className="mr-2 text-muted">{i + 1}</span>
                  {s.state}
                </span>
                <span className="font-mono text-muted">${s.avg_regular_price.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs font-medium text-muted">{region.label} trend (14d)</div>
        <TrendChart trend={trend} />
      </div>

      {recentStations.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs font-medium text-muted">Recently viewed</div>
          <ul className="mt-3 space-y-2">
            {recentStations.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectStation(s.id)}
                  className="flex w-full items-center justify-between gap-2 text-left text-sm hover:text-primary"
                >
                  <span className="min-w-0 truncate text-foreground">{s.name}</span>
                  <span className="flex-shrink-0 font-mono text-muted">{formatPrice(s.regular_price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
