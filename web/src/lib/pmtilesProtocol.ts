import { addProtocol } from 'maplibre-gl'
import { Protocol } from 'pmtiles'

// Registers the pmtiles:// URL scheme with MapLibre so a style's source can
// read tiles directly out of a single .pmtiles file (see lib/tiles.ts) via
// HTTP range requests -- no tile server process needed at all. Module-level
// and idempotent: MapLibre's protocol registry is global to the page, and
// React may mount GasMap more than once (StrictMode, route changes), so
// this must not double-register.
//
// Deliberately the plain form, not pre-registering a PMTiles/FetchSource
// instance with custom request headers (tried that, to force
// Cache-Control: no-cache and dodge a stale-cache issue -- see git history
// if reviving it): MapLibre resolves the style's relative
// `pmtiles://${DOMESTIC_TILES_URL}` reference to an absolute URL before it
// reaches this protocol, which didn't match the relative URL the
// pre-registered instance was keyed on in production (lib/tiles.ts's prod
// branch is relative; only the dev branch is absolute, which is why that
// version tested fine locally and broke prod). Fixed the actual stale-cache
// problem at the source instead -- see ericdoo-infra's Caddyfile, a short
// max-age instead of immutable+7d.
let registered = false

export function ensurePmtilesProtocol() {
  if (registered) return
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)
  registered = true
}
