import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served by Caddy at /costcogas -- base and the dev proxy both need to agree
// with that path, or every asset 404s once this leaves `vite dev`.
export default defineConfig({
  base: '/costcogas/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Defaults to the local API (api/ run separately, see README) --
      // FastAPI itself has no /costcogas prefix, so that part of the path
      // is stripped before forwarding. Point at prod instead for
      // frontend-only work with real data and no local API/DB needed:
      // `VITE_API_PROXY_TARGET=https://ericdoo.com bun run dev` -- prod
      // goes through Caddy, which expects (and strips) that prefix itself,
      // so it must survive uncut on that path.
      '/costcogas/api': process.env.VITE_API_PROXY_TARGET
        ? { target: process.env.VITE_API_PROXY_TARGET, changeOrigin: true }
        : {
            target: 'http://localhost:8000',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/costcogas\/api/, ''),
          },
    },
  },
  // `bun run build && bun run preview` -- tests the actual production
  // bundle (unlike `bun run dev`, which pre-bundles dependencies
  // differently and completely masked a real maplibre-gl-worker-loading
  // bug that only ever showed up in a real build; see maplibreSetup.ts).
  // Defaults both proxies to prod since there's no local equivalent worth
  // proxying to for testing a production build specifically; override with
  // the same VITE_API_PROXY_TARGET as dev if that ever changes.
  preview: {
    proxy: {
      '/costcogas/api': { target: process.env.VITE_API_PROXY_TARGET ?? 'https://ericdoo.com', changeOrigin: true },
      '/costcogas/tiles': { target: process.env.VITE_API_PROXY_TARGET ?? 'https://ericdoo.com', changeOrigin: true },
    },
  },
  optimizeDeps: {
    // maplibre-gl bundles its own tile-parsing web worker; Vite's dep
    // pre-bundling rewrites its worker URL in a way that leaves the worker
    // permanently pending in dev (confirmed: zero tile requests ever fire,
    // no error either -- it just never starts). Excluding it from
    // pre-bundling is the documented fix.
    exclude: ['maplibre-gl'],
  },
})
