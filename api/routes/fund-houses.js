import { sql } from '../db/index.js'

const LIST = `
  SELECT id AS fund_house_id, name
  FROM fund_houses
  ORDER BY name
`

export default async function fundHousesRoutes(fastify) {
  fastify.get('/', async () => {
    return { data: await sql.all(LIST) }
  })
}
