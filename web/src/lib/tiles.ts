// Self-hosted Protomaps PMTiles basemap -- a single static file served by
// Caddy (see ericdoo-infra's Caddyfile, the /costcogas/tiles/* route), built
// and refreshed by scripts/update-tiles.sh. No third-party API key, no
// account, no monthly quota: pmtiles.js reads it via HTTP range requests,
// so hosting it is just a static file, not a tile server.
//
// In dev this points straight at the production URL by default instead of
// needing a ~1GB local copy -- the tiles route sets
// Access-Control-Allow-Origin: * for exactly that (public, read-only map
// data, nothing sensitive about it). Override with VITE_TILES_URL to point
// at a local file instead, e.g. serving one via `pmtiles serve` or a plain
// static server: `VITE_TILES_URL=http://localhost:8090/ bun run dev`.
export const DOMESTIC_TILES_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_TILES_URL ?? 'https://ericdoo.com/costcogas/tiles/domestic.pmtiles')
  : `${import.meta.env.BASE_URL}tiles/domestic.pmtiles`
