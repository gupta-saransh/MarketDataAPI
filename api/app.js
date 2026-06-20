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
  const ENDPOINT_TYPE = {
    '/schemes/:code/nav/latest': 'nav_latest',
    '/schemes/:code/nav':        'nav_history',
    '/schemes/isin/:isin':       'isin_lookup',
    '/schemes/:code':            'scheme_detail',
    '/schemes/':                 'search',
    '/schemes':                  'search',
    '/fund-houses/':             'fund_houses',
    '/fund-houses':              'fund_houses',
    '/categories/':              'categories',
    '/categories':               'categories',
    '/sync-nav':                 'sync',
  }

  app.addHook('onResponse', (req, reply, done) => {
    if (req.url === '/health' || req.url.startsWith('/openapi.json')) return done()

    if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
      const route       = req.routeOptions?.url ?? req.url
      const schemeMatch = req.url.match(/\/schemes\/(\d+)/)
      const isinMatch   = req.url.match(/\/schemes\/isin\/([A-Z0-9]+)/i)

      fetch(`https://api.axiom.co/v1/datasets/${process.env.AXIOM_DATASET}/ingest`, {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${process.env.AXIOM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          _time:          new Date().toISOString(),
          method:         req.method,
          route,
          endpoint_type:  ENDPOINT_TYPE[route] ?? 'other',
          status:         reply.statusCode,
          ms:             Math.round(reply.elapsedTime),
          scheme_code:    schemeMatch?.[1]                        ?? undefined,
          isin:           isinMatch?.[1]                          ?? undefined,
          q:              req.query?.q                            ?? undefined,
          fund_house_id:  req.query?.fund_house_id                ?? undefined,
          category_id:    req.query?.category_id                  ?? undefined,
          broad_category: req.query?.broad_category               ?? undefined,
          start_date:     req.query?.startDate                    ?? undefined,
          end_date:       req.query?.endDate                      ?? undefined,
          ip:             req.headers['x-forwarded-for'] ?? req.ip,
          country:        req.headers['x-vercel-ip-country']      ?? undefined,
          city:           req.headers['x-vercel-ip-city']         ?? undefined,
          ua:             req.headers['user-agent']               ?? undefined,
          referer:        req.headers['referer']                  ?? undefined,
        }]),
      }).catch(() => {})
    }

    done()
  })

  return app
}
