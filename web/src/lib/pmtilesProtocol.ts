import { addProtocol } from 'maplibre-gl'
import { FetchSource, PMTiles, Protocol } from 'pmtiles'
import { DOMESTIC_TILES_URL } from './tiles'

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

  // Pre-register the domestic archive with a `Cache-Control: no-cache`
  // *request* header, rather than letting pmtiles.js open a plain fetch()
  // with the browser's default caching. Reproduced in practice: a browser
  // that had ever cached a wrong response at this exact URL (e.g. during a
  // deploy window before the Caddy route existed, or before a Cache-Control
  // fix landed -- both happened once) kept serving those wrong bytes
  // indefinitely with default caching, silently blanking the whole map with
  // no error. `no-cache` still allows a fast ETag-revalidated 304 -- it
  // just forces that round-trip instead of trusting a cached body blindly,
  // which is the one thing that actually matters here. `protocol.add`
  // makes any `pmtiles://<this exact URL>` reference in a style resolve to
  // this hardened instance instead of one pmtiles.js would construct itself
  // with plain defaults.
  const source = new FetchSource(DOMESTIC_TILES_URL, new Headers({ 'Cache-Control': 'no-cache' }))
  protocol.add(new PMTiles(source))

  addProtocol('pmtiles', protocol.tile)
  registered = true
}
