import type { StationSummary } from './api'

const EARTH_RADIUS_MILES = 3958.8

function milesBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

export interface PriceComparison {
  min: number
  max: number
  avg: number
  count: number
  /** 1 = priciest in the group. */
  rank: number
}

export interface PriceComparisons {
  national: PriceComparison | null
  /** null where `state` isn't a real subdivision (see regions.ts). */
  state: PriceComparison | null
  nearby: PriceComparison | null
}

const NEARBY_RADIUS_MILES = 25

function summarize(price: number, prices: number[]): PriceComparison | null {
  if (prices.length === 0) return null
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((sum, p) => sum + p, 0) / prices.length,
    count: prices.length,
    rank: prices.filter((p) => p > price).length + 1,
  }
}

function pricesOf(stations: StationSummary[]): number[] {
  return stations.flatMap((s) => (s.regular_price !== null ? [s.regular_price] : []))
}

/** How a station's price ranks within three peer groups -- `peers` should
 * already be scoped to the same region/currency as `station`. */
export function priceComparisons(station: StationSummary, peers: StationSummary[]): PriceComparisons {
  if (station.regular_price === null) return { national: null, state: null, nearby: null }
  const price = station.regular_price
  return {
    national: summarize(price, pricesOf(peers)),
    state: station.state ? summarize(price, pricesOf(peers.filter((s) => s.state === station.state))) : null,
    nearby: summarize(
      price,
      pricesOf(peers.filter((s) => milesBetween(station.lat, station.lon, s.lat, s.lon) <= NEARBY_RADIUS_MILES)),
    ),
  }
}
