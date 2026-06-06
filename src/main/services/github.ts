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
