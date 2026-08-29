import type { StationSummary } from './api'

// Canadian province/territory codes -- the only thing that distinguishes a
// Canadian row from a US one in warehouses.state (see scraper/client.py,
// both come from the same warehouses.json call). UK rows have no state at
// all (postcodes, not state codes -- checked in production: state is ''
// for every UK warehouse).
export const CA_PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'])

export type RegionId =
  | 'us'
  | 'ca'
  | 'uk'
  | 'australia'
  | 'japan'
  | 'mexico'
  | 'taiwan'
  | 'spain'
  | 'france'
  | 'korea'
  | 'iceland'

export interface Region {
  id: RegionId
  label: string
  /** Filename under /costcogas/tiles/ -- see scripts/update-tiles.sh
   * (domestic) and scripts/update-international-tiles.sh (everyone else).
   * us/ca/uk all share one extract since warehouses.json bundles all three
   * into the same "domestic" bucket and the same geographic bbox. */
  tilesFile: string
  center: [number, number]
  zoom: number
  /** Whether this region shows the "cheapest states" card -- only
   * meaningful where stats/summary's per-state breakdown applies (US/CA
   * share one warehouses table with real state/province codes; nothing
   * else has an equivalent grouping). */
  showStateBreakdown: boolean
  matches: (station: StationSummary) => boolean
}

// warehouses.json's US/Canada/UK ids stay below this; scraper/international.py
// hashes every other country into 900_000+ blocks (see that module's
// docstring).
const DOMESTIC_ID_CEILING = 900_000

function isDomestic(s: StationSummary): boolean {
  return s.id < DOMESTIC_ID_CEILING
}

function internationalRegion(min: number, max: number): (s: StationSummary) => boolean {
  return (s) => s.id >= min && s.id < max
}

export const REGIONS: Region[] = [
  {
    id: 'us',
    label: 'United States',
    tilesFile: 'domestic.pmtiles',
    center: [-98, 39],
    zoom: 3.3,
    showStateBreakdown: true,
    matches: (s) => isDomestic(s) && !CA_PROVINCES.has(s.state) && s.state !== '',
  },
  {
    id: 'ca',
    label: 'Canada',
    tilesFile: 'domestic.pmtiles',
    center: [-96, 61],
    zoom: 2.6,
    showStateBreakdown: true,
    matches: (s) => isDomestic(s) && CA_PROVINCES.has(s.state),
  },
  {
    id: 'uk',
    label: 'United Kingdom',
    tilesFile: 'domestic.pmtiles',
    center: [-2, 54],
    zoom: 5,
    showStateBreakdown: false,
    matches: (s) => isDomestic(s) && s.state === '',
  },
  {
    id: 'australia',
    label: 'Australia',
    tilesFile: 'australia.pmtiles',
    center: [134, -28],
    zoom: 3.2,
    showStateBreakdown: false,
    matches: internationalRegion(900_000, 910_000),
  },
  {
    id: 'japan',
    label: 'Japan',
    tilesFile: 'japan.pmtiles',
    center: [138, 37],
    zoom: 4.3,
    showStateBreakdown: false,
    matches: internationalRegion(910_000, 920_000),
  },
  {
    id: 'mexico',
    label: 'Mexico',
    tilesFile: 'mexico.pmtiles',
    center: [-102, 23],
    zoom: 4.2,
    showStateBreakdown: false,
    matches: internationalRegion(920_000, 930_000),
  },
  {
    id: 'taiwan',
    label: 'Taiwan',
    tilesFile: 'taiwan.pmtiles',
    center: [121, 23.7],
    zoom: 6.5,
    showStateBreakdown: false,
    matches: internationalRegion(930_000, 940_000),
  },
  {
    id: 'spain',
    label: 'Spain',
    tilesFile: 'spain.pmtiles',
    center: [-3.7, 40],
    zoom: 5,
    showStateBreakdown: false,
    matches: internationalRegion(940_000, 950_000),
  },
  {
    id: 'france',
    label: 'France',
    tilesFile: 'france.pmtiles',
    center: [2.5, 46.5],
    zoom: 5,
    showStateBreakdown: false,
    matches: internationalRegion(950_000, 960_000),
  },
  {
    id: 'korea',
    label: 'Korea',
    tilesFile: 'korea.pmtiles',
    center: [127.5, 36],
    zoom: 6,
    showStateBreakdown: false,
    matches: internationalRegion(960_000, 970_000),
  },
  {
    id: 'iceland',
    label: 'Iceland',
    tilesFile: 'iceland.pmtiles',
    center: [-19, 65],
    zoom: 5,
    showStateBreakdown: false,
    matches: internationalRegion(970_000, 980_000),
  },
]

export function regionById(id: RegionId): Region {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0]!
}
