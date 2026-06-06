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
