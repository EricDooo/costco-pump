import { DARK, LIGHT, layers, type Flavor } from '@protomaps/basemaps'
import type { FeatureCollection, Point } from 'geojson'
import {
  Map as MaplibreMap,
  NavigationControl,
  Popup,
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
const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'
const LABEL_FONT = 'Noto Sans Regular'
// The basemap's own POI icons (town/capital dots, etc -- unrelated to the
// price pills below) come from a sprite sheet, one per flavor. Missing
// this was a real bug: every place-label layer that references an icon
// logged "Image ... could not be loaded" (harmless on its own -- those
// layers just render text with no icon -- but worth fixing since it's
// what the official style expects).

// Individual stations render as a price-tag pill (a rounded badge with a
// small pointer tail, like GasBuddy/most real gas-price maps) instead of a
// plain dot -- shows the actual price at a glance, no click needed. Each
// tier is a separately pre-rendered image (see makePillImage) registered
// with the map once at load; icon-image below picks one per feature by
// price via a step expression. Fixed-size rather than stretched to fit
// each price's text width (MapLibre's icon-text-fit can do that, but needs
// a 9-slice image and careful anchor math to keep the tail undistorted --
// not worth it when every domestic price is "$X.XX", a narrow, predictable
// width).
const PRICE_TIERS: { id: string; color: string; max: number }[] = [
  { id: 'pill-1', color: '#4ade80', max: 3.25 },
  { id: 'pill-2', color: '#a3e635', max: 3.75 },
  { id: 'pill-3', color: '#facc15', max: 4.25 },
  { id: 'pill-4', color: '#fb923c', max: 4.75 },
  { id: 'pill-5', color: '#f87171', max: Infinity },
]
const PILL_FALLBACK_ID = 'pill-unknown'

// All in CSS px (the canvas is drawn at 2x and registered with pixelRatio 2
// for crisp text -- see makePillImage). Kept as constants because the text
// vertical offset below has to line up with this exact geometry.
const PILL_W = 48
const PILL_H = 20
const PILL_RADIUS = 10
const TAIL_H = 6
const PILL_TEXT_SIZE = 11
// Distance from the image's bottom edge (the tail tip -- see icon-anchor
// below) up to the pill's vertical center, converted to ems of
// PILL_TEXT_SIZE the way MapLibre's text-offset expects.
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

/** Registers every pill tier image with this map instance -- images are
 * per-Map-instance state, so this has to re-run each time GasMap creates a
 * new one (see the effect below, which rebuilds the whole map rather than
 * patching an existing one). Safe to call once the map's 'load' event has
 * fired, before any symbol layer referencing these ids actually renders. */
function registerPillImages(map: MaplibreMap) {
  for (const tier of PRICE_TIERS) {
    if (!map.hasImage(tier.id)) map.addImage(tier.id, makePillImage(tier.color), { pixelRatio: 2 })
  }
  if (!map.hasImage(PILL_FALLBACK_ID)) map.addImage(PILL_FALLBACK_ID, makePillImage('#9ca3af'), { pixelRatio: 2 })
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

function buildStyle(flavorName: 'light' | 'dark', stations: StationSummary[], tilesFile: string): StyleSpecification {
  const flavor = flavorByName(flavorName)
  return {
    version: 8,
    glyphs: GLYPHS_URL,
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
      },
    },
    layers: [
      ...layers(SOURCE_ID, flavor, { lang: 'en' }),
      {
        id: 'clusters',
        type: 'circle',
        source: STATIONS_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#7dd3fc',
            10,
            '#38bdf8',
            25,
            '#0ea5e9',
            50,
            '#6366f1',
            100,
            '#7c3aed',
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
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': [LABEL_FONT],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      },
      {
        id: 'unclustered-point',
        type: 'symbol',
        source: STATIONS_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
          // Fixed-size price-tag pill per PRICE_TIERS (registerPillImages
          // pre-renders one image per tier) -- picks the tier by price,
          // pill-unknown for a station with no live reading yet.
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
          // Deliberately no allow-overlap: MapLibre's default collision
          // detection hides a pill (icon+text together, since both are in
          // one symbol layer) when it would overlap an already-placed one
          // -- forcing allow-overlap:true here overrode that and produced
          // a wall of stacked, illegible pills in any dense metro area at
          // the zoom where clusters first break apart. Letting collision
          // detection do its job means denser areas just show fewer pills
          // until you zoom in further, same as any map's place labels.
          'text-field': [
            'case',
            ['==', ['get', 'regular_price'], null],
            '--',
            ['concat', '$', ['number-format', ['get', 'regular_price'], { 'min-fraction-digits': 2, 'max-fraction-digits': 2 }]],
          ],
          'text-font': [LABEL_FONT],
          'text-size': PILL_TEXT_SIZE,
          'text-anchor': 'bottom',
          'text-offset': [0, PILL_TEXT_OFFSET_EM],
        },
        // Dark text reads fine against every tier color (greens through
        // red) -- simpler than a per-tier text color and no worse contrast
        // than a plain white pill would need anyway.
        paint: { 'text-color': '#111111' },
      },
    ],
  }
}

