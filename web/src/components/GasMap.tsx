import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps'
import type { FeatureCollection, Point } from 'geojson'
import {
  Map as MaplibreMap,
  NavigationControl,
  Popup,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import type { StationSummary } from '../lib/api'
import { useTheme } from '../hooks/useTheme'
import { ensureMaplibreSetup } from '../lib/maplibreSetup'
import { tilesUrlFor } from '../lib/tiles'

const SOURCE_ID = 'protomaps'
const STATIONS_SOURCE_ID = 'stations'
const STATE_CLUSTERS_SOURCE_ID = 'state-clusters'
// Below this zoom, US/CA show one circle per state instead of proximity
// clusters -- a national view otherwise lumps neighboring states together.
const STATE_ZOOM_THRESHOLD = 6
const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'
// protomaps-assets has no true Bold glyph (only Regular/Medium/Italic) --
// Medium is the heaviest weight actually available.
const PILL_FONT = 'Noto Sans Medium'

// Absolute-price scale for clusters/state-circles (zoomed out: which
// areas are cheap or pricey in dollar terms). Saturated/dark (600-weight)
// rather than pastel -- better contrast for the white text on top.
const PRICE_TIERS: { id: string; color: string; max: number }[] = [
  { id: 'pill-1', color: '#16a34a', max: 3.25 },
  { id: 'pill-2', color: '#65a30d', max: 3.75 },
  { id: 'pill-3', color: '#ca8a04', max: 4.25 },
  { id: 'pill-4', color: '#ea580c', max: 4.75 },
  { id: 'pill-5', color: '#dc2626', max: Infinity },
]
const PILL_FALLBACK_ID = 'pill-unknown'

// Shared between the plain and "7d low" branches of unclustered-point's
// text-field below -- same price string either way, just with or without a
// badge line above it.
const PRICE_TEXT_EXPR: ExpressionSpecification = [
  'case',
  ['==', ['get', 'regular_price'], null],
  '--',
  ['concat', '$', ['number-format', ['get', 'regular_price'], { 'min-fraction-digits': 2, 'max-fraction-digits': 2 }]],
]

// Same 5-color scale, but for individual pills: tier picked by how far a
// station sits from its own state's median (price_ratio, computed below),
// not a fixed nationwide dollar amount -- a state that's uniformly pricier
// or cheaper than the rest of the country still shows a spread.
const PILL_TIERS = PRICE_TIERS.map((t, i) => ({
  id: t.id,
  color: t.color,
  max: [-0.02, -0.005, 0.005, 0.02, Infinity][i]!,
}))

// CSS px; canvas is drawn at 2x/pixelRatio 2 for crisp text (see
// makePillImage). The text offset below depends on this exact geometry.
const PILL_W = 48
const PILL_H = 20
const PILL_RADIUS = 10
const TAIL_H = 6
const PILL_TEXT_SIZE = 11
// Tail tip to pill center, in ems of PILL_TEXT_SIZE (as text-offset expects).
const PILL_TEXT_OFFSET_EM = -(TAIL_H + PILL_H / 2) / PILL_TEXT_SIZE
// "7d low" badge: rendered as a second line of the SAME text-field as the
// price (via a `format` run), not a separate symbol layer -- two independent
// symbol layers get independent collision passes, so at high station density
// one could survive collision while the other got dropped, leaving either an
// orphaned badge with no pill or vice versa. One text-field means one
// collision box covering both lines, so they always show or hide together.
const LOW_BADGE_TEXT_SIZE = 9
const LOW_BADGE_FONT_SCALE = LOW_BADGE_TEXT_SIZE / PILL_TEXT_SIZE
// Anchored 'bottom' on the 2-line block (badge line above the price line);
// tuned so the price line lands at the same spot PILL_TEXT_OFFSET_EM gives
// it in the plain 1-line case.
const LOW_PILL_TEXT_OFFSET_EM = -(TAIL_H + 3) / PILL_TEXT_SIZE

function makePillImage(fillColor: string): ImageData {
  const scale = 2 // draw at 2x, registered with pixelRatio 2, for crisp edges/text
  const w = PILL_W * scale
  const h = (PILL_H + TAIL_H) * scale
  const r = PILL_RADIUS * scale
  const pillH = PILL_H * scale
  const strokeWidth = 1.5 * scale
  // The path's top/left/right edges sit exactly on the canvas bounds, so
  // the stroke (which straddles the path) got clipped there -- pad those
  // three sides and translate so the stroke has room. Bottom stays flush:
  // icon-anchor:'bottom' below anchors on the tail tip, which must stay
  // exactly at the image's bottom edge.
  const pad = strokeWidth / 2
  const canvas = document.createElement('canvas')
  canvas.width = w + pad * 2
  canvas.height = h + pad
  const ctx = canvas.getContext('2d')!
  ctx.translate(pad, pad)

  const tailHalf = 5 * scale
  const tailCenter = w / 2
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.arcTo(w, 0, w, r, r)
  ctx.lineTo(w, pillH - r)
  ctx.arcTo(w, pillH, w - r, pillH, r)
  ctx.lineTo(tailCenter + tailHalf, pillH)
  ctx.lineTo(tailCenter, h)
  ctx.lineTo(tailCenter - tailHalf, pillH)
  ctx.lineTo(r, pillH)
  ctx.arcTo(0, pillH, 0, pillH - r, r)
  ctx.lineTo(0, r)
  ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.lineWidth = strokeWidth
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

const PILL_COLOR_BY_ID = new Map<string, string>([
  ...PRICE_TIERS.map((t): [string, string] => [t.id, t.color]),
  [PILL_FALLBACK_ID, '#6b7280'],
])

/** Lazy resolver, not an eager 'load'-time addImage loop -- that raced
 * MapLibre's first paint in production, leaving pills as bare text. */
function registerPillImages(map: MaplibreMap) {
  map.setMissingStyleImageResolver((id) => {
    const color = PILL_COLOR_BY_ID.get(id)
    if (color) map.addImage(id, makePillImage(color), { pixelRatio: 2 })
  })
}

/** The hover tooltip's content -- name bold, address/city/state muted below. */
function buildHoverContent(props: { name: string; address: string; city: string; state: string; zip_code: string }): HTMLElement {
  const el = document.createElement('div')
  el.style.font = '12px sans-serif'
  const name = document.createElement('div')
  name.style.fontWeight = '600'
  name.style.color = 'var(--foreground)'
  name.textContent = props.name
  const address = document.createElement('div')
  address.style.color = 'var(--muted)'
  address.style.marginTop = '2px'
  address.textContent = `${props.address}, ${props.city}, ${props.state} ${props.zip_code}`.trim()
  el.append(name, address)
  return el
}

function resolvedFlavorName(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? 'dark' : 'light'
}

function flavorByName(name: 'light' | 'dark'): Flavor {
  return name === 'dark' ? DARK : LIGHT
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function toFeatureCollection(stations: StationSummary[]): FeatureCollection<Point> {
  // Each station's price_ratio (see PILL_TIERS) is relative to its own
  // state's median -- for a region with no real state subdivision (see
  // regions.ts), `state` is uniform across the list, so this naturally
  // becomes "relative to the region" instead.
  const priceByState = new Map<string, number[]>()
  for (const s of stations) {
    if (s.regular_price === null) continue
    const list = priceByState.get(s.state)
    if (list) list.push(s.regular_price)
    else priceByState.set(s.state, [s.regular_price])
  }
  const medianByState = new Map([...priceByState].map(([state, prices]) => [state, median(prices)]))

  return {
    type: 'FeatureCollection',
    features: stations
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => {
        const stateMedian = medianByState.get(s.state)
        const priceRatio = stateMedian && s.regular_price !== null ? (s.regular_price - stateMedian) / stateMedian : null
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
          properties: {
            id: s.id,
            name: s.name,
            address: s.address,
            city: s.city,
            state: s.state,
            zip_code: s.zip_code,
            regular_price: s.regular_price,
            price_ratio: priceRatio,
            is_7d_low: s.is_7d_low,
          },
        }
      }),
  }
}

// One feature per state/province, at that group's centroid -- used below
// STATE_ZOOM_THRESHOLD instead of proximity clustering (see GasMapProps).
function toStateFeatureCollection(stations: StationSummary[]): FeatureCollection<Point> {
  const groups = new Map<string, StationSummary[]>()
  for (const s of stations) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue
    const list = groups.get(s.state)
    if (list) list.push(s)
    else groups.set(s.state, [s])
  }
  return {
    type: 'FeatureCollection',
    features: [...groups.entries()].map(([state, group]) => {
      const lats = group.map((s) => s.lat)
      const lons = group.map((s) => s.lon)
      const priced = group.filter((s): s is StationSummary & { regular_price: number } => s.regular_price !== null)
      const avgPrice = priced.length ? priced.reduce((sum, s) => sum + s.regular_price, 0) / priced.length : null
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lons.reduce((a, b) => a + b, 0) / lons.length, lats.reduce((a, b) => a + b, 0) / lats.length],
        },
        properties: {
          state,
          count: group.length,
          avg_price: avgPrice,
          minLon: Math.min(...lons),
          maxLon: Math.max(...lons),
          minLat: Math.min(...lats),
          maxLat: Math.max(...lats),
        },
      }
    }),
  }
}

