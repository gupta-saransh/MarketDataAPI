/**
 * nav.js — batch NAV endpoints (top-level, outside the /schemes prefix).
 *
 *   GET /nav/latest?codes=101762,118778,120503
 *
 * One call replaces N round trips for portfolio widgets and Google Sheets
 * range formulas. Codes are capped at MAX_BATCH_CODES per request; unknown
 * codes are simply absent from the result rather than erroring the batch.
 */

import { getLatestNavBatch, MAX_BATCH_CODES } from '../lib/queries.js'

export default async function navRoutes(fastify) {
  fastify.get('/nav/latest', async (req, reply) => {
    const raw = String(req.query.codes ?? '').trim()
    if (!raw) {
      return reply.code(400).send({ error: 'Provide codes as a comma-separated list, e.g. ?codes=101762,118778' })
    }
    const codes = raw.split(',')
    if (codes.length > MAX_BATCH_CODES) {
      return reply.code(400).send({ error: `Too many codes: max ${MAX_BATCH_CODES} per request` })
    }
    const data = await getLatestNavBatch(codes)
    return { count: data.length, data }
  })
}
