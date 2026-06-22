/**
 * schemes.js — scheme search, detail, and NAV endpoints.
 *
 * Thin HTTP layer over lib/queries.js (the shared data-access layer, also used
 * by the MCP server). Handlers map query results to status codes / response
 * shapes; all SQL lives in queries.js.
 */

import {
  searchSchemes, getSchemeByCode, getSchemeByIsin, getNavHistory, getLatestNav,
} from '../lib/queries.js'

export default async function schemesRoutes(fastify) {

  // GET /schemes?q=&fund_house_id=&category_id=&broad_category=&page=1&limit=20
  fastify.get('/', async (req) => searchSchemes(req.query))

  // GET /schemes/isin/:isin  — lookup by ISIN (growth or div-reinvestment)
  fastify.get('/isin/:isin', async (req, reply) => {
    const scheme = await getSchemeByIsin(req.params.isin)
    if (!scheme) return reply.code(404).send({ error: 'Scheme not found' })
    return { data: scheme }
  })

  // GET /schemes/:code
  fastify.get('/:code', async (req, reply) => {
    const scheme = await getSchemeByCode(req.params.code)
    if (!scheme) return reply.code(404).send({ error: 'Scheme not found' })
    return { data: scheme }
  })

  // GET /schemes/:code/nav?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  fastify.get('/:code/nav', async (req, reply) => {
    const result = await getNavHistory(req.params.code, req.query.startDate ?? null, req.query.endDate ?? null)
    if (!result) return reply.code(404).send({ error: 'No NAV data found' })
    return result
  })

  // GET /schemes/:code/nav/latest
  fastify.get('/:code/nav/latest', async (req, reply) => {
    const result = await getLatestNav(req.params.code)
    if (!result) return reply.code(404).send({ error: 'No NAV data found' })
    return result
  })
}
