/// <reference types="vite/client" />

interface ImportMetaEnv {
  // See lib/tiles.ts -- dev-only override to point the basemap at a local
  // .pmtiles file instead of the production URL.
  readonly VITE_TILES_URL?: string
}
