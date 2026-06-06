import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * A managed dev project. The vertical-slice entity for the scaffold — GitHub
 * coordinates, environment quicklinks, and the local checkout path used to
 * launch editors/terminals.
 */
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  repoOwner: text('repo_owner'),
  repoName: text('repo_name'),
  localPath: text('local_path'),
  stagingUrl: text('staging_url'),
  productionUrl: text('production_url'),
  hostingUrl: text('hosting_url'),
  notes: text('notes'),
  // `timestamp` mode → drizzle returns a JS Date. superjson keeps it a Date
  // across the IPC boundary (see trpc transformer wiring).
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
