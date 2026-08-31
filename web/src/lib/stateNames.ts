// US states + Canadian provinces -- the only two code sets that ever land
// in a domestic StationSummary's `state` field (see regions.ts).
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  PR: 'Puerto Rico',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
}

export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code
}

// EIA's PADD (Petroleum Administration for Defense District) regions --
// mirrors api/app/scraper/eia.py's REGION_CODES/PADD_BY_STATE. "R10" (plain
// PADD 1) never actually appears in a RegionalComparison row (every state
// maps to one of its 1A/1B/1C sub-regions instead), but it's included here
// since the API's national/summary context could reasonably show it.
const PADD_REGION_LABELS: Record<string, string> = {
  NUS: 'National',
  R10: 'PADD 1 -- East Coast',
  R1X: 'PADD 1A -- New England',
  R1Y: 'PADD 1B -- Central Atlantic',
  R1Z: 'PADD 1C -- Lower Atlantic',
  R20: 'PADD 2 -- Midwest',
  R30: 'PADD 3 -- Gulf Coast',
  R40: 'PADD 4 -- Rocky Mountain',
  R50: 'PADD 5 -- West Coast',
}

export function paddRegionLabel(code: string): string {
  return PADD_REGION_LABELS[code] ?? code
}
