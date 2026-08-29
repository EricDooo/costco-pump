import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps'
import type { FeatureCollection, Point } from 'geojson'
import {
  Map as MaplibreMap,
  NavigationControl,
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
const LABEL_FONT = 'Noto Sans Regular'
// protomaps-assets has no true Bold glyph (only Regular/Medium/Italic) --
// Medium is the heaviest weight actually available.
const PILL_FONT = 'Noto Sans Medium'

// A station renders as a price-tag pill (colored badge + tail) instead of a
// plain dot -- tier picked per feature by a step expression on regular_price.
const PRICE_TIERS: { id: string; color: string; max: number }[] = [
  { id: 'pill-1', color: '#4ade80', max: 3.25 },
  { id: 'pill-2', color: '#a3e635', max: 3.75 },
  { id: 'pill-3', color: '#facc15', max: 4.25 },
  { id: 'pill-4', color: '#fb923c', max: 4.75 },
  { id: 'pill-5', color: '#f87171', max: Infinity },
]
const PILL_FALLBACK_ID = 'pill-unknown'

// CSS px; canvas is drawn at 2x/pixelRatio 2 for crisp text (see
// makePillImage). The text offset below depends on this exact geometry.
const PILL_W = 48
const PILL_H = 20
const PILL_RADIUS = 10
const TAIL_H = 6
const PILL_TEXT_SIZE = 11
// Tail tip to pill center, in ems of PILL_TEXT_SIZE (as text-offset expects).
const PILL_TEXT_OFFSET_EM = -(TAIL_H + PILL_H / 2) / PILL_TEXT_SIZE

function makePillImage(fillColor: string): ImageData {
  const scale = 2 // draw at 2x, registered with pixelRatio 2, for crisp edges/text
  const w = PILL_W * scale
  const h = (PILL_H + TAIL_H) * scale
  const r = PILL_RADIUS * scale
  const pillH = PILL_H * scale
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

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
  ctx.lineWidth = 1.5 * scale
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  return ctx.getImageData(0, 0, w, h)
}

const PILL_COLOR_BY_ID = new Map<string, string>([
  ...PRICE_TIERS.map((t): [string, string] => [t.id, t.color]),
  [PILL_FALLBACK_ID, '#9ca3af'],
])

/** Lazy resolver, not an eager 'load'-time addImage loop -- that raced
 * MapLibre's first paint in production, leaving pills as bare text. */
function registerPillImages(map: MaplibreMap) {
  map.setMissingStyleImageResolver((id) => {
    const color = PILL_COLOR_BY_ID.get(id)
    if (color) map.addImage(id, makePillImage(color), { pixelRatio: 2 })
  })
}

function resolvedFlavorName(theme: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? 'dark' : 'light'
}

function flavorByName(name: 'light' | 'dark'): Flavor {
  return name === 'dark' ? DARK : LIGHT
}

function toFeatureCollection(stations: StationSummary[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: stations
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id,
          name: s.name,
          city: s.city,
          state: s.state,
          regular_price: s.regular_price,
        },
      })),
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
          'text-font': [LABEL_FONT],
          'text-size': 12,
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
          'text-font': [LABEL_FONT],
          'text-size': 12,
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
          // Pre-rendered pill image per PRICE_TIERS, picked by price;
          // pill-unknown when there's no live reading yet.
          'icon-image': [
            'case',
            ['==', ['get', 'regular_price'], null],
            PILL_FALLBACK_ID,
            [
              'step',
              ['get', 'regular_price'],
              PRICE_TIERS[0]!.id,
              PRICE_TIERS[0]!.max,
              PRICE_TIERS[1]!.id,
              PRICE_TIERS[1]!.max,
              PRICE_TIERS[2]!.id,
              PRICE_TIERS[2]!.max,
              PRICE_TIERS[3]!.id,
              PRICE_TIERS[3]!.max,
              PRICE_TIERS[4]!.id,
            ],
          ],
          'icon-anchor': 'bottom',
          // No allow-overlap: keeps MapLibre's default collision detection
          // so dense areas thin out instead of stacking illegible pills.
          'text-field': [
            'case',
            ['==', ['get', 'regular_price'], null],
            '--',
            ['concat', '$', ['number-format', ['get', 'regular_price'], { 'min-fraction-digits': 2, 'max-fraction-digits': 2 }]],
          ],
          'text-font': [PILL_FONT],
          'text-size': PILL_TEXT_SIZE,
          // 'center', not 'bottom': PILL_TEXT_OFFSET_EM already measures to
          // the pill's center, so 'bottom' would push the glyph above it.
          'text-anchor': 'center',
          'text-offset': [0, PILL_TEXT_OFFSET_EM],
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

    return () => map.remove()
    // center/zoom are just the initial camera; a region change already
    // remounts via `key={region.id}` in MapView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, stations, tilesFile, groupByState])

  return <div ref={containerRef} className="h-full w-full" />
}
