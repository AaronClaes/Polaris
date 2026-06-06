import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * A managed dev project. The core entity: identity (name/description), a bit of
 * visual identity (a Tabler icon key + a palette color key), and an optional
 * default working directory that command actions execute in unless they override
 * it. Everything else a project "does" lives in {@link projectActions}.
 */
export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  // Tabler icon key (see renderer `project-icons.ts` registry).
  icon: text('icon').notNull().default('folder'),
  // Palette color key (see renderer `colors.ts`).
  color: text('color').notNull().default('blue'),
  // Default working directory for command actions; per-action cwd can override.
  path: text('path'),
  // `timestamp` mode → drizzle returns a JS Date. superjson keeps it a Date
  // across the IPC boundary (see trpc transformer wiring).
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/** Action kinds. Extend this tuple (and the `config` union below + the main-side
 * runner + the renderer form) to add new action types. */
export const ACTION_TYPES = ['link', 'command'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/** Open a URL in the default browser. */
export interface LinkActionConfig {
  url: string
}

/** Run a shell command. `cwd` overrides the project's default `path`. */
export interface CommandActionConfig {
  command: string
  cwd?: string | null
}

/** The `type`-discriminated payload stored in the `config` JSON column. The
 * discriminant lives in the row's `type` column, so each variant here is the
 * shape that pairs with that type. */
export type ActionConfig = LinkActionConfig | CommandActionConfig

/**
 * A user-defined, per-project action. Designed for extensibility: `type` is the
 * discriminant and `config` carries the type-specific payload as JSON, so new
 * action kinds slot in without schema changes.
 */
export const projectActions = sqliteTable('project_actions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ACTION_TYPES }).notNull(),
  label: text('label').notNull(),
  // Type-specific payload; shape is keyed by `type` (see ActionConfig).
  config: text('config', { mode: 'json' }).notNull().$type<ActionConfig>(),
  // Manual ordering within a project's action list.
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectAction = typeof projectActions.$inferSelect
export type NewProjectAction = typeof projectActions.$inferInsert
