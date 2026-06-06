import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import { db } from './client'

/**
 * Apply pending migrations from the generated `drizzle/` folder. Run once on
 * app startup. In dev the folder lives at the project root; when packaged it is
 * shipped via electron-builder `extraResources` into `process.resourcesPath`.
 */
export function runMigrations(): void {
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(process.cwd(), 'drizzle')

  migrate(db, { migrationsFolder })
}
