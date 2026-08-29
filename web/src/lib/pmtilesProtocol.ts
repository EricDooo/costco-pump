import { addProtocol } from 'maplibre-gl'
import { Protocol } from 'pmtiles'

// Registers the pmtiles:// URL scheme with MapLibre so a style's source can
// read tiles directly out of a single .pmtiles file (see lib/tiles.ts) via
// HTTP range requests -- no tile server process needed at all. Module-level
// and idempotent: MapLibre's protocol registry is global to the page, and
// React may mount GasMap more than once (StrictMode, route changes), so
// this must not double-register.
let registered = false

export function ensurePmtilesProtocol() {
  if (registered) return
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)
  registered = true
}
