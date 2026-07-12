import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type GithubAccount, githubAccounts, projectRepos } from '../../db/schema'
import { reconcileGithub } from '../../db/tracked-items'
import {
  deleteToken,
  fetchViewer,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepo,
  getToken,
  listIssuesForRepo,
  listPullRequestsForRepo,
  listReposForOwner,
  storeToken
} from '../../services/github'
import { isEncryptionAvailable } from '../../services/secrets'
import { publicProcedure, router } from '..'

const owner = z.string().trim().min(1, 'An account or organization is required')
const token = z.string().trim().min(1, 'A token is required')

const repoInput = z.object({ owner: z.string().min(1), name: z.string().min(1) })

type IssueBucket = 'mine' | 'unassigned' | 'others'
export type IssueRow = GitHubIssue & {
  repo: { owner: string; name: string }
  bucket: IssueBucket
}

type PullBucket = 'assigned' | 'review' | 'other'
export type PullRow = GitHubPullRequest & {
  repo: { owner: string; name: string }
  bucket: PullBucket
}

// Match a repo's owner to a linked account by owner OR login, case-insensitively,
// and return that account's token. GitHub reports a repo's owner in canonical
// casing (e.g. "AaronClaes"), which may differ from the string the token was
// stored under (e.g. "aaronclaes"), so an exact lookup would miss. Exported for
// the worktrees router, which routes its GitHub calls the same way.
export function resolveRepoToken(accounts: GithubAccount[], repoOwner: string): string | null {
  const lc = repoOwner.toLowerCase()
  const account = accounts.find((a) => a.owner.toLowerCase() === lc || a.login.toLowerCase() === lc)
  return account ? getToken(account.owner) : null
}

