// Self-hosted Protomaps PMTiles basemaps, served as static files by Caddy --
// no third-party API key or tile server. See lib/regions.ts for filenames.
export function tilesUrlFor(filename: string): string {
  // Dev points at the production URL by default (CORS-open, public data) --
  // override with VITE_TILES_URL to test against a local file instead.
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_TILES_URL ?? `https://ericdoo.com/costcogas/tiles/${filename}`
  }
  return `${import.meta.env.BASE_URL}tiles/${filename}`
}
