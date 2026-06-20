/**
 * app.js — Fastify application factory.
 *
 * Builds and configures the Fastify instance WITHOUT calling .listen().
 * Used by:
 *   • server.js  — local dev / always-on host (calls .listen)
 *   • vercel.js  — Vercel serverless handler (emits requests into app.server)
 */

import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'

import { sql } from './db/index.js'
import { openapi } from './openapi.js'

import fundHousesRoutes from './routes/fund-houses.js'
import categoriesRoutes from './routes/categories.js'
import schemesRoutes    from './routes/schemes.js'
import syncRoutes       from './routes/sync.js'

export async function build(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? true })

  // Public API — open CORS so anyone can call it from the browser.
  await app.register(cors, { origin: '*' })

  await app.register(fundHousesRoutes, { prefix: '/fund-houses' })
  await app.register(categoriesRoutes, { prefix: '/categories' })
  await app.register(schemesRoutes,    { prefix: '/schemes' })
  await app.register(syncRoutes)

  app.get('/health', async () => ({ status: 'ok', driver: sql.driver }))

  // Machine-readable spec — the frontend explorer renders this.
  app.get('/openapi.json', async () => openapi)

  // Analytics — fire-and-forget ingest to Axiom (no log drain needed).
  // Skips if AXIOM_TOKEN / AXIOM_DATASET are unset (safe in local dev).
  app.addHook('onResponse', (req, reply, done) => {
    if (req.url === '/health' || req.url.startsWith('/openapi.json')) return done()

    if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
      const schemeMatch = req.url.match(/\/schemes\/(\d+)/)
      const isinMatch   = req.url.match(/\/schemes\/isin\/([A-Z0-9]+)/i)

      fetch(`https://api.axiom.co/v1/datasets/${process.env.AXIOM_DATASET}/ingest`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${process.env.AXIOM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          _time:       new Date().toISOString(),
          method:      req.method,
          route:       req.routeOptions?.url ?? req.url,
          status:      reply.statusCode,
          ms:          Math.round(reply.elapsedTime),
          scheme_code: schemeMatch?.[1] ?? undefined,
          isin:        isinMatch?.[1]   ?? undefined,
          q:           req.query?.q     ?? undefined,
        }]),
      }).catch(() => {})
    }

    done()
  })

  return app
}
