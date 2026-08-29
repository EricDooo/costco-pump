import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GasMap } from '../components/GasMap'
import { StationPanel } from '../components/StationPanel'
import { api, type StationSummary, type StatsSummary } from '../lib/api'
import { CA_PROVINCES, REGIONS, regionById, type RegionId } from '../lib/regions'

function formatPrice(price: number | null): string {
  return price === null ? '--' : `$${price.toFixed(2)}`
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const REGION_STORAGE_KEY = 'costcogas:region'

function getStoredRegion(): RegionId {
  if (typeof window === 'undefined') return 'us'
  const stored = window.localStorage.getItem(REGION_STORAGE_KEY)
  return REGIONS.some((r) => r.id === stored) ? (stored as RegionId) : 'us'
}

export function MapView() {
  const [stations, setStations] = useState<StationSummary[] | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [regionId, setRegionId] = useState<RegionId>(() => getStoredRegion())
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    Promise.all([api.stations(), api.statsSummary()])
      .then(([s, summary]) => {
        setStations(s)
        setStats(summary)
      })
      .catch(() => setError('Could not load live data right now.'))
  }, [])

  const region = regionById(regionId)

  function selectRegion(id: RegionId) {
    setRegionId(id)
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, id)
    } catch {
      // localStorage unavailable (private mode, etc.) -- selection just won't persist.
    }
  }

  // ?station=<id> is the source of truth for the open panel (shareable,
  // survives a refresh) -- these two are stable across renders (setSearchParams
  // itself is; wrapping it in useCallback keeps our own identity stable too),
  // which matters because GasMap tears down and rebuilds its whole map
  // instance whenever onStationClick's identity changes.
  const selectedStationId = searchParams.get('station')
  const openStation = useCallback((id: number) => setSearchParams({ station: String(id) }), [setSearchParams])
  const closeStation = useCallback(() => setSearchParams({}), [setSearchParams])

  // A shared station link might point at a warehouse outside whatever
  // region happens to be selected (localStorage-remembered, or the default)
  // -- once the full station list loads, jump to whichever region that
  // station actually belongs to so the map behind the panel makes sense.
  useEffect(() => {
    if (!stations || !selectedStationId) return
    const match = stations.find((s) => s.id === Number(selectedStationId))
    if (!match) return
    const matchedRegion = REGIONS.find((r) => r.matches(match))
    if (matchedRegion && matchedRegion.id !== regionId) selectRegion(matchedRegion.id)
    // Deliberately not depending on regionId -- this should only react to a
    // *new* station selection (or the station list arriving), not re-fire
    // every time the region changes for any other reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, selectedStationId])

  const regionStations = useMemo(() => stations?.filter(region.matches) ?? [], [stations, region])

  const summary = useMemo(() => {
    const priced = regionStations.filter(
      (s): s is StationSummary & { regular_price: number } => s.regular_price !== null,
    )
    if (priced.length === 0) return null
    const med = median(priced.map((s) => s.regular_price))
    const lowest = priced.reduce((a, b) => (a.regular_price < b.regular_price ? a : b))
    const highest = priced.reduce((a, b) => (a.regular_price > b.regular_price ? a : b))
    return { median: med, lowest, highest }
  }, [regionStations])

  // stats/summary's state breakdown mixes US states and Canadian provinces
  // together (they share one warehouses table) -- split by the same
  // province-code check regions.ts uses, so "cheapest states" only shows
  // entries that actually belong to the selected region.
  const stateBreakdown = useMemo(() => {
    if (!stats || !region.showStateBreakdown) return []
    const inRegion = regionId === 'ca' ? CA_PROVINCES.has.bind(CA_PROVINCES) : (s: string) => !CA_PROVINCES.has(s)
    // stats/summary returns its top 20 across US+Canada combined (see
    // app/routers/stats.py) precisely so filtering by country here still
    // leaves enough to show a real top 5, instead of the top 5 *overall*
    // silently losing entries to whichever country dominated it.
    return stats.cheapest_states.filter((s) => inRegion(s.state)).slice(0, 5)
  }, [stats, region, regionId])

  return (
    <div>
      <div className="mx-auto flex max-w-content items-start justify-between gap-4 px-6 pt-8 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Costco Gas Prices</h1>
          <p className="mt-1 text-sm text-muted">
            Every Costco with a gas station, swept and re-checked on a schedule.
          </p>
        </div>

        <label className="flex-shrink-0">
          <span className="sr-only">Region</span>
          <select
            value={regionId}
            onChange={(e) => selectRegion(e.target.value as RegionId)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="mx-auto max-w-content px-6 text-sm text-negative">{error}</p>}

      {/* Full-bleed below this point, unlike the rest of the site's
          max-w-content pages -- a map wants the width. */}
      <div className="flex flex-col gap-4 px-4 sm:px-6 lg:flex-row lg:items-start">
        <aside className="flex-shrink-0 space-y-6 lg:w-72">
          {selectedStationId ? (
            <div className="rounded-lg border border-border bg-surface p-4">
              <StationPanel
                stationId={Number(selectedStationId)}
                regionMedian={summary?.median ?? null}
                onClose={closeStation}
              />
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="text-xs font-medium text-muted">{region.label} median (regular)</div>
                <div className="mt-1 text-3xl font-bold text-foreground">
                  {summary ? formatPrice(summary.median) : '--'}
                </div>
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
            </>
          )}
        </aside>

        <div className="h-[75vh] min-h-[500px] w-full overflow-hidden rounded-lg border border-border">
          {regionStations.length > 0 && (
            <GasMap
              key={region.id}
              stations={regionStations}
              tilesFile={region.tilesFile}
              center={region.center}
              zoom={region.zoom}
              onStationClick={openStation}
            />
          )}
          {stations && regionStations.length === 0 && (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
              No {region.label} stations tracked yet -- the international sweep for this
              region hasn't landed data. Check back soon.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
