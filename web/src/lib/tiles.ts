// Self-hosted Protomaps PMTiles basemaps -- static files served by Caddy
// (see ericdoo-infra's Caddyfile, the /costcogas/tiles/* route -- a plain
// directory file_server, so any filename dropped there is servable with no
// route changes needed). Built and refreshed by scripts/update-tiles.sh
// (domestic) and scripts/update-international-tiles.sh (everyone else). No
// third-party API key, no account, no monthly quota: pmtiles.js reads them
// via HTTP range requests, so hosting is just a static file, not a tile
// server. See lib/regions.ts for which filename each region uses.
export function tilesUrlFor(filename: string): string {
  // In dev this points straight at the production URL by default instead
  // of needing a local copy of every region's file -- the tiles route sets
  // Access-Control-Allow-Origin: * for exactly that (public, read-only map
  // data, nothing sensitive about it). Override with VITE_TILES_URL to
  // test against a single local file instead, e.g. serving one via
  // `pmtiles serve` or a plain static server:
  // `VITE_TILES_URL=http://localhost:8090/ bun run dev` -- applies
  // regardless of which region is selected, since it's a one-file-at-a-time
  // dev convenience, not meant to stand in for all eleven at once.
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_TILES_URL ?? `https://ericdoo.com/costcogas/tiles/${filename}`
  }
  return `${import.meta.env.BASE_URL}tiles/${filename}`
}