function escapeHtml(s: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return s.replace(/[&<>"']/g, (c) => entities[c]!)
}

function popupHtml(props: Record<string, unknown>): string {
  const price = typeof props.regular_price === 'number' ? `$${props.regular_price.toFixed(2)}` : '--'
  const href = `${import.meta.env.BASE_URL}stations/${props.id}`
  // Outside the React tree (MapLibre owns this DOM), so plain markup and a
  // real <a href> -- it's a full navigation, not a client-side route change,
  // but Caddy's try_files sends any /costcogas/* deep link to index.html so
  // React Router still resolves it correctly on load.
  // Explicit color on the wrapper: this HTML sits in MapLibre's own popup
  // bubble (always a white background, light or dark site theme alike), but
  // it's still parsed as part of this page's DOM, so without this it
  // inherits the app's --foreground -- near-white in dark mode, invisible
  // text on a white bubble.
  return `
    <div style="font: 13px system-ui, sans-serif; min-width: 160px; color: #111;">
      <div style="font-weight: 600; margin-bottom: 2px;">${escapeHtml(String(props.name ?? ''))}</div>
      <div style="color: #666; margin-bottom: 6px;">${escapeHtml(String(props.city ?? ''))}, ${escapeHtml(String(props.state ?? ''))}</div>
      <div style="font-family: ui-monospace, monospace; font-size: 14px; margin-bottom: 6px;">${price} <span style="color: #666; font-size: 11px;">regular</span></div>
      <a href="${href}" style="color: #2563eb; text-decoration: underline;">View details →</a>
    </div>
  `
}

interface GasMapProps {
  stations: StationSummary[]
  /** Filename under /costcogas/tiles/ for this region's basemap extract --
   * see lib/regions.ts. */
  tilesFile: string
  center: [number, number]
  zoom: number
}

/** Map of every station in the current region with a live price, clustered
 * by proximity. Basemap is a self-hosted Protomaps PMTiles extract (see
 * lib/tiles.ts) -- no third-party map API key or quota. */
export function GasMap({ stations, tilesFile, center, zoom }: GasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()

  // One effect, re-run in full on theme or station-data change: tears down
  // and recreates the whole map rather than trying to patch an existing one
  // via setStyle. Simpler, and sidesteps a real bug an earlier two-effect
  // version had -- a "mount" effect plus a separate "update" effect guarded
  // by a mountedRef both run in the same commit pass, so the guard didn't
  // actually skip the update effect's first run; it fired a second,
  // redundant setStyle() immediately after construction, while the pmtiles
  // source's first header read was still in flight. Neither change happens
  // often (a handful of times per session at most), so recreating outright
  // costs nothing that matters.
  useEffect(() => {
    if (!containerRef.current) return
    ensureMaplibreSetup()

    const map = new MaplibreMap({
      container: containerRef.current,
      style: buildStyle(resolvedFlavorName(theme), stations, tilesFile),
      center,
      zoom,
      minZoom: 1,
      maxZoom: 16,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => registerPillImages(map))
    // MapLibre doesn't throw or reject on a style/source/tile problem, it
    // fires this event -- with nothing listening, that's silent failure. Cost
    // real debugging time tracking down a production-only bug this way
    // (see maplibreSetup.ts): the map just sat blank with an empty console.
    map.on('error', (e) => console.error('MapLibre error:', e.error))

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
      if (!feature) return
      const [lng, lat] = (feature.geometry as Point).coordinates
      new Popup({ closeButton: true, offset: 10 })
        .setLngLat([lng, lat])
        .setHTML(popupHtml(feature.properties ?? {}))
        .addTo(map)
    })

    for (const layerId of ['clusters', 'unclustered-point']) {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    return () => map.remove()
    // center is a tuple from regions.ts's static REGIONS array, so it's a
    // stable reference per region (not a fresh array each render) as long
    // as the caller passes region.center straight through -- see MapView.tsx.
  }, [theme, stations, tilesFile, center, zoom])

  return <div ref={containerRef} className="h-full w-full" />
}
