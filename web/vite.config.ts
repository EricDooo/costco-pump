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
      '/costcogas/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/costcogas\/api/, ''),
      },
    },
  },
})