function buildStyle(
  flavorName: 'light' | 'dark',
  stations: StationSummary[],
  tilesFile: string,
  groupByState: boolean,
): StyleSpecification {
  const flavor = flavorByName(flavorName)
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    // Basemap POI icons (town/capital dots, etc) -- without this, every
    // place-label layer that references one logs a missing-image error.
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavorName}`,
    sources: {
      [SOURCE_ID]: {
        type: 'vector',
        url: `pmtiles://${tilesUrlFor(tilesFile)}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
      [STATIONS_SOURCE_ID]: {
        type: 'geojson',
        data: toFeatureCollection(stations),
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 9,
        // Sums priced stations (and how many had a price) so circle-color
        // below can average -- clusterProperties only accumulates, no average op.
        clusterProperties: {
          price_sum: ['+', ['case', ['==', ['get', 'regular_price'], null], 0, ['get', 'regular_price']]],
          priced_count: ['+', ['case', ['==', ['get', 'regular_price'], null], 0, 1]],
        },
      },
      [STATE_CLUSTERS_SOURCE_ID]: {
        type: 'geojson',
        data: groupByState ? toStateFeatureCollection(stations) : { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      ...layers(SOURCE_ID, flavor, { lang: 'en' }),
      {
        id: 'state-clusters',
        type: 'circle',
        source: STATE_CLUSTERS_SOURCE_ID,
        maxzoom: STATE_ZOOM_THRESHOLD,
        paint: {
          'circle-color': [
            'case',
            ['==', ['get', 'avg_price'], null],
            PILL_COLOR_BY_ID.get(PILL_FALLBACK_ID)!,
            [
              'step',
              ['get', 'avg_price'],
              PRICE_TIERS[0]!.color,
              PRICE_TIERS[0]!.max,
              PRICE_TIERS[1]!.color,
              PRICE_TIERS[1]!.max,
              PRICE_TIERS[2]!.color,
              PRICE_TIERS[2]!.max,
              PRICE_TIERS[3]!.color,
              PRICE_TIERS[3]!.max,
              PRICE_TIERS[4]!.color,
            ],
          ],
          'circle-radius': ['step', ['get', 'count'], 14, 10, 18, 25, 22, 50, 26, 100, 32],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      },
      {
        id: 'state-cluster-count',
        type: 'symbol',
        source: STATE_CLUSTERS_SOURCE_ID,
        maxzoom: STATE_ZOOM_THRESHOLD,
        layout: {
          'text-field': '{count}',
          'text-font': [PILL_FONT],
          'text-size': 13,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#00000099',
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'clusters',
        type: 'circle',
        source: STATIONS_SOURCE_ID,
        minzoom: groupByState ? STATE_ZOOM_THRESHOLD : 0,
        filter: ['has', 'point_count'],
        paint: {
          // Same PRICE_TIERS palette as the pills, keyed off the cluster's
          // average price (unpriced stations excluded); gray if none have one.
          'circle-color': [
            'case',
            ['==', ['get', 'priced_count'], 0],
            PILL_COLOR_BY_ID.get(PILL_FALLBACK_ID)!,
            [
              'let',
              'avg',
              ['/', ['get', 'price_sum'], ['get', 'priced_count']],
              [
                'step',
                ['var', 'avg'],
                PRICE_TIERS[0]!.color,
                PRICE_TIERS[0]!.max,
                PRICE_TIERS[1]!.color,
                PRICE_TIERS[1]!.max,
                PRICE_TIERS[2]!.color,
                PRICE_TIERS[2]!.max,
                PRICE_TIERS[3]!.color,
                PRICE_TIERS[3]!.max,
                PRICE_TIERS[4]!.color,
              ],
            ],
          ],
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 25, 22, 50, 26, 100, 32],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      },
      {
        id: 'cluster-count',
        type: 'symbol',
        source: STATIONS_SOURCE_ID,
        minzoom: groupByState ? STATE_ZOOM_THRESHOLD : 0,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': [PILL_FONT],
          'text-size': 13,
        },
        // Same halo as the pill text below -- avg-price color now spans
        // the same pale-to-saturated range plain white wasn't readable on.
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#00000099',
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'unclustered-point',
        type: 'symbol',
        source: STATIONS_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
          // Pre-rendered pill image per PILL_TIERS, picked by price_ratio;
          // pill-unknown when there's no live reading yet.
          'icon-image': [
            'case',
            ['==', ['get', 'price_ratio'], null],
            PILL_FALLBACK_ID,
            [
              'step',
              ['get', 'price_ratio'],
              PILL_TIERS[0]!.id,
              PILL_TIERS[0]!.max,
              PILL_TIERS[1]!.id,
              PILL_TIERS[1]!.max,
              PILL_TIERS[2]!.id,
              PILL_TIERS[2]!.max,
              PILL_TIERS[3]!.id,
              PILL_TIERS[3]!.max,
              PILL_TIERS[4]!.id,
            ],
          ],
          'icon-anchor': 'bottom',
          // No allow-overlap: keeps MapLibre's default collision detection
          // so dense areas thin out instead of stacking illegible pills.
          //
          // The "7d low" badge used to be a second symbol layer sharing this
          // same point -- but two layers get two independent collision
          // passes, so at high density one could get placed while the other
          // got dropped, leaving an orphaned badge with no pill (or a pill
          // with no badge). A `format` run folds it into this layer's own
          // text-field instead: one symbol instance, one collision box, so
          // the badge and price always show or hide together.
          'text-field': [
            'case',
            ['==', ['get', 'is_7d_low'], true],
            ['format', '7d low', { 'font-scale': LOW_BADGE_FONT_SCALE, 'text-color': '#fbbf24' }, '\n', {}, PRICE_TEXT_EXPR, {}],
            PRICE_TEXT_EXPR,
          ],
          'text-font': [PILL_FONT],
          'text-size': PILL_TEXT_SIZE,
          // 'bottom' + LOW_PILL_TEXT_OFFSET_EM for the 2-line (badge+price)
          // case, 'center' + PILL_TEXT_OFFSET_EM for the plain 1-line case --
          // both tuned to land the price line in the same spot either way.
          'text-anchor': ['case', ['==', ['get', 'is_7d_low'], true], 'bottom', 'center'],
          'text-offset': [
            'case',
            ['==', ['get', 'is_7d_low'], true],
            ['literal', [0, LOW_PILL_TEXT_OFFSET_EM]],
            ['literal', [0, PILL_TEXT_OFFSET_EM]],
          ],
        },
        // Dark halo behind the white text -- plain white wasn't reliably
        // readable against the paler tiers (lime/yellow) on its own.
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#00000099',
          'text-halo-width': 1.2,
        },
      },
    ],
  }
}

