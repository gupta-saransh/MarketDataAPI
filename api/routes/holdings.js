/**
 * holdings.js — fund portfolio allocation (GET /schemes/:code/holdings).
 *
 * The one route that reaches an external source at request time: scheme identity
 * comes from our DB, the allocation is proxied from finapi.upvaly.com and cached
 * in the fund_holdings table (see lib/queries.js getHoldings). Kept separate from
 * analytics.js precisely because of that external dependency.
 */

import { getHoldings } from '../lib/queries.js'

export default async function holdingsRoutes(fastify) {
  // GET /schemes/:code/holdings
  fastify.get('/:code/holdings', async (req, reply) => {
    const result = await getHoldings(req.params.code)
    if (!result.ok) return reply.code(result.status).send({ error: result.error })
    return result.data
  })
}
