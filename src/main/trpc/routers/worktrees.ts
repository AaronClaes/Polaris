import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../../db/client'
import { githubAccounts, projectRepos, projects } from '../../db/schema'
import { runOpenApp } from '../../services/action-runner'
import {
  buildClaudeCommand,
  CLAUDE_MODELS,
  CLAUDE_PERMISSION_MODES,
  readClaudeLaunchDefaults,
  resolveClaudeLaunchFlags,
  startClaudeInTerminal
} from '../../services/claude-launch'
import { readDefaultApps } from '../../services/default-apps'
import {
  createLinkedBranch,
  fetchWorktreeCreationLookup,
  GitHubGraphQLError
} from '../../services/github'
import { findActiveJob, startJob } from '../../services/jobs'
import {
  addWorktree,
  deriveBranchName,
  deriveWorktreePath,
  listOccupiedSegments,
  listWorktrees,
  readWorktreesRoot,
  removeWorktree,
  runSetupCommand
} from '../../services/worktrees'
import { publicProcedure, router } from '..'
import { resolveRepoToken } from './github'

const repoInput = z.object({ owner: z.string().min(1), name: z.string().min(1) })

// The clone path git commands run against: the linked repo's `path` falling
// back to its project's default `path`. Several projects can link the same
// repo — the first row with a usable path wins. Null just means "no clone
// linked", which reads as "no worktrees" on the read path and a blocker on the
// write path.
function resolveClonePath(db: DB, owner: string, name: string): string | null {
  const rows = db
    .select({ repoPath: projectRepos.path, projectPath: projects.path })
    .from(projectRepos)
    .innerJoin(projects, eq(projectRepos.projectId, projects.id))
    .where(and(eq(projectRepos.owner, owner), eq(projectRepos.name, name)))
    .all()
  return rows.map((row) => row.repoPath ?? row.projectPath).find(Boolean) ?? null
}

// resolveClonePath plus the on-disk check, folded into one user-facing verdict:
// a usable path, or the blocker explaining why git can't run — distinguishing
// "no clone linked" from "linked path is gone from disk" (both fixed in the
// repo's settings). Shared by creationInfo (blocker list) and the mutations
// (thrown), so the two never drift apart.
function resolveUsableClone(
  db: DB,
  owner: string,
  name: string
): { ok: true; path: string } | { ok: false; blocker: string } {
  const path = resolveClonePath(db, owner, name)
  if (!path) {
    return {
      ok: false,
      blocker: `No local clone linked for ${owner}/${name} — set its path in the repo's settings.`
    }
  }
  if (!existsSync(path)) {
    return {
      ok: false,
      blocker: `The clone for ${owner}/${name} no longer exists at ${path} — update its path in the repo's settings.`
    }
  }
  return { ok: true, path }
}

// The project a repo's jobs display under (its icon in the jobs list). Same
// posture as resolveClonePath when several projects link the repo: the first
// row wins. Purely cosmetic — never gates any behavior.
function resolveProjectId(db: DB, owner: string, name: string): number | undefined {
  return db
    .select({ projectId: projectRepos.projectId })
    .from(projectRepos)
    .where(and(eq(projectRepos.owner, owner), eq(projectRepos.name, name)))
    .get()?.projectId
}

function resolveToken(db: DB, owner: string): string | null {
  const accounts = db.select().from(githubAccounts).all()
  return resolveRepoToken(accounts, owner)
}

// The project_repos row whose setup recipes govern this repo's worktrees.
// Several projects can link the same repo, so (mirroring resolveClonePath)
// the first row that actually has recipes wins; with none configured anywhere
// the first row still anchors the last-used bookkeeping.
function resolveRecipeRow(db: DB, owner: string, name: string) {
  const rows = db
    .select()
    .from(projectRepos)
    .where(and(eq(projectRepos.owner, owner), eq(projectRepos.name, name)))
    .all()
  return rows.find((row) => row.setupCommands.length > 0) ?? rows[0] ?? null
}

