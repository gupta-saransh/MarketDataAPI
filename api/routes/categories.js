import { sql } from '../db/index.js'

const LIST = `
  SELECT id, name, broad_category
  FROM scheme_categories
  ORDER BY broad_category, name
`

export default async function categoriesRoutes(fastify) {
  fastify.get('/', async () => {
    return { data: await sql.all(LIST) }
  })
}
