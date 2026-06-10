import { sql } from 'drizzle-orm'
import { blob, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

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
  // Surfaces the project on the dashboard home (its pinned-projects section).
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
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
  // Pinned to the dashboard launch grid. Off by default — pin a group to surface
  // it (with all its actions) there; it's always available in the project view.
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  // Manual ordering of groups within a project.
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/** Action kinds. Extend this tuple (and the `config` union below + the main-side
 * runner + the renderer form) to add new action types. */
export const ACTION_TYPES = ['link', 'command', 'terminal', 'ide', 'repo'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

/**
 * Open a URL. By default it goes to the OS default browser. If `browser` (a
 * linked browser's registry key) and `profileDirectory` (a Chromium profile
 * directory like "Default"/"Profile 1") are both set, the URL opens in that
 * browser/profile instead. Omit them for the default behavior.
 */
export interface LinkActionConfig {
  url: string
  browser?: string | null
  profileDirectory?: string | null
}

/** Run a shell command. `cwd` overrides the project's default `path`. */
export interface CommandActionConfig {
  command: string
  cwd?: string | null
}

/**
 * Open a directory in the user's default terminal or IDE (the `terminal` / `ide`
 * action types). The app itself is resolved from the global default-apps setting
 * at run time, so only the working directory is stored here — `cwd` overrides
 * the project's default `path`, exactly like a command action.
 */
export interface AppLauncherActionConfig {
  cwd?: string | null
}

/**
 * Open one of the project's linked GitHub repositories on github.com. Stores a
 * snapshot of the chosen repo — its GitHub `repoId` for identity, plus
 * `owner`/`name`/`url` for display and opening — so the action renders and runs
 * without a repo lookup; re-pick to refresh it after a rename. Like a link
 * action, it can optionally open in a specific browser + Chromium profile.
 */
export interface RepoActionConfig {
  repoId: number
  owner: string
  name: string
  url: string
  browser?: string | null
  profileDirectory?: string | null
}

/** The `type`-discriminated payload stored in the `config` JSON column. The
 * discriminant lives in the row's `type` column, so each variant here is the
 * shape that pairs with that type. */
export type ActionConfig =
  | LinkActionConfig
  | CommandActionConfig
  | AppLauncherActionConfig
  | RepoActionConfig

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
  // Pinned to the dashboard launch grid. Off by default; only meaningful for a
  // loose (ungrouped) action — a grouped action surfaces via its group's pin.
  // Always available in the project view regardless.
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  // Type-specific payload; shape is keyed by `type` (see ActionConfig).
  config: text('config', { mode: 'json' }).notNull().$type<ActionConfig>(),
  // Manual ordering within the action's container (its group, or the loose pool).
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * Generic app-wide key/value preferences in plaintext — no secrets here (those
 * live in {@link secrets}). The default-apps picker stores the chosen terminal /
 * IDE registry keys (`defaultTerminal` / `defaultIde`) so the action runner can
 * resolve a `terminal` / `ide` action's command. Read by the main process, so
 * it lives in the DB rather than renderer storage.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * Generic encrypted key/value store. `value` holds Electron `safeStorage`
 * ciphertext (OS keychain-backed) — never plaintext. The secrets service is the
 * only thing that reads/writes this; entities reference a secret by its `key`
 * (e.g. a GitHub token under `github:token:<owner>`).
 */
export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  value: blob('value', { mode: 'buffer' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * A linked GitHub owner (your personal account or an org). A fine-grained PAT
 * is bound to a single owner, so we hold one row — and one token — per owner.
 * Metadata only: the token lives in {@link secrets} under `github:token:<owner>`.
 * `login`/`name`/`avatarUrl` are the authenticated viewer (GET /user), for display.
 */
export const githubAccounts = sqliteTable('github_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // The user or org login the token grants access to (the secret's lookup key).
  owner: text('owner').notNull().unique(),
  login: text('login').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * A GitHub repository linked to a project. A project can link several (e.g. a
 * frontend and a backend repo). We keep a small display snapshot — the GitHub
 * numeric `repoId` for stable identity, plus name/description/visibility/url —
 * so the linked list renders without an API round-trip; data views refresh it.
 * `owner` doubles as the token lookup key (the token lives under
 * `github:token:<owner>` in {@link secrets}). Unique per (project, owner, name).
 */
export const projectRepos = sqliteTable(
  'project_repos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // GitHub's stable numeric repo id; survives renames, used to dedupe.
    repoId: integer('repo_id').notNull(),
    // Owner login (user or org) — also the secrets key for routing API calls.
    owner: text('owner').notNull(),
    // Repository name without the owner prefix.
    name: text('name').notNull(),
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    description: text('description'),
    url: text('url').notNull(),
    defaultBranch: text('default_branch'),
    // Local working directory for this repo's git operations (e.g. an existing
    // clone). Null falls back to the project's default `path` — so a repo only
    // stores a path when it diverges from the project default.
    path: text('path'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
  },
  (table) => [
    unique('project_repos_project_owner_name_unique').on(table.projectId, table.owner, table.name)
  ]
)

/**
 * A browser the user has linked so its profiles can be targeted by link actions.
 * We store only the registry `key` (e.g. "dia", "chrome"); the display name and
 * on-disk paths come from the in-code browser registry (services/browsers.ts).
 * Linking is opt-in metadata — removing the row reverts that browser's link
 * actions to the OS default. No secrets here, so it's a plain table (unlike
 * {@link githubAccounts}, whose token lives in {@link secrets}).
 */
export const browsers = sqliteTable('browsers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * A ProseMirror/TipTap document, stored as JSON in {@link notes.body}. Kept
 * structurally loose here so the main process needn't depend on the editor
 * library — the renderer casts it to TipTap's `JSONContent`.
 */
export type NoteDoc = { type: string; content?: unknown[]; [key: string]: unknown }

/**
 * A per-project note. Free-form rich text edited in the renderer; the editor's
 * document is persisted as ProseMirror JSON in `body` (the source of truth),
 * while `title` (first line) and `plaintext` are denormalized on every save so
 * the notes list can render — and a future search can match — without parsing
 * the doc. `updatedAt` drives the recency sort; `pinned` floats a note to the top.
 */
export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // Derived from the document's first line on each save; '' for an empty note.
  title: text('title').notNull().default(''),
  // The editor document (ProseMirror JSON) — the source of truth.
  body: text('body', { mode: 'json' }).$type<NoteDoc>().notNull(),
  // Flattened text of `body`, refreshed on every save for list snippets + search.
  plaintext: text('plaintext').notNull().default(''),
  // Pinned notes sort above the rest. Pinning is not an edit, so it leaves
  // `updatedAt` untouched (the within-group order stays by recency).
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  // Bumped to `now` on every content save; drives the recency ordering.
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ProjectRepo = typeof projectRepos.$inferSelect
export type NewProjectRepo = typeof projectRepos.$inferInsert
export type ProjectAction = typeof projectActions.$inferSelect
export type NewProjectAction = typeof projectActions.$inferInsert
export type ActionGroup = typeof actionGroups.$inferSelect
export type NewActionGroup = typeof actionGroups.$inferInsert
export type GithubAccount = typeof githubAccounts.$inferSelect
export type NewGithubAccount = typeof githubAccounts.$inferInsert
export type Browser = typeof browsers.$inferSelect
export type NewBrowser = typeof browsers.$inferInsert
export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert
