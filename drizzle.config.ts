import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'drizzle-kit'

// `generate` only needs schema + out. `studio` needs a db url — default to the
// same location the app uses in dev (Electron userData for app name "polaris"),
// overridable via POLARIS_DB_PATH so both stay in sync.
const dbPath =
  process.env.POLARIS_DB_PATH ??
  join(homedir(), 'Library', 'Application Support', 'polaris', 'polaris.db')

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: dbPath }
})
