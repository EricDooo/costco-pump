import { addProtocol, setWorkerUrl } from 'maplibre-gl'
// The `?url` suffix is a Vite convention: instead of bundling this file's
// contents, Vite copies it to the output dir as-is and gives back its final
// hashed URL. Needed because maplibre-gl-worker.mjs is a raw sibling file in
// the npm package (not something exported as a JS module maplibre-gl.mjs
// imports), so a plain `import` would never pick it up -- and without this,
// maplibre-gl's default worker loading assumes it's sitting right next to
// wherever the *unbundled* library would have loaded from, which isn't true
// once Vite bundles everything into its own hashed chunks. Confirmed via a
// real production build: the worker request 404'd, and because Caddy's SPA
// fallback (try_files -> index.html) turns every 404 under /costcogas/*
// into a 200 of HTML, the browser refused to run it as a module script
// ("non-JavaScript MIME type") instead of surfacing a clean 404 -- which is
// also why this had no visible network-tab signal pointing at a missing
// file. Confirmed working in `bun run dev` prior to this fix only because
// dev mode's dependency pre-bundling happens to lay files out differently.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Protocol } from 'pmtiles'

// Both of these are global, one-time setup MapLibre needs before any Map is
// constructed -- module-level and idempotent, since React may mount GasMap
// more than once (StrictMode, route changes).
let ready = false

export function ensureMaplibreSetup() {
  if (ready) return

  setWorkerUrl(maplibreWorkerUrl)

  // Registers the pmtiles:// URL scheme so a style's source can read tiles
  // directly out of a single .pmtiles file (see lib/tiles.ts) via HTTP
  // range requests -- no tile server process needed at all.
  const protocol = new Protocol()
  addProtocol('pmtiles', protocol.tile)

  ready = true
}