export const githubRouter = router({
  // Connected owners, oldest first. Tokens never cross the IPC boundary — only
  // the display metadata does.
  listAccounts: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(githubAccounts).orderBy(asc(githubAccounts.createdAt)).all()
  ),

  // Link an owner: validate the token against GitHub first, store it encrypted,
  // then upsert the owner's metadata (re-linking an owner refreshes its token).
  connect: publicProcedure.input(z.object({ owner, token })).mutation(async ({ ctx, input }) => {
    if (!isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable, so the token cannot be saved safely.')
    }

    const viewer = await fetchViewer(input.token)
    storeToken(input.owner, input.token)

    return ctx.db
      .insert(githubAccounts)
      .values({
        owner: input.owner,
        login: viewer.login,
        name: viewer.name,
        avatarUrl: viewer.avatarUrl
      })
      .onConflictDoUpdate({
        target: githubAccounts.owner,
        set: {
          login: viewer.login,
          name: viewer.name,
          avatarUrl: viewer.avatarUrl
        }
      })
      .returning()
      .get()
  }),

  // Unlink an owner: drop both the stored token and its metadata row.
  disconnect: publicProcedure.input(z.object({ owner })).mutation(({ ctx, input }) => {
    deleteToken(input.owner)
    ctx.db.delete(githubAccounts).where(eq(githubAccounts.owner, input.owner)).run()
    return { owner: input.owner }
  }),

  // Every repo the linked owners' tokens can reach, deduped by GitHub id and
  // sorted most-recently-pushed first — the source list for the repo picker.
  // Per-owner failures (e.g. an expired token) are collected rather than thrown,
  // so one bad owner doesn't blank the whole list.
  listRepos: publicProcedure.query(async ({ ctx }) => {
    const accounts = ctx.db.select().from(githubAccounts).all()

    const repos: GitHubRepo[] = []
    const errors: { owner: string; message: string }[] = []
    for (const account of accounts) {
      try {
        repos.push(...(await listReposForOwner(account.owner, account.login)))
      } catch (err) {
        errors.push({
          owner: account.owner,
          message: err instanceof Error ? err.message : 'Failed to load repositories.'
        })
      }
    }

    const byId = new Map<number, GitHubRepo>()
    for (const repo of repos) if (!byId.has(repo.id)) byId.set(repo.id, repo)
    const deduped = [...byId.values()].sort((a, b) =>
      (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '')
    )

    return { repos: deduped, errors }
  }),

  // Link a repo to a project. Idempotent on (project, owner, name): re-linking
  // refreshes the cached snapshot rather than erroring.
  linkRepo: publicProcedure
    .input(
      z.object({
        projectId: z.number().int(),
        repoId: z.number().int(),
        owner: z.string().trim().min(1),
        name: z.string().trim().min(1),
        private: z.boolean().default(false),
        description: z.string().nullable().default(null),
        url: z.string().url(),
        defaultBranch: z.string().nullable().default(null)
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.db
        .insert(projectRepos)
        .values(input)
        .onConflictDoUpdate({
          target: [projectRepos.projectId, projectRepos.owner, projectRepos.name],
          set: {
            repoId: input.repoId,
            private: input.private,
            description: input.description,
            url: input.url,
            defaultBranch: input.defaultBranch
          }
        })
        .returning()
        .get()
    ),

  // Set (or clear) a linked repo's local working directory, keyed by the row id.
  // A blank/whitespace path stores null, falling back to the project default.
  setRepoPath: publicProcedure
    .input(z.object({ id: z.number().int(), path: z.string() }))
    .mutation(({ ctx, input }) => {
      const path = input.path.trim() || null
      return ctx.db
        .update(projectRepos)
        .set({ path })
        .where(eq(projectRepos.id, input.id))
        .returning()
        .get()
    }),

  // Replace a linked repo's worktree setup recipes wholesale (the editor
  // always saves the full ordered list). Labels must be unique — they're the
  // key `lastSetupCommand` remembers a choice by.
  setRepoSetupCommands: publicProcedure
    .input(
      z.object({
        id: z.number().int(),
        setupCommands: z.array(
          z.object({
            label: z.string().trim().min(1, 'Every recipe needs a label'),
            command: z.string().trim().min(1, 'Every recipe needs a command')
          })
        )
      })
    )
    .mutation(({ ctx, input }) => {
      const labels = new Set(input.setupCommands.map((recipe) => recipe.label))
      if (labels.size !== input.setupCommands.length) {
        throw new Error('Recipe labels must be unique.')
      }
      return ctx.db
        .update(projectRepos)
        .set({ setupCommands: input.setupCommands })
        .where(eq(projectRepos.id, input.id))
        .returning()
        .get()
    }),

  // Unlink a repo from a project by its GitHub id (what the picker toggles off).
  unlinkRepo: publicProcedure
    .input(z.object({ projectId: z.number().int(), repoId: z.number().int() }))
    .mutation(({ ctx, input }) => {
      ctx.db
        .delete(projectRepos)
        .where(
          and(eq(projectRepos.projectId, input.projectId), eq(projectRepos.repoId, input.repoId))
        )
        .run()
      return { projectId: input.projectId, repoId: input.repoId }
    }),

  // Open issues for a single repo, each tagged with an assignment bucket (mine /
  // unassigned / others) relative to the linked accounts' logins. One repo per
  // call is the cache unit: the renderer fans out across a project's (or every)
  // repo with useQueries, so a single repo can refetch without touching the
  // rest, and every view reads the same per-repo cache entry. The repo is routed
  // through its owner's token (fine-grained PATs only reach their own owner); a
  // failure throws so that repo's query surfaces it in isolation rather than
  // blanking the whole view.
  issuesForRepo: publicProcedure.input(repoInput).query(async ({ ctx, input }) => {
    const accounts = ctx.db.select().from(githubAccounts).all()
    const viewerLogins = new Set(accounts.map((a) => a.login.toLowerCase()))

    const repoToken = resolveRepoToken(accounts, input.owner)
    if (!repoToken) throw new Error(`No linked token for ${input.owner}.`)

    const issues: IssueRow[] = []
    for (const issue of await listIssuesForRepo(input.owner, input.name, repoToken)) {
      // "Mine" means actually assigned to you — unlike PRs, authoring an
      // unassigned issue does NOT make it yours (you open issues for others to
      // act on far more often than PRs). Those fall through to "unassigned".
      const mine = issue.assignees.some((a) => viewerLogins.has(a.login.toLowerCase()))
      const bucket: IssueBucket = mine
        ? 'mine'
        : issue.assignees.length === 0
          ? 'unassigned'
          : 'others'
      issues.push({ ...issue, repo: { owner: input.owner, name: input.name }, bucket })
    }

    // Write-through to the lifecycle store, which the feed renders from; this
    // live fetch is its background refresh (best-effort).
    reconcileGithub(ctx.db, { owner: input.owner, name: input.name, kind: 'issue', rows: issues })

    return { issues }
  }),

  // Open pull requests for a single repo, bucketed by what they need from you:
  // assigned to you, awaiting your review (a pending review request), or other.
  // Same per-repo cache-unit shape and token routing as issuesForRepo.
  pullsForRepo: publicProcedure.input(repoInput).query(async ({ ctx, input }) => {
    const accounts = ctx.db.select().from(githubAccounts).all()
    const viewerLogins = new Set(accounts.map((a) => a.login.toLowerCase()))

    const repoToken = resolveRepoToken(accounts, input.owner)
    if (!repoToken) throw new Error(`No linked token for ${input.owner}.`)

    const pulls: PullRow[] = []
    for (const pull of await listPullRequestsForRepo(input.owner, input.name, repoToken)) {
      const assigned = pull.assignees.some((a) => viewerLogins.has(a.login.toLowerCase()))
      // A PR you opened that has no one else assigned is implicitly yours — people
      // often don't bother assigning their own PRs. (every() is true when the
      // assignee list is empty or holds only your own logins.)
      const isAuthor = pull.author ? viewerLogins.has(pull.author.login.toLowerCase()) : false
      const mine =
        assigned ||
        (isAuthor && pull.assignees.every((a) => viewerLogins.has(a.login.toLowerCase())))
      const needsReview = pull.reviewers.some((r) => viewerLogins.has(r.login.toLowerCase()))
      const bucket: PullBucket = mine ? 'assigned' : needsReview ? 'review' : 'other'
      pulls.push({ ...pull, repo: { owner: input.owner, name: input.name }, bucket })
    }

    // Write-through to the lifecycle store, which the feed renders from; this
    // live fetch is its background refresh (best-effort).
    reconcileGithub(ctx.db, { owner: input.owner, name: input.name, kind: 'pr', rows: pulls })

    return { pulls }
  })
})
