import { deleteSecret, getSecret, setSecret } from './secrets'

/**
 * GitHub auth service. Holds one fine-grained PAT per owner (a fine-grained
 * token is bound to a single user/org), keyed in the secrets store. The token
 * never leaves the main process; the renderer only ever sees account metadata.
 *
 * Uses the global `fetch` (Electron main is Node 18+) — Octokit gets pulled in
 * when we build the issue/PR data views.
 */
const API_BASE = 'https://api.github.com'
const TOKEN_PREFIX = 'github:token:'

/** The authenticated viewer behind a token (GitHub `GET /user`). */
export interface GitHubViewer {
  login: string
  name: string | null
  avatarUrl: string | null
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

/**
 * Validate a token by fetching the account it authenticates as. Throws a
 * user-facing message on a bad token or network failure — the caller treats a
 * throw as "do not store this token".
 */
export async function fetchViewer(token: string): Promise<GitHubViewer> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/user`, { headers: authHeaders(token) })
  } catch {
    throw new Error('Could not reach GitHub. Check your connection and try again.')
  }

  if (res.status === 401) {
    throw new Error('GitHub rejected that token (401). Double-check it and try again.')
  }
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText}.`)
  }

  const data = (await res.json()) as {
    login: string
    name: string | null
    avatar_url: string | null
  }
  return {
    login: data.login,
    name: data.name ?? null,
    avatarUrl: data.avatar_url ?? null
  }
}

export function storeToken(owner: string, token: string): void {
  setSecret(`${TOKEN_PREFIX}${owner}`, token)
}

export function getToken(owner: string): string | null {
  return getSecret(`${TOKEN_PREFIX}${owner}`)
}

export function deleteToken(owner: string): void {
  deleteSecret(`${TOKEN_PREFIX}${owner}`)
}

/** A repository the token can see, normalized for the renderer. */
export interface GitHubRepo {
  id: number
  owner: string
  name: string
  fullName: string
  private: boolean
  description: string | null
  htmlUrl: string
  defaultBranch: string | null
  pushedAt: string | null
}

/** The repo fields we read off the GitHub list endpoints. */
interface RawRepo {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  private: boolean
  description: string | null
  html_url: string
  default_branch: string | null
  pushed_at: string | null
}

// Safety bound on pagination: 100/page × 10 = 1000 repos, plenty for a personal
// command center and a guard against a runaway loop.
const MAX_PAGES = 10

function mapRepo(raw: RawRepo): GitHubRepo {
  return {
    id: raw.id,
    owner: raw.owner.login,
    name: raw.name,
    fullName: raw.full_name,
    private: raw.private,
    description: raw.description ?? null,
    htmlUrl: raw.html_url,
    defaultBranch: raw.default_branch ?? null,
    pushedAt: raw.pushed_at ?? null
  }
}

/** Follow GitHub's `Link: …; rel="next"` chain until it runs out (or the cap). */
async function fetchAllPages(initialUrl: string, token: string): Promise<RawRepo[]> {
  const out: RawRepo[] = []
  let url: string | null = initialUrl
  let pages = 0

  while (url && pages < MAX_PAGES) {
    let res: Response
    try {
      res = await fetch(url, { headers: authHeaders(token) })
    } catch {
      throw new Error('Could not reach GitHub. Check your connection and try again.')
    }
    if (res.status === 401) {
      throw new Error('GitHub rejected the stored token (401). Re-link this account.')
    }
    if (!res.ok) {
      throw new Error(`GitHub returned ${res.status} ${res.statusText}.`)
    }

    out.push(...((await res.json()) as RawRepo[]))
    const next = (res.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/)
    url = next ? next[1] : null
    pages++
  }

  return out
}

/**
 * List every repo a single linked owner's token can reach. Fine-grained PATs are
 * resource-owner-bound and don't reliably surface org repos through
 * `/user/repos`, so we branch: a personal token (the typed owner matches the
 * token's authenticated `login`) enumerates the user's repos; an org token hits
 * the org endpoint. Repos are labeled by their actual owner from the response.
 */
export async function listReposForOwner(owner: string, login: string): Promise<GitHubRepo[]> {
  const token = getToken(owner)
  if (!token) return []

  const isPersonal = owner.toLowerCase() === login.toLowerCase()
  const url = isPersonal
    ? `${API_BASE}/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=100`
    : `${API_BASE}/orgs/${encodeURIComponent(owner)}/repos?type=all&sort=pushed&direction=desc&per_page=100`

  return (await fetchAllPages(url, token)).map(mapRepo)
}

