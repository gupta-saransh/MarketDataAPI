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

  return app
}
