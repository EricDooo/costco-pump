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
import { ensurePmtilesProtocol } from '../lib/pmtilesProtocol'
import { DOMESTIC_TILES_URL } from '../lib/tiles'

const SOURCE_ID = 'protomaps'
const STATIONS_SOURCE_ID = 'stations'
const GLYPHS_URL = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'
const LABEL_FONT = 'Noto Sans Regular'

function resolvedFlavor(theme: 'light' | 'dark' | 'system'): Flavor {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? DARK : LIGHT
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

function buildStyle(flavor: Flavor, stations: StationSummary[]): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      [SOURCE_ID]: {
        type: 'vector',
        url: `pmtiles://${DOMESTIC_TILES_URL}`,
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
        type: 'circle',
        source: STATIONS_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          // Same semantic colors as theme.css's --positive/--negative --
          // cheap is green, expensive is red, regardless of light/dark
          // basemap flavor (a price marker's color means the same thing
          // either way). 4 is the fallback for a station with no live
          // reading yet, landing it mid-scale rather than at an extreme.
          'circle-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'regular_price'], 4],
            2.5,
            '#1a7f37',
            3.75,
            '#eab308',
            5,
            '#cf222e',
          ],
          'circle-radius': 7,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
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

/** National map of every domestic (US/CA/UK) station with a live price,
 * clustered by proximity. Basemap is a self-hosted Protomaps PMTiles
 * extract (see lib/tiles.ts) -- no third-party map API key or quota. */
export function GasMap({ stations }: { stations: StationSummary[] }) {
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
    ensurePmtilesProtocol()

    const map = new MaplibreMap({
      container: containerRef.current,
      style: buildStyle(resolvedFlavor(theme), stations),
      center: [-98, 39],
      zoom: 3.3,
      minZoom: 2,
      maxZoom: 16,
      attributionControl: { compact: true },
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')

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
  }, [theme, stations])

  return <div ref={containerRef} className="h-full w-full" />
}
