import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GasMap } from '../components/GasMap'
import { Sidebar } from '../components/Sidebar'
import { api, type StationSummary, type StatsSummary } from '../lib/api'
import { CA_PROVINCES, REGIONS, regionById, type RegionId } from '../lib/regions'

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
  // survives a refresh).
  const selectedStationId = searchParams.get('station')
  const openStation = useCallback((id: number) => setSearchParams({ station: String(id) }), [setSearchParams])
  const closeStation = useCallback(() => setSearchParams({}), [setSearchParams])

  const selectedStation = useMemo(
    () => (selectedStationId ? (stations?.find((s) => s.id === Number(selectedStationId)) ?? null) : null),
    [stations, selectedStationId],
  )

  // A shared station link might point outside the currently selected region
  // -- jump to whichever region it actually belongs to once stations load.
  useEffect(() => {
    if (!selectedStation) return
    const matchedRegion = REGIONS.find((r) => r.matches(selectedStation))
    if (matchedRegion && matchedRegion.id !== regionId) selectRegion(matchedRegion.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStation])

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

  // stats/summary mixes US states and Canadian provinces together -- split
  // by the same province-code check regions.ts uses, then take the top 5.
  const stateBreakdown = useMemo(() => {
    if (!stats || !region.showStateBreakdown) return []
    const inRegion = regionId === 'ca' ? CA_PROVINCES.has.bind(CA_PROVINCES) : (s: string) => !CA_PROVINCES.has(s)
    return stats.cheapest_states.filter((s) => inRegion(s.state)).slice(0, 5)
  }, [stats, region, regionId])

  return (
    // h-full fills App.tsx's flex-1 slot; flex-col + min-h-0 below is what
    // lets the map claim the rest of the space instead of scrolling the page.
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-content flex-shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
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

      {error && <p className="mx-auto max-w-content flex-shrink-0 px-6 text-sm text-negative">{error}</p>}

      {/* Full-bleed below this point -- a map wants the width. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 sm:px-6 lg:flex-row lg:items-stretch">
        {/* min-h-0: lets this scroll internally instead of growing the page. */}
        <aside className="scrollbar-thin flex min-h-0 max-h-[40vh] flex-shrink-0 flex-col gap-6 overflow-y-auto lg:max-h-none lg:w-[26vw] lg:min-w-[340px] lg:max-w-[420px]">
          <Sidebar
            region={region}
            regionId={regionId}
            summary={summary}
            stateBreakdown={stateBreakdown}
            selectedStation={selectedStation}
            onCloseStation={closeStation}
          />
        </aside>

        <div className="min-h-[300px] w-full flex-1 overflow-hidden rounded-lg border border-border">
          {regionStations.length > 0 && (
            <GasMap
              key={region.id}
              stations={regionStations}
              tilesFile={region.tilesFile}
              center={region.center}
              zoom={region.zoom}
              groupByState={region.showStateBreakdown}
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
