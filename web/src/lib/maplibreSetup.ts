import { addProtocol, setWorkerUrl } from 'maplibre-gl'
import { Protocol } from 'pmtiles'

// maplibre-gl-worker.mjs ships as a raw sibling file in the npm package
// (not something maplibre-gl.mjs itself `import`s), so Vite's build never
// bundles it as a chunk on its own -- and the file itself has its own
// hardcoded `import ... from "./maplibre-gl-shared.mjs"`, a second raw
// sibling. Both are copied verbatim into public/ (see that directory) and
// served with their original unhashed names, exactly as the npm package
// ships them, so the worker's relative import resolves correctly against
// wherever it's served from -- the same arrangement the unbundled library
// has on disk, just relocated. Tried making Vite track these properly
// (`?url`/`?raw` imports, patching the worker's import at runtime via a
// blob: URL) first; that half-worked -- the worker file loaded, but
// something about a blob:-sourced module worker's own relative resolution
// of *its* import never actually got tile data flowing, reproduced
// consistently with no error surfaced anywhere. This plain, boring
// approach is what real production maplibre-gl+Vite deployments use.
// Downside: these two files need re-copying by hand on a maplibre-gl
// version bump (`cp node_modules/maplibre-gl/dist/maplibre-gl-{worker,shared}.mjs web/public/`) --
// a stale copy would fail loudly (worker errors, surfaced via GasMap.tsx's
// map.on('error', ...) now), not silently.
const WORKER_URL = `${import.meta.env.BASE_URL}maplibre-gl-worker.mjs`

// Both of these are global, one-time setup MapLibre needs before any Map is
// constructed -- module-level and idempotent, since React may mount GasMap
// more than once (StrictMode, route changes).
let ready = false

export function ensureMaplibreSetup() {
  if (ready) return

  setWorkerUrl(WORKER_URL)

  // Registers the pmtiles:// URL scheme so a style's source can read tiles
  // directly out of a single .pmtiles file (see lib/tiles.ts) via HTTP
  // range requests -- no tile server process needed at all.
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)

  ready = true
}
