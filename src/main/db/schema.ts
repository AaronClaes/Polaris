import { sql } from 'drizzle-orm'
import { blob, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * A user-defined tag for grouping projects (e.g. "Work", "Personal"). A project
 * carries at most one ({@link projects.tagId}). Tags exist to filter focus:
 * turning a tag off in the header hides every project assigned to it across the
 * whole app. Just a label + a palette color key (see renderer `colors.ts`) — the
 * tag itself is never shown on a project, only in the settings manager and the
 * header toggle.
 */
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  // Palette color key (see renderer `colors.ts`), shared with project colors.
  color: text('color').notNull().default('blue'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

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
  // Optional single tag for focus-filtering (see {@link tags}). `set null` on
  // delete: removing a tag un-tags its projects rather than deleting them.
  tagId: integer('tag_id').references(() => tags.id, { onDelete: 'set null' }),
  // Default working directory for command actions; per-action cwd can override.
  path: text('path'),
  // Surfaces the project on the dashboard home (its pinned-projects section).
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  // Manual ordering across the projects list (drag-to-reorder on the Projects
  // page). Reflected everywhere projects.list is shown — sidebar, dashboard,
  // command palette — since they all read that one ordered query.
  sortOrder: integer('sort_order').notNull().default(0),
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
export const ACTION_TYPES = ['link', 'command', 'terminal', 'ide', 'finder', 'repo'] as const
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
 * Open a directory in an external app — the user's default terminal or IDE (the
 * `terminal` / `ide` types, resolved from the global default-apps setting at run
 * time) or macOS Finder (the `finder` type, always Finder). Only the working
 * directory is stored here — `cwd` overrides the project's default `path`,
 * exactly like a command action.
 */
export interface AppLauncherActionConfig {
  cwd?: string | null
}

/**
 * The `ide` action: an {@link AppLauncherActionConfig} that can instead target a
 * specific `.code-workspace` file. When `workspaceFile` is set the IDE opens that
 * workspace; otherwise it opens `cwd` (or the project's default `path`). Both
 * VS Code and Cursor register `.code-workspace` as a document type, so launching
 * via `open -a <app> <file>` opens it as a workspace just like a folder.
 */
export interface IdeActionConfig extends AppLauncherActionConfig {
  workspaceFile?: string | null
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
  | IdeActionConfig
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
 * A linked Google account (e.g. your work Workspace account). Metadata only —
 * the OAuth tokens live in {@link secrets} under `google:tokens:<email>` as a
 * JSON blob (refresh token + cached access token + expiry). One row per account;
 * the dashboard agenda merges events across every linked account. `email` is the
 * unique identity and the secret's lookup key; `name`/`picture` come from the
 * OpenID userinfo, for display.
 */
export const googleAccounts = sqliteTable('google_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name'),
  picture: text('picture'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * An allowed email sender — the allowlist that decides which messages enter
 * Polaris at all. `pattern` is either a full address (`bob@clientA.com`) or a
 * domain wildcard (`@clientA.com`); only mail matching an entry is ingested, so
 * ads and spam never reach the dashboard. Optionally tied to a project: a null
 * `projectId` is a contact that still surfaces on the dashboard but belongs to
 * no project (e.g. a one-off client). The link is `set null` on project delete —
 * the allowlist entry outlives the project (unlike a todo, which cascades); it
 * just becomes unlinked rather than vanishing from the whitelist.
 */
export const emailContacts = sqliteTable('email_contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Normalized to lowercase and unique: a full address, or an `@domain` wildcard.
  pattern: text('pattern').notNull().unique(),
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * Local "I've handled this" state for a Gmail thread — the manual counterpart to
 * actually replying. Emails surface as "needs you" while their latest message is
 * from someone else; marking one done dismisses it WITHOUT touching Gmail (we're
 * read-only). `dismissedMessageAt` is the watermark: the epoch-ms timestamp of the
 * thread's latest message at the moment it was dismissed. The thread reappears
 * once a newer message arrives (its latest timestamp exceeds the watermark). Keyed
 * by (account, threadId) — Gmail thread ids are per-mailbox. No FK: the thread
 * lives in Gmail, not our DB.
 */
export const emailThreadState = sqliteTable(
  'email_thread_state',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // The linked Google account (mailbox) this thread belongs to.
    account: text('account').notNull(),
    // Gmail's thread id.
    threadId: text('thread_id').notNull(),
    // Epoch ms of the latest message when dismissed — the reopen watermark. Stored
    // as a raw integer (a Gmail internalDate), not a timestamp-mode column.
    dismissedMessageAt: integer('dismissed_message_at').notNull(),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`)
  },
  (table) => [unique('email_thread_state_account_thread_unique').on(table.account, table.threadId)]
)

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

/**
 * A per-project to-do. The catch-all for work that doesn't belong in a GitHub
 * issue. Deliberately minimal for now — a title, an optional due date, and a
 * completed flag — with room to grow (sorting, filtering, rich content) later.
 * `completedAt` records when the box was checked (cleared when unchecked) so a
 * future view can show or sort by completion time; `updatedAt` is bumped on
 * every edit.
 */
export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Nullable: a null `projectId` is an unlinked todo — a quick reminder or
  // internal task that belongs to no project. Linked todos cascade-delete with
  // their project; unlinked ones simply have no owner to follow.
  projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  // Optional deadline, stored as a timestamp. The UI treats local midnight as
  // "date only" (a whole-day, end-of-day deadline) and any other time as an
  // explicit due time — see hasTime/deadlineOf in work-items.ts.
  dueDate: integer('due_date', { mode: 'timestamp' }),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  // Stamped when `completed` flips true, nulled when it flips back.
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
})

/**
 * A persistent record of an externally-observed work item — a GitHub issue/PR or
 * a Gmail thread — tracked across fetches so the app has a memory the live feed
 * lacks. The dashboard renders from this table; source fetches write through to
 * it on every *successful* fetch, and the live fetches act as a background
 * refresh. It also powers features that need history: resilience (an item
 * survives a failed fetch), staleness / dwell-time, "it came back" reopen
 * detection, the daily brief, snooze, and completion stats.
 *
 * Three orthogonal axes, deliberately not collapsed into one status:
 *  - `upstreamState`  what the source says: open, closed, or gone-from-scope.
 *  - `disposition`    what you did: snoozed / done / dismissed. Email "mark done"
 *                     sets 'done' — it absorbed the old {@link emailThreadState}
 *                     watermark; 'snoozed' / 'dismissed' are reserved for later.
 *  - presence         not a column — derived from `lastSeenAt` vs the current fetch.
 *
 * Reconciliation is per source because absence means different things: a GitHub
 * item missing from an OPEN-only fetch is closed (`upstream_closed`), while a
 * Gmail thread missing has merely aged out of the search window — never a
 * completion. Identity is (source, externalId): github `owner/name#number`,
 * gmail `account:threadId`. `scopeKey` (github `owner/name`, gmail account) is the
 * unit a successful fetch reconciles — a scope whose fetch failed is never
 * tombstoned.
 */
export const trackedItems = sqliteTable(
  'tracked_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source', { enum: ['github', 'gmail'] }).notNull(),
    kind: text('kind', { enum: ['issue', 'pr', 'thread'] }).notNull(),
    // Stable cross-fetch identity within a source; UNIQUE together with `source`.
    externalId: text('external_id').notNull(),
    // The unit a successful fetch reconciles (github `owner/name`, gmail account).
    scopeKey: text('scope_key').notNull(),
    // Best-effort attribution; nullable and may change as a thread/repo moves.
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    // Last-known display snapshot so the item can render when its source is
    // unavailable. The source-specific shape lives in `payload` (this is where
    // issues, PRs and threads differ); the generic columns carry what we query.
    title: text('title').notNull().default(''),
    url: text('url').notNull().default(''),
    payload: text('payload', { mode: 'json' }).notNull(),
    // What the source says about the item's lifecycle.
    upstreamState: text('upstream_state', { enum: ['open', 'closed', 'gone'] })
      .notNull()
      .default('open'),
    // What you did with it. Phase 1 keeps this 'none'.
    disposition: text('disposition', { enum: ['none', 'snoozed', 'done', 'dismissed'] })
      .notNull()
      .default('none'),
    // Why it left the feed — keeps the brief honest (an aged-out or unlinked item
    // is not a completion). Null while still active.
    closedReason: text('closed_reason', {
      enum: ['upstream_closed', 'replied', 'manual', 'dismissed', 'aged_out', 'scope_removed']
    }),
    // First time we ever observed it — the basis for dwell-time / staleness.
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    // Last fetch it was present in — stale-data marker and reconciliation key.
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    // Upstream creation time when known (GitHub createdAt); null for Gmail.
    sourceCreatedAt: integer('source_created_at', { mode: 'timestamp' }),
    // Latest upstream activity, raw epoch ms (mirrors emailThreadState's
    // dismissedMessageAt) — drives reopen detection and the email watermark.
    lastActivityAt: integer('last_activity_at'),
    // When we recorded it as left/closed/done (recap + stats).
    closedAt: integer('closed_at', { mode: 'timestamp' }),
    // Set when a closed item is seen open again; `reopenCount` tallies how often.
    reopenedAt: integer('reopened_at', { mode: 'timestamp' }),
    reopenCount: integer('reopen_count').notNull().default(0),
    // Defer-until for snooze (a later phase).
    snoozedUntil: integer('snoozed_until', { mode: 'timestamp' }),
    // When you last acted on it (a later phase) — basis for "ignored for N days".
    lastUserActionAt: integer('last_user_action_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`)
  },
  (table) => [
    unique('tracked_items_source_external_unique').on(table.source, table.externalId),
    index('tracked_items_scope_idx').on(table.source, table.kind, table.scopeKey),
    index('tracked_items_state_idx').on(table.upstreamState, table.disposition)
  ]
)

export type TrackedItem = typeof trackedItems.$inferSelect
export type NewTrackedItem = typeof trackedItems.$inferInsert

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
export type GoogleAccount = typeof googleAccounts.$inferSelect
export type NewGoogleAccount = typeof googleAccounts.$inferInsert
export type Browser = typeof browsers.$inferSelect
export type NewBrowser = typeof browsers.$inferInsert
export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
export type Todo = typeof todos.$inferSelect
export type NewTodo = typeof todos.$inferInsert
export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert
export type Tag = typeof tags.$inferSelect
export type NewTag = typeof tags.$inferInsert
