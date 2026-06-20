/**
 * vercel.js — Vercel serverless entry point.
 *
 * The root vercel.json routes `/api/*` to this function. Vercel preserves the
 * `/api` prefix in req.url, so we strip it before handing the request to
 * Fastify (whose routes are defined without that prefix, e.g. `/schemes`).
 *
 * Requires DATABASE_URL to be set in the Vercel project (Postgres/Supabase) —
 * the SQLite backend cannot run on Vercel's ephemeral filesystem.
 */

import { build } from './app.js'

// Build once per warm container.
const appPromise = build({ logger: false }).then(async (app) => {
  await app.ready()
  return app
})

export default async function handler(req, res) {
  const app = await appPromise

  // Strip the leading `/api` so Fastify routes match.
  if (req.url === '/api') req.url = '/'
  else if (req.url.startsWith('/api/')) req.url = req.url.slice(4)

  app.server.emit('request', req, res)
}