/**
 * Post-create hook shared by both create paths: remember the recipe choice —
 * including "None" — as the repo's last-used, then run the selected recipe in
 * the new worktree. Returns the failure message (for the dialog's banner)
 * rather than throwing: the worktree already exists and is usable, so a failed
 * recipe must never fail the mutation.
 */
async function runSetupRecipe(
  db: DB,
  {
    owner,
    name,
    label,
    repoPath,
    worktreePath,
    branch,
    issueNumber,
    onLog
  }: {
    owner: string
    name: string
    label: string | undefined
    repoPath: string
    worktreePath: string
    branch: string
    issueNumber?: number
    onLog?: (chunk: string) => void
  }
): Promise<string | undefined> {
  const row = resolveRecipeRow(db, owner, name)
  if (row) {
    db.update(projectRepos)
      .set({ lastSetupCommand: label ?? null })
      .where(eq(projectRepos.id, row.id))
      .run()
  }
  if (!label) return undefined

  const recipe = row?.setupCommands.find((entry) => entry.label === label)
  if (!recipe) return `Setup recipe “${label}” no longer exists — nothing was run.`
  const error = await runSetupCommand({
    command: recipe.command,
    repoPath,
    worktreePath,
    branch,
    issueNumber,
    onLog
  })
  return error ?? undefined
}

/**
 * The tail of every create job, after the worktree exists: setup recipe, then
 * the Claude handoff when requested. Both failures *throw* — the job reports
 * failed — but the worktree is live either way, so the messages must say so
 * (and a failed recipe deliberately skips the Claude launch: fix the setup
 * first, launch from the row's popover).
 */