interface GasMapProps {
  stations: StationSummary[]
  /** Filename under /costcogas/tiles/ for this region's basemap extract --
   * see lib/regions.ts. */
  tilesFile: string
  center: [number, number]
  zoom: number
  /** Group below STATE_ZOOM_THRESHOLD by state/province instead of proximity
   * -- only meaningful where `state` is a real subdivision (US/CA). */
  groupByState: boolean
  /** Called with a station's id on pill click -- MapView owns what happens next. */
  onStationClick: (id: number) => void
}

/** Every station in the region, clustered by proximity, on a self-hosted
 * Protomaps basemap (see lib/tiles.ts) -- no third-party map API key. */
export function GasMap({ stations, tilesFile, center, zoom, groupByState, onStationClick }: GasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  // Read through a ref so a new onStationClick identity (e.g. setSearchParams)
  // doesn't rebuild the map below and reset the user's pan/zoom.
  const onStationClickRef = useRef(onStationClick)
  useEffect(() => {
    onStationClickRef.current = onStationClick
  }, [onStationClick])

  // Recreates the whole map rather than patching one via setStyle -- simpler,
  // and this only fires on a real theme/data/tiles change.
  useEffect(() => {
    if (!containerRef.current) return
    ensureMaplibreSetup()

    const map = new MaplibreMap({
      container: containerRef.current,
      style: buildStyle(resolvedFlavorName(theme), stations, tilesFile, groupByState),
      center,
      zoom,
      minZoom: 1,
      maxZoom: 16,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    // Synchronous, not on 'load' -- see registerPillImages for why deferring
    // it raced MapLibre's first paint in production.
    registerPillImages(map)
    // MapLibre fails silently on a style/source/tile problem -- log it
    // instead of debugging another blank map with an empty console.
    map.on('error', (e) => console.error('MapLibre error:', e.error))

    map.on('click', 'state-clusters', (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties as
        | { minLon: number; maxLon: number; minLat: number; maxLat: number }
        | undefined
      if (!p) return
      map.fitBounds(
        [
          [p.minLon, p.minLat],
          [p.maxLon, p.maxLat],
        ],
        { padding: 60, maxZoom: STATE_ZOOM_THRESHOLD + 2 },
      )
    })

    map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const clusterId = feature.properties?.cluster_id
      const source = map.getSource(STATIONS_SOURCE_ID) as GeoJSONSource
      const zoom = await source.getClusterExpansionZoom(clusterId)
      const [lng, lat] = (feature.geometry as Point).coordinates
      map.easeTo({ center: [lng, lat], zoom })
    })

    map.on('click', 'unclustered-point', (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      const id = feature?.properties?.id
      if (typeof id === 'number') onStationClickRef.current(id)
    })

    for (const layerId of ['clusters', 'unclustered-point', 'state-clusters']) {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    // Name + address on hover -- closeButton/closeOnClick both off since
    // this follows the cursor rather than being dismissed by the user.
    const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 12 })
    map.on('mousemove', 'unclustered-point', (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const p = feature.properties as { name: string; address: string; city: string; state: string; zip_code: string }
      hoverPopup.setLngLat(e.lngLat).setDOMContent(buildHoverContent(p)).addTo(map)
    })
    map.on('mouseleave', 'unclustered-point', () => {
      hoverPopup.remove()
    })

    return () => map.remove()
    // center/zoom are just the initial camera; a region change already
    // remounts via `key={region.id}` in MapView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, stations, tilesFile, groupByState])

  return <div ref={containerRef} className="h-full w-full" />
}
