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

/**
 * A named container for actions within a project (e.g. "Dev environment"). Lets
 * several actions be launched together while still being launchable on their
 * own. Carries just a name + a Tabler icon key; deleting a group ungroups its
 * actions rather than deleting them (see `projectActions.groupId`).
 */
export const actionGroups = sqliteTable('action_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Tabler icon key (see renderer `icons.ts` registry).
  icon: text('icon').notNull().default('stack'),
  // Hidden from the dashboard launch grid; still shown/usable in the project view.
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  // Manual ordering of groups within a project.
  sortOrder: integer('sort_order').notNull().default(0),
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
  // Optional group membership. Ungrouped (loose) actions have a null groupId.
  // `set null` on delete: removing a group ungroups its actions, never deletes.
  groupId: integer('group_id').references(() => actionGroups.id, {
    onDelete: 'set null'
  }),
  type: text('type', { enum: ACTION_TYPES }).notNull(),
  label: text('label').notNull(),
  // Tabler icon key (see renderer `icons.ts` registry).
  icon: text('icon').notNull().default('bolt'),
  // Hidden from the dashboard launch grid; still shown/usable in the project view.
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  // Type-specific payload; shape is keyed by `type` (see ActionConfig).
  config: text('config', { mode: 'json' }).notNull().$type<ActionConfig>(),
  // Manual ordering within the action's container (its group, or the loose pool).
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectAction = typeof projectActions.$inferSelect
export type NewProjectAction = typeof projectActions.$inferInsert
export type ActionGroup = typeof actionGroups.$inferSelect
export type NewActionGroup = typeof actionGroups.$inferInsert
