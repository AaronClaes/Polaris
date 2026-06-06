/**
 * GitHub service stub — the typed surface for the future issues/PRs
 * integration. No network calls yet; will authenticate via the secrets service
 * and be exposed through a `github` tRPC sub-router.
 */
export interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  url: string
}

export interface GitHubService {
  listIssues(owner: string, repo: string): Promise<GitHubIssue[]>
}

export const githubService: GitHubService = {
  async listIssues(_owner, _repo) {
    // TODO: read a token via the secrets service and call the GitHub API.
    return []
  }
}
