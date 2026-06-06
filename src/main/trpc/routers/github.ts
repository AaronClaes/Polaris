import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type GithubAccount, githubAccounts, projectRepos } from '../../db/schema'
import {
  deleteToken,
  fetchViewer,
  type GitHubIssue,
  type GitHubRepo,
  getToken,
  listIssuesForRepo,
  listReposForOwner,
  storeToken
} from '../../services/github'
import { isEncryptionAvailable } from '../../services/secrets'
import { publicProcedure, router } from '..'

const owner = z.string().trim().min(1, 'An account or organization is required')
const token = z.string().trim().min(1, 'A token is required')

type IssueBucket = 'mine' | 'unassigned' | 'others'
type IssueRow = GitHubIssue & {
  repo: { owner: string; name: string }
  bucket: IssueBucket
}

// Match a repo's owner to a linked account by owner OR login, case-insensitively,
// and return that account's token. GitHub reports a repo's owner in canonical
// casing (e.g. "AaronClaes"), which may differ from the string the token was
// stored under (e.g. "aaronclaes"), so an exact lookup would miss.
function resolveRepoToken(accounts: GithubAccount[], repoOwner: string): string | null {
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

  // Open issues across the given repos, each tagged with an assignment bucket
  // (mine / unassigned / others) relative to the linked accounts' logins. Takes
  // an explicit repo list so it serves both a project's repos and, later, a
  // global inbox over every repo. Each repo is routed through its owner's token
  // (fine-grained PATs only reach their own owner); per-repo failures are
  // collected rather than thrown so one bad repo doesn't blank the view.
  listIssues: publicProcedure
    .input(
      z.object({
        repos: z.array(
          z.object({
            owner: z.string().min(1),
            name: z.string().min(1)
          })
        )
      })
    )
    .query(async ({ ctx, input }) => {
      const accounts = ctx.db.select().from(githubAccounts).all()
      const viewerLogins = new Set(accounts.map((a) => a.login.toLowerCase()))

      const issues: IssueRow[] = []
      const errors: { repo: string; message: string }[] = []

      for (const repo of input.repos) {
        const repoToken = resolveRepoToken(accounts, repo.owner)
        if (!repoToken) {
          errors.push({
            repo: `${repo.owner}/${repo.name}`,
            message: `No linked token for ${repo.owner}.`
          })
          continue
        }
        try {
          for (const issue of await listIssuesForRepo(repo.owner, repo.name, repoToken)) {
            const mine = issue.assignees.some((a) => viewerLogins.has(a.login.toLowerCase()))
            const bucket: IssueBucket = mine
              ? 'mine'
              : issue.assignees.length === 0
                ? 'unassigned'
                : 'others'
            issues.push({
              ...issue,
              repo: { owner: repo.owner, name: repo.name },
              bucket
            })
          }
        } catch (err) {
          errors.push({
            repo: `${repo.owner}/${repo.name}`,
            message: err instanceof Error ? err.message : 'Failed to load issues.'
          })
        }
      }

      return { issues, errors }
    })
})
