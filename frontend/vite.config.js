var _a;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// In dev, the explorer calls `/api/*` (same path it uses in production on
// Vercel). We proxy that to the local Fastify server on :3001, stripping the
// `/api` prefix so the backend's unprefixed routes (/health, /schemes) match.
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            '/api': {
                target: (_a = process.env.VITE_DEV_API_TARGET) !== null && _a !== void 0 ? _a : 'http://localhost:3001',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
            },
        },
    },
});
