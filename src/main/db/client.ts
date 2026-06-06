import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import * as schema from './schema'

// Stored in Electron's per-user data dir. Overridable via POLARIS_DB_PATH so
// `drizzle-kit studio` (see drizzle.config.ts) can point at the same file.
const dbPath = process.env.POLARIS_DB_PATH ?? join(app.getPath('userData'), 'polaris.db')

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
// Off by default in SQLite; required for `onDelete: 'cascade'` FKs (e.g. a
// project's actions) to actually cascade at runtime.
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export type DB = typeof db
export { sqlite }