async function runPostCreateSteps(
  db: DB,
  {
    owner,
    name,
    setupCommand,
    repoPath,
    worktreePath,
    branch,
    issueNumber,
    claude,
    log
  }: {
    owner: string
    name: string
    setupCommand: string | undefined
    repoPath: string
    worktreePath: string
    branch: string
    issueNumber?: number
    claude?: { prompt: string; model: string; permissionMode: string }
    log: (chunk: string) => void
  }
): Promise<void> {
  const setupError = await runSetupRecipe(db, {
    owner,
    name,
    label: setupCommand,
    repoPath,
    worktreePath,
    branch,
    issueNumber,
    onLog: log
  })
  if (setupError) {
    throw new Error(
      `The worktree was created and is usable, but its setup command failed — finish the setup in your terminal. ${setupError}`
    )
  }
  if (claude) {
    const terminal = readDefaultApps(db).terminal
    log(`Starting Claude in ${terminal.name}…\n`)
    try {
      await startClaudeInTerminal({
        terminal,
        cwd: worktreePath,
        command: buildClaudeCommand(claude)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `The worktree was created, but Claude couldn't start — open it and run claude yourself. (${message})`
      )
    }
  }
}

/**
 * The create mutations' duplicate guard, thrown synchronously so it lands in
 * the dialog: refuse while the same worktree is already being created (same
 * repo + branch) or while its target path is still being removed.
 */
function assertNoConflictingJob({
  owner,
  name,
  branch,
  path
}: {
  owner: string
  name: string
  branch: string
  path: string
}): void {
  const creating = findActiveJob(
    (job) =>
      job.kind === 'worktree-create' &&
      job.meta.owner === owner &&
      job.meta.name === name &&
      job.meta.branch === branch
  )
  if (creating) {
    throw new Error('That worktree is already being created — check the jobs list.')
  }
  if (findActiveJob((job) => job.kind === 'worktree-remove' && job.meta.path === path)) {
    throw new Error(
      'That worktree is still being removed — wait for the job to finish, then try again.'
    )
  }
}

/** The optional Claude handoff riding a create mutation: the prompt plus the
 *  launch flags (resolved/remembered exactly like `startClaude`). */
const claudeInput = z
  .object({
    prompt: z.string(),
    model: z.string().optional(),
    permissionMode: z.string().optional()
  })
  .optional()

export const worktreesRouter = router({
  // The added worktrees of a repo's local clone. Owner/name is the renderer's
  // repo identity (same casing as the stored rows). No usable path just means
  // no worktrees, never an error (listWorktrees itself is forgiving about
  // missing directories).
  forRepo: publicProcedure.input(repoInput).query(async ({ ctx, input }) => {
    return { worktrees: await listWorktrees(resolveClonePath(ctx.db, input.owner, input.name)) }
  }),

  // Everything the creation dialog needs up front: base-branch options
  // (default first), a suggested branch name, where the worktree would land,
  // and the blockers that should disable the form entirely. With
  // `existingBranch` (a row whose branch already exists — linked on GitHub, or
  // left over from a half-failed create) the GitHub side is irrelevant: no
  // token blocker, no lookup — creation is purely local.
  creationInfo: publicProcedure
    .input(
      repoInput.extend({
        number: z.number().int().positive(),
        title: z.string(),
        existingBranch: z.string().optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const blockers: string[] = []
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) blockers.push(clone.blocker)
      const token = input.existingBranch ? null : resolveToken(ctx.db, input.owner)
      if (!input.existingBranch && !token) {
        blockers.push(`No linked GitHub token for ${input.owner}.`)
      }

      const root = readWorktreesRoot(ctx.db)
      const suggestedBranch = input.existingBranch ?? deriveBranchName(input.number, input.title)
      const recipeRow = resolveRecipeRow(ctx.db, input.owner, input.name)
      const base = {
        suggestedBranch,
        // The dialog re-derives `<repoDir>/<sanitized-branch>` live as the
        // branch name is edited; the mutation derives the real path main-side.
        repoDir: join(root, input.owner, input.name),
        // What's already on disk in that dir — the dialog checks the derived
        // segment against these so an occupied path blocks submit up front,
        // before anything is written on GitHub.
        occupiedDirs: await listOccupiedSegments(root, input.owner, input.name),
        // Setup recipes + the label last used, for the dialog's setup select.
        // The dialog treats a last-used label that no longer exists as None.
        setupCommands: recipeRow?.setupCommands ?? [],
        lastSetupCommand: recipeRow?.lastSetupCommand ?? null,
        // Everything the "Start Claude" checkbox needs: the terminal it would
        // open in, the flag registries for its selects, and the remembered
        // last-used flags as initial values.
        claude: {
          terminal: readDefaultApps(ctx.db).terminal.name,
          models: CLAUDE_MODELS,
          permissionModes: CLAUDE_PERMISSION_MODES,
          ...readClaudeLaunchDefaults(ctx.db)
        },
        blockers
      }
      if (blockers.length > 0 || !token) return { ...base, branches: [], defaultBranch: null }

      const lookup = await fetchWorktreeCreationLookup(input.owner, input.name, input.number, token)
      // Default branch first — it's the preselected base.
      const branches = lookup.branches
        .map((branch) => branch.name)
        .sort((a, b) =>
          a === lookup.defaultBranch ? -1 : b === lookup.defaultBranch ? 1 : a.localeCompare(b)
        )
      return { ...base, branches, defaultBranch: lookup.defaultBranch }
    }),

  // The full creation write path: linked branch on GitHub (its Development
  // panel), then fetch + worktree add locally, as a background *job* — the
  // mutation returns the job id the moment the cheap preflight passes, and the
  // dialog closes; progress lives in the jobs UI. Re-runs the lookup inside the
  // job so the base OID is fresh at execution time. A local failure after the
  // GitHub write fails the job — the branch deliberately stays (a legitimate,
  // retryable state).
  create: publicProcedure
    .input(
      repoInput.extend({
        number: z.number().int().positive(),
        branch: z.string().trim().min(1),
        base: z.string().trim().min(1),
        // Label of the setup recipe to run after the worktree is added;
        // omitted = None.
        setupCommand: z.string().optional(),
        claude: claudeInput
      })
    )
    .mutation(({ ctx, input }) => {
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) throw new Error(clone.blocker)
      const repoPath = clone.path
      const token = resolveToken(ctx.db, input.owner)
      if (!token) throw new Error(`No linked GitHub token for ${input.owner}.`)
      // Flags resolve (and are remembered) synchronously so a bad value fails
      // the submit in the dialog, never the background job.
      const claude = input.claude
        ? { prompt: input.claude.prompt, ...resolveClaudeLaunchFlags(ctx.db, input.claude) }
        : undefined

      const root = readWorktreesRoot(ctx.db)
      // Derived from the *requested* name; the job re-derives from what GitHub
      // actually returns. Only guard/UI keying, never the git target.
      const requestedPath = deriveWorktreePath(
        root,
        input.owner,
        input.name,
        input.branch,
        `issue-${input.number}`
      )
      assertNoConflictingJob({
        owner: input.owner,
        name: input.name,
        branch: input.branch,
        path: requestedPath
      })
      const job = startJob(
        {
          kind: 'worktree-create',
          title: `Create worktree ${input.branch}`,
          detail: `${input.owner}/${input.name}`,
          meta: {
            owner: input.owner,
            name: input.name,
            branch: input.branch,
            issueNumber: input.number,
            projectId: resolveProjectId(ctx.db, input.owner, input.name),
            path: requestedPath
          }
        },
        async (log) => {
          const lookup = await fetchWorktreeCreationLookup(
            input.owner,
            input.name,
            input.number,
            token
          )
          const baseBranch = lookup.branches.find((branch) => branch.name === input.base)
          if (!baseBranch) {
            throw new Error(`Base branch ${input.base} not found on ${input.owner}/${input.name}.`)
          }

          log(`Creating branch ${input.branch} on GitHub (linked to #${input.number})…\n`)
          let branch: string
          try {
            branch = await createLinkedBranch(token, {
              issueId: lookup.issueId,
              oid: baseBranch.oid,
              name: input.branch
            })
          } catch (error) {
            // The one failure users actually hit here: a fine-grained PAT
            // without Contents: write. GitHub reports it as FORBIDDEN — name
            // the owner and the fix instead of "Resource not accessible…".
            if (error instanceof GitHubGraphQLError && error.type === 'FORBIDDEN') {
              throw new Error(
                `The token for ${input.owner} can't create branches — give it Contents: read & write in its GitHub settings, then try again.`
              )
            }
            throw error
          }

          const worktreePath = deriveWorktreePath(
            root,
            input.owner,
            input.name,
            branch,
            `issue-${input.number}`
          )
          try {
            await addWorktree({ repoPath, branch, worktreePath, onLog: log })
          } catch (error) {
            // The GitHub half succeeded, so this is a recoverable state, not a
            // rollback: the branch stays, and once the row picks it up its
            // create affordance offers the existing branch as the retry.
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(
              `The branch ${branch} was created on GitHub, but the local checkout failed: ${message} — the branch stays, so fix the cause and retry from the row's create button (it will offer the existing branch).`
            )
          }

          await runPostCreateSteps(ctx.db, {
            owner: input.owner,
            name: input.name,
            setupCommand: input.setupCommand,
            repoPath,
            worktreePath,
            branch,
            issueNumber: input.number,
            claude,
            log
          })
        }
      )
      return { jobId: job.id }
    }),

  // Materialize an *existing* branch (fetch + worktree add, no GitHub write) —
  // for rows whose branch already exists, and the retry path when a create
  // half-failed after the GitHub branch was made. Backgrounded like `create`.
  createFromBranch: publicProcedure
    .input(
      repoInput.extend({
        branch: z.string().trim().min(1),
        // Same post-create recipe hook as `create`; the issue number is only
        // context for the recipe's ISSUE_NUMBER env var, so it's optional.
        setupCommand: z.string().optional(),
        number: z.number().int().positive().optional(),
        claude: claudeInput
      })
    )
    .mutation(({ ctx, input }) => {
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) throw new Error(clone.blocker)
      const repoPath = clone.path
      const claude = input.claude
        ? { prompt: input.claude.prompt, ...resolveClaudeLaunchFlags(ctx.db, input.claude) }
        : undefined

      const root = readWorktreesRoot(ctx.db)
      const worktreePath = deriveWorktreePath(
        root,
        input.owner,
        input.name,
        input.branch,
        input.number === undefined ? undefined : `issue-${input.number}`
      )
      assertNoConflictingJob({
        owner: input.owner,
        name: input.name,
        branch: input.branch,
        path: worktreePath
      })
      const job = startJob(
        {
          kind: 'worktree-create',
          title: `Create worktree ${input.branch}`,
          detail: `${input.owner}/${input.name}`,
          meta: {
            owner: input.owner,
            name: input.name,
            branch: input.branch,
            issueNumber: input.number,
            projectId: resolveProjectId(ctx.db, input.owner, input.name),
            path: worktreePath
          }
        },
        async (log) => {
          await addWorktree({ repoPath, branch: input.branch, worktreePath, onLog: log })
          await runPostCreateSteps(ctx.db, {
            owner: input.owner,
            name: input.name,
            setupCommand: input.setupCommand,
            repoPath,
            worktreePath,
            branch: input.branch,
            issueNumber: input.number,
            claude,
            log
          })
        }
      )
      return { jobId: job.id }
    }),

  // Everything the standalone "Start Claude" dialog needs: the terminal it
  // would open, the flag registries for its selects, and the remembered
  // last-used flags as initial values (same shape as creationInfo's `claude`).
  claudeLaunchInfo: publicProcedure.query(({ ctx }) => ({
    terminal: readDefaultApps(ctx.db).terminal.name,
    models: CLAUDE_MODELS,
    permissionModes: CLAUDE_PERMISSION_MODES,
    ...readClaudeLaunchDefaults(ctx.db)
  })),

  // Open the default terminal at a worktree with an interactive `claude`
  // session running — the actual handoff. Model/mode omitted fall back to the
  // remembered last-used values; when a dialog sends them explicitly they
  // become the new remembered values.
  startClaude: publicProcedure
    .input(
      z.object({
        path: z.string().min(1),
        prompt: z.string().optional(),
        model: z.string().optional(),
        permissionMode: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { model, permissionMode } = resolveClaudeLaunchFlags(ctx.db, input)
      await startClaudeInTerminal({
        terminal: readDefaultApps(ctx.db).terminal,
        cwd: input.path,
        command: buildClaudeCommand({ prompt: input.prompt, model, permissionMode })
      })
    }),

  // Open a worktree directory in the user's default IDE / terminal, or reveal
  // it in Finder — the same launchers as project actions, minus the per-project
  // config (worktree launchers always use the global defaults).
  open: publicProcedure
    .input(z.object({ path: z.string().min(1), target: z.enum(['terminal', 'ide', 'finder']) }))
    .mutation(async ({ ctx, input }) => {
      const apps = readDefaultApps(ctx.db)
      const appName =
        input.target === 'finder'
          ? 'Finder'
          : input.target === 'terminal'
            ? apps.terminal.appName
            : apps.ide.appName
      const result = await runOpenApp(appName, input.path)
      if (!result.ok) throw new Error(result.error ?? `Could not open ${appName}.`)
    }),

  // Remove a worktree as a background job — deleting a node_modules-sized
  // checkout takes tens of seconds, so the confirm dialog closes immediately
  // and the glyph shows a removing state instead. The safety checks run inside
  // the job too: a refusal (dirty / unpushed / never-pushed — work would be
  // lost) surfaces as a failed job in the jobs popover. Branches are never
  // touched. `branch` is display-only (the job's title).
  remove: publicProcedure
    .input(repoInput.extend({ path: z.string().min(1), branch: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) throw new Error(clone.blocker)
      const repoPath = clone.path
      if (findActiveJob((job) => job.kind === 'worktree-remove' && job.meta.path === input.path)) {
        throw new Error('That worktree is already being removed — check the jobs list.')
      }

      const job = startJob(
        {
          kind: 'worktree-remove',
          title: `Remove worktree ${input.branch}`,
          detail: `${input.owner}/${input.name}`,
          meta: {
            owner: input.owner,
            name: input.name,
            branch: input.branch,
            projectId: resolveProjectId(ctx.db, input.owner, input.name),
            path: input.path
          }
        },
        (log) => removeWorktree({ repoPath, worktreePath: input.path, onLog: log })
      )
      return { jobId: job.id }
    })
})
