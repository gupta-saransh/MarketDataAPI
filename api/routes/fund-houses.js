import { listFundHouses } from '../lib/queries.js'

export default async function fundHousesRoutes(fastify) {
  fastify.get('/', async () => ({ data: await listFundHouses() }))
}
