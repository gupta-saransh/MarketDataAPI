import { listCategories } from '../lib/queries.js'

export default async function categoriesRoutes(fastify) {
  fastify.get('/', async () => ({ data: await listCategories() }))
}
