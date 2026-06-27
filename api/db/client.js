import { DatabaseSync } from 'node:sqlite'
import 'dotenv/config'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const dbPath = process.env.DB_PATH
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'market-data-api.db')

export const db = new DatabaseSync(dbPath)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA synchronous = NORMAL')
