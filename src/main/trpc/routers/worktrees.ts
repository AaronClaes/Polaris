import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../../db/client'
import { githubAccounts, projectRepos, projects } from '../../db/schema'
import { runOpenApp } from '../../services/action-runner'
import { readDefaultApps } from '../../services/default-apps'
import {
  createLinkedBranch,
  fetchWorktreeCreationLookup,
  GitHubGraphQLError
} from '../../services/github'
import {
  addWorktree,
  appendCreationLog,
  deriveBranchName,
  deriveWorktreePath,
  listOccupiedSegments,
  listWorktrees,
  readCreationLog,
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

// The mutation-side half of the live log: a chunk-appender bound to the
// renderer-generated run id, or undefined when the caller didn't ask for logs.
function logWriter(runId: string | undefined): ((chunk: string) => void) | undefined {
  return runId ? (chunk) => appendCreationLog(runId, chunk) : undefined
}

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
  // panel), then fetch + worktree add locally. Re-runs the lookup at submit
  // time so the base OID is fresh. A local failure after the GitHub write
  // throws — the branch deliberately stays (a legitimate, retryable state).
  create: publicProcedure
    .input(
      repoInput.extend({
        number: z.number().int().positive(),
        branch: z.string().trim().min(1),
        base: z.string().trim().min(1),
        // Label of the setup recipe to run after the worktree is added;
        // omitted = None. Runs post-create, so its failure never fails this.
        setupCommand: z.string().optional(),
        // When set, git/setup output streams into the creation log the dialog
        // polls (see creationLog below).
        runId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const onLog = logWriter(input.runId)
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) throw new Error(clone.blocker)
      const repoPath = clone.path
      const token = resolveToken(ctx.db, input.owner)
      if (!token) throw new Error(`No linked GitHub token for ${input.owner}.`)

      const lookup = await fetchWorktreeCreationLookup(input.owner, input.name, input.number, token)
      const baseBranch = lookup.branches.find((branch) => branch.name === input.base)
      if (!baseBranch) {
        throw new Error(`Base branch ${input.base} not found on ${input.owner}/${input.name}.`)
      }

      onLog?.(`Creating branch ${input.branch} on GitHub (linked to #${input.number})…\n`)
      let branch: string
      try {
        branch = await createLinkedBranch(token, {
          issueId: lookup.issueId,
          oid: baseBranch.oid,
          name: input.branch
        })
      } catch (error) {
        // The one failure users actually hit here: a fine-grained PAT without
        // Contents: write. GitHub reports it as FORBIDDEN — name the owner and
        // the fix instead of parroting "Resource not accessible…".
        if (error instanceof GitHubGraphQLError && error.type === 'FORBIDDEN') {
          throw new Error(
            `The token for ${input.owner} can't create branches — give it Contents: read & write in its GitHub settings, then try again.`
          )
        }
        throw error
      }

      const root = readWorktreesRoot(ctx.db)
      const worktreePath = deriveWorktreePath(
        root,
        input.owner,
        input.name,
        branch,
        `issue-${input.number}`
      )
      try {
        await addWorktree({ repoPath, branch, worktreePath, onLog })
      } catch (error) {
        // The GitHub half succeeded, so this is a recoverable state, not a
        // rollback: the branch stays, and once the row picks it up its create
        // affordance offers the existing branch (local-only mode) as the retry.
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `The branch ${branch} was created on GitHub, but the local checkout failed: ${message} — the branch stays, so fix the cause and retry from the row's create button (it will offer the existing branch).`
        )
      }

      const setupError = await runSetupRecipe(ctx.db, {
        owner: input.owner,
        name: input.name,
        label: input.setupCommand,
        repoPath,
        worktreePath,
        branch,
        issueNumber: input.number,
        onLog
      })
      return { branch, path: worktreePath, setupError }
    }),

  // Materialize an *existing* branch (fetch + worktree add, no GitHub write) —
  // for rows whose branch already exists, and the retry path when a create
  // half-failed after the GitHub branch was made.
  createFromBranch: publicProcedure
    .input(
      repoInput.extend({
        branch: z.string().trim().min(1),
        // Same post-create recipe hook as `create`; the issue number is only
        // context for the recipe's ISSUE_NUMBER env var, so it's optional.
        setupCommand: z.string().optional(),
        number: z.number().int().positive().optional(),
        runId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const onLog = logWriter(input.runId)
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) throw new Error(clone.blocker)
      const repoPath = clone.path

      const root = readWorktreesRoot(ctx.db)
      const worktreePath = deriveWorktreePath(
        root,
        input.owner,
        input.name,
        input.branch,
        input.number === undefined ? undefined : `issue-${input.number}`
      )
      await addWorktree({ repoPath, branch: input.branch, worktreePath, onLog })

      const setupError = await runSetupRecipe(ctx.db, {
        owner: input.owner,
        name: input.name,
        label: input.setupCommand,
        repoPath,
        worktreePath,
        branch: input.branch,
        issueNumber: input.number,
        onLog
      })
      return { branch: input.branch, path: worktreePath, setupError }
    }),

  // The live output of an in-flight creation (git + setup command), polled by
  // the dialog while its create mutation runs. Reading an unknown run id is
  // just an empty log, never an error.
  creationLog: publicProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(({ input }) => ({ log: readCreationLog(input.runId) })),

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

  // Remove a worktree (the service refuses when work would be lost — dirty,
  // unpushed, or never-pushed). Branches are never touched.
  remove: publicProcedure
    .input(repoInput.extend({ path: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const clone = resolveUsableClone(ctx.db, input.owner, input.name)
      if (!clone.ok) throw new Error(clone.blocker)
      await removeWorktree({ repoPath: clone.path, worktreePath: input.path })
    })
})