const GRAPHQL_URL = 'https://api.github.com/graphql'

/**
 * POST a GraphQL query and unwrap `data`, turning HTTP and GraphQL-level errors
 * into a single user-facing throw. The whole query fails if any field is
 * inaccessible, so callers scope one query per repo and treat a throw as "this
 * repo failed" rather than aborting the rest.
 */
async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })
  } catch {
    throw new Error('Could not reach GitHub. Check your connection and try again.')
  }
  if (res.status === 401) {
    throw new Error('GitHub rejected the stored token (401). Re-link this account.')
  }
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText}.`)
  }

  const body = (await res.json()) as {
    data?: T
    errors?: { message: string }[]
  }
  if (body.errors?.length) throw new Error(body.errors[0].message)
  if (!body.data) throw new Error('GitHub returned no data.')
  return body.data
}

/** An open issue, normalized for the renderer. The two "Development" links are
 * kept separate: `linkedPr` is a PR referencing the issue with a closing
 * keyword, while `linkedBranches` are branches linked to it directly — which can
 * exist before any PR does. */
export interface GitHubIssue {
  id: string
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  // The issue author (null for a deleted/ghost account).
  author: { login: string; avatarUrl: string | null } | null
  assignees: { login: string; avatarUrl: string }[]
  labels: { name: string; color: string }[]
  type: { name: string; color: string } | null
  linkedPr: { number: number; url: string; state: string } | null
  // Branches linked via the issue's Development panel ("link/create a branch"),
  // each as a ready-to-open GitHub tree URL. Empty when none are linked.
  linkedBranches: { name: string; url: string }[]
}

// `repository.issues` returns issues only (never PRs), unlike the REST endpoint.
// Issue Types are GA — `issueType` needs no preview header and is null on
// personal repos. `closedByPullRequestsReferences` is the linked-PR signal;
// `linkedBranches` is the separate linked-branch signal (the issue's Development
// panel), GA too and resolved with Issues + Contents read.
// NOTE: GitHub Projects (v2) "Status" is intentionally NOT queried here. Projects
// is an org-only fine-grained-PAT permission with no user-account equivalent, and
// even the org case is unreliable over GraphQL — including `projectItems` would
// error the whole issues query for any token lacking it. Needs a classic PAT
// (`read:project`) to do safely; see the integration-plan memory.
const ISSUES_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, after: $cursor, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        createdAt
        updatedAt
        author { login avatarUrl }
        assignees(first: 10) { nodes { login avatarUrl } }
        labels(first: 20) { nodes { name color } }
        issueType { name color }
        closedByPullRequestsReferences(first: 1, includeClosedPrs: true) {
          totalCount
          nodes { number url state }
        }
        linkedBranches(first: 5) {
          nodes { ref { name repository { url } } }
        }
      }
    }
  }
}`

interface RawIssue {
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  author: { login: string; avatarUrl: string } | null
  assignees: { nodes: { login: string; avatarUrl: string }[] }
  labels: { nodes: { name: string; color: string }[] }
  issueType: { name: string; color: string } | null
  closedByPullRequestsReferences: {
    totalCount: number
    nodes: { number: number; url: string; state: string }[]
  }
  linkedBranches: {
    // `ref` is null for a linked branch that's since been deleted.
    nodes: { ref: { name: string; repository: { url: string } } | null }[]
  }
}

interface IssuesResponse {
  repository: {
    issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: RawIssue[]
    }
  } | null
}

function mapIssue(owner: string, name: string, raw: RawIssue): GitHubIssue {
  const pr = raw.closedByPullRequestsReferences
  return {
    id: `${owner}/${name}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    author: raw.author
      ? { login: raw.author.login, avatarUrl: raw.author.avatarUrl ?? null }
      : null,
    assignees: raw.assignees.nodes.map((a) => ({
      login: a.login,
      avatarUrl: a.avatarUrl
    })),
    labels: raw.labels.nodes.map((l) => ({ name: l.name, color: l.color })),
    type: raw.issueType ? { name: raw.issueType.name, color: raw.issueType.color } : null,
    linkedPr:
      pr.totalCount > 0 && pr.nodes[0]
        ? {
            number: pr.nodes[0].number,
            url: pr.nodes[0].url,
            state: pr.nodes[0].state
          }
        : null,
    // Drop links to deleted branches, then build the tree URL from the ref's repo
    // (a linked branch can live in a fork, so use its own repository, not ours).
    linkedBranches: raw.linkedBranches.nodes.flatMap((node) =>
      node.ref
        ? [{ name: node.ref.name, url: `${node.ref.repository.url}/tree/${node.ref.name}` }]
        : []
    )
  }
}

/**
 * List a repo's OPEN issues via GraphQL, paginating until exhausted (or capped).
 * Throws if the token can't see the repo so the caller can flag it per-repo. The
 * token must be the repo owner's — fine-grained PATs can only reach their own
 * resource owner's repositories.
 */
export async function listIssuesForRepo(
  owner: string,
  name: string,
  token: string
): Promise<GitHubIssue[]> {
  const out: GitHubIssue[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const data = await graphql<IssuesResponse>(token, ISSUES_QUERY, {
      owner,
      name,
      cursor
    })
    if (!data.repository) {
      throw new Error(`Can't access ${owner}/${name} with the linked token.`)
    }
    const conn = data.repository.issues
    for (const node of conn.nodes) out.push(mapIssue(owner, name, node))
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    pages++
  } while (cursor && pages < MAX_PAGES)

  return out
}

