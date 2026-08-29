import { addProtocol, setWorkerUrl } from 'maplibre-gl'
import { Protocol } from 'pmtiles'

// Vite never bundles this (a raw sibling file in the npm package, not an
// import) -- copied verbatim into public/ instead. Re-copy by hand on a
// maplibre-gl bump: `cp node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs web/public/`.
const WORKER_URL = `${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`

// Module-level and idempotent -- React may mount GasMap more than once.
let ready = false

export function ensureMaplibreSetup() {
  if (ready) return

  setWorkerUrl(WORKER_URL)

  // Registers pmtiles:// so a style can read tiles from a single file
  // via HTTP range requests -- no tile server needed.
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)

  ready = true
}
