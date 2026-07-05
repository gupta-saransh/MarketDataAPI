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
import rateLimit from '@fastify/rate-limit'

import { sql } from './db/index.js'
import { openapi } from './openapi.js'

import fundHousesRoutes from './routes/fund-houses.js'
import categoriesRoutes from './routes/categories.js'
import schemesRoutes    from './routes/schemes.js'
import analyticsRoutes  from './routes/analytics.js'
import navRoutes        from './routes/nav.js'
import syncRoutes       from './routes/sync.js'
import mcpRoutes        from './routes/mcp.js'

// Per-route-prefix edge cache policy. NAV updates at most once a day (AMFI
// publishes daily), catalogs almost never change, and search tolerates a short
// cache, so each class gets its own TTL instead of one blanket policy.
// s-maxage is honoured by Vercel's edge cache; clients see the same header.
const DAY = 86400
const CACHE_RULES = [
  ['/fund-houses',  `public, s-maxage=${DAY}, stale-while-revalidate=${DAY}`],
  ['/categories',   `public, s-maxage=${DAY}, stale-while-revalidate=${DAY}`],
  ['/openapi.json', `public, s-maxage=3600, stale-while-revalidate=${DAY}`],
  ['/nav/latest',   `public, s-maxage=1800, stale-while-revalidate=${DAY}`],
  ['/schemes',      `public, s-maxage=1800, stale-while-revalidate=${DAY}`],
]

function cacheControlFor(url) {
  const path = url.split('?')[0]
  for (const [prefix, value] of CACHE_RULES) if (path.startsWith(prefix)) return value
  return null
}

export async function build(opts = {}) {
  // trustProxy lets Fastify derive req.ip from X-Forwarded-For — required for
  // correct per-client rate limiting behind Vercel's proxy.
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true })

  // Public API — open CORS so anyone can call it from the browser.
  await app.register(cors, { origin: '*' })

  // Rate limit every client (keyed by IP). In-memory store: on Vercel this is
  // per-warm-container, so it throttles bursts rather than enforcing a global
  // cap — good enough to blunt abuse without a Redis dependency.
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 2500),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
  })

  // Hide internal error details from clients (info disclosure). 4xx messages
  // are safe and preserved; 5xx are logged server-side and returned generic.
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 500
    if (status >= 500) {
      req.log.error(err)
      return reply.code(500).send({ error: 'Internal Server Error' })
    }
    return reply.code(status).send({ error: err.message })
  })

  // Security headers on every response. The API serves JSON only, so a
  // restrictive CSP is safe; HSTS matters because the API is public HTTPS.
  app.addHook('onSend', (req, reply, payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')

    // Edge caching for cacheable GET responses only; errors and writes stay uncached.
    if (req.method === 'GET' && reply.statusCode === 200) {
      const cc = cacheControlFor(req.url)
      if (cc) reply.header('Cache-Control', cc)
    }
    done(null, payload)
  })

  await app.register(fundHousesRoutes, { prefix: '/fund-houses' })
  await app.register(categoriesRoutes, { prefix: '/categories' })
  await app.register(schemesRoutes,    { prefix: '/schemes' })
  await app.register(analyticsRoutes,  { prefix: '/schemes' })
  await app.register(navRoutes)
  await app.register(syncRoutes)
  await app.register(mcpRoutes)

  app.get('/health', async () => ({ status: 'ok', driver: sql.driver }))

  // Machine-readable spec — the frontend explorer renders this.
  app.get('/openapi.json', async () => openapi)

  // Analytics — fire-and-forget ingest to Axiom (no log drain needed).
  // Skips if AXIOM_TOKEN / AXIOM_DATASET are unset (safe in local dev).
  const ENDPOINT_TYPE = {
    '/schemes/:code/nav/latest': 'nav_latest',
    '/schemes/:code/nav':        'nav_history',
    '/schemes/:code/returns':    'returns',
    '/schemes/:code/rolling':    'rolling',
    '/schemes/:code/risk':       'risk',
    '/schemes/:code/sip':        'sip',
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
    // MCP traffic is excluded for now (per-tool analytics deferred — see MCP.md).
    if (req.url === '/health' || req.url.startsWith('/openapi.json') || req.url.startsWith('/mcp')) return done()

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