/** Rolled-up GitHub Actions status for a PR's head commit. `null` when the
 * commit has no workflow runs, or the token can't read Actions (see below). */
export interface CheckSummary {
  state: 'passed' | 'failed' | 'running'
  // Latest run per workflow, for the tooltip.
  runs: { name: string; state: 'passed' | 'failed' | 'running' }[]
}

/** An open pull request, normalized for the renderer. `reviewers` are the still
 * pending requested reviewers; `checks` is the rolled-up CI status. */
export interface GitHubPullRequest {
  id: string
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  isDraft: boolean
  // UNKNOWN until GitHub finishes computing mergeability (resolves on a refresh).
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  // Counts from each reviewer's latest review (pending reviewers are `reviewers`).
  reviewSummary: { approved: number; changesRequested: number }
  // The PR author (null for a deleted/ghost account).
  author: { login: string; avatarUrl: string | null } | null
  assignees: { login: string; avatarUrl: string }[]
  reviewers: { login: string; avatarUrl: string | null }[]
  // The PR's head (source) branch as a ready-to-open GitHub tree URL — points
  // into the fork for a cross-repo PR. Null only if the head repository is gone.
  headBranch: { name: string; url: string } | null
  // GitHub Actions status, fetched separately via the Actions REST API.
  checks: CheckSummary | null
}

// `reviewRequests` holds only still-pending reviewers (a submitted review clears
// the request); `latestReviews` is each reviewer's most recent verdict.
// `headRefOid` is the head commit SHA — we use it to look up CI status via the
// Actions REST API (the GraphQL `statusCheckRollup` needs the Checks permission,
// which fine-grained PATs can't be granted; Actions read can, see below).
const PULLS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $cursor, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        createdAt
        updatedAt
        isDraft
        mergeable
        headRefOid
        headRefName
        headRepository { url }
        author { login avatarUrl }
        assignees(first: 10) { nodes { login avatarUrl } }
        reviewRequests(first: 10) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login avatarUrl }
              ... on Team { name }
            }
          }
        }
        latestReviews(first: 20) { nodes { state } }
      }
    }
  }
}`

interface RawPull {
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  isDraft: boolean
  mergeable: string
  headRefOid: string
  headRefName: string
  // The repo the head branch lives in — the fork, for a cross-repo PR. Null only
  // if that repository is gone.
  headRepository: { url: string } | null
  author: { login: string; avatarUrl: string } | null
  assignees: { nodes: { login: string; avatarUrl: string }[] }
  reviewRequests: {
    nodes: {
      requestedReviewer: {
        login?: string
        avatarUrl?: string
        name?: string
      } | null
    }[]
  }
  latestReviews: { nodes: { state: string }[] }
}

interface PullsResponse {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: RawPull[]
    }
  } | null
}

function mapPull(owner: string, name: string, raw: RawPull): GitHubPullRequest {
  const reviewers: { login: string; avatarUrl: string | null }[] = []
  for (const node of raw.reviewRequests.nodes) {
    const reviewer = node.requestedReviewer
    if (!reviewer) continue
    if (reviewer.login)
      reviewers.push({
        login: reviewer.login,
        avatarUrl: reviewer.avatarUrl ?? null
      })
    else if (reviewer.name) reviewers.push({ login: reviewer.name, avatarUrl: null })
  }

  let approved = 0
  let changesRequested = 0
  for (const review of raw.latestReviews.nodes) {
    if (review.state === 'APPROVED') approved++
    else if (review.state === 'CHANGES_REQUESTED') changesRequested++
  }

  return {
    id: `${owner}/${name}#${raw.number}`,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    isDraft: raw.isDraft,
    mergeable: raw.mergeable as GitHubPullRequest['mergeable'],
    reviewSummary: { approved, changesRequested },
    author: raw.author
      ? { login: raw.author.login, avatarUrl: raw.author.avatarUrl ?? null }
      : null,
    assignees: raw.assignees.nodes.map((a) => ({
      login: a.login,
      avatarUrl: a.avatarUrl
    })),
    reviewers,
    headBranch: raw.headRepository
      ? { name: raw.headRefName, url: `${raw.headRepository.url}/tree/${raw.headRefName}` }
      : null,
    // Filled in by listPullRequestsForRepo after the head SHAs are known.
    checks: null
  }
}

