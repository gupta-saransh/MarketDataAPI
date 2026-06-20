/**
 * server.js — Local / always-on entry point.
 *
 * For Vercel serverless, see vercel.js instead.
 */

import { build } from './app.js'

const app = await build()

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '0.0.0.0' })
