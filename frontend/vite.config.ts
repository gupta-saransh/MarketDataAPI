import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the explorer calls `/api/*` (same path it uses in production on
// Vercel). We proxy that to the local Fastify server on :3001, stripping the
// `/api` prefix so the backend's unprefixed routes (/health, /schemes) match.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