// GitHub Actions run conclusions we treat as a hard failure. `cancelled`,
// `stale`, `neutral`, and `skipped` are intentionally NOT failures (they don't
// block a merge), so they roll up as "passed".
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure'])

interface RawWorkflowRun {
  id: number
  name: string | null
  workflow_id: number
  status: string
  conclusion: string | null
}

function runState(run: RawWorkflowRun): 'passed' | 'failed' | 'running' {
  if (run.status !== 'completed') return 'running'
  return run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion) ? 'failed' : 'passed'
}

/**
 * Roll up GitHub Actions runs for a single commit into one status. Uses the
 * Actions REST API (`/actions/runs?head_sha=`), which a fine-grained PAT CAN
 * reach with the "Actions" read permission — unlike the Checks API / GraphQL
 * `statusCheckRollup`, which require the un-grantable "Checks" permission.
 *
 * Returns null when the commit has no runs OR the token lacks Actions read
 * (a 403). CI status is supplementary, so a missing scope degrades to "no
 * status" rather than failing the whole PR list. Note this only sees GitHub
 * Actions — external CI reporting via check-runs/commit statuses won't appear.
 */
async function fetchCheckSummary(
  owner: string,
  name: string,
  sha: string,
  token: string
): Promise<CheckSummary | null> {
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/runs?head_sha=${sha}&per_page=100`
  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders(token) })
  } catch {
    return null
  }
  if (!res.ok) return null

  const body = (await res.json()) as { workflow_runs?: RawWorkflowRun[] }
  // One commit can have several runs of the same workflow (different events, or
  // a re-run recorded separately) — keep the most recent per workflow. Run ids
  // increase monotonically, so the highest id is the latest.
  const latest = new Map<number, RawWorkflowRun>()
  for (const run of body.workflow_runs ?? []) {
    const prev = latest.get(run.workflow_id)
    if (!prev || run.id > prev.id) latest.set(run.workflow_id, run)
  }
  if (latest.size === 0) return null

  const runs = [...latest.values()].map((run) => ({
    name: run.name ?? 'workflow',
    state: runState(run)
  }))
  const state = runs.some((r) => r.state === 'failed')
    ? 'failed'
    : runs.some((r) => r.state === 'running')
      ? 'running'
      : 'passed'
  return { state, runs }
}

/**
 * List a repo's OPEN pull requests via GraphQL, paginating until exhausted (or
 * capped). Throws if the token can't see the repo so the caller can flag it.
 */
export async function listPullRequestsForRepo(
  owner: string,
  name: string,
  token: string
): Promise<GitHubPullRequest[]> {
  const out: GitHubPullRequest[] = []
  const headShas: string[] = [] // parallel to `out`, for the CI lookup below
  let cursor: string | null = null
  let pages = 0

  do {
    const data = await graphql<PullsResponse>(token, PULLS_QUERY, {
      owner,
      name,
      cursor
    })
    if (!data.repository) {
      throw new Error(`Can't access ${owner}/${name} with the linked token.`)
    }
    const conn = data.repository.pullRequests
    for (const node of conn.nodes) {
      out.push(mapPull(owner, name, node))
      headShas.push(node.headRefOid)
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
    pages++
  } while (cursor && pages < MAX_PAGES)

  // CI status is one REST call per distinct head commit. Dedupe by SHA (cheap
  // insurance against PRs sharing a head) and fetch in parallel, then fan the
  // result back out onto every PR. A failure resolves to null, never throws.
  const uniqueShas = [...new Set(headShas)]
  const summaries = await Promise.all(
    uniqueShas.map(async (sha) => [sha, await fetchCheckSummary(owner, name, sha, token)] as const)
  )
  const checksBySha = new Map(summaries)
  for (let i = 0; i < out.length; i++) {
    out[i].checks = checksBySha.get(headShas[i]) ?? null
  }

  return out
}
