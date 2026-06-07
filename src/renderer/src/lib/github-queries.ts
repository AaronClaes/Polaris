import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { IssueRow, PullRequestRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** A repo to fetch — the per-repo query's input and cache key. */
type Repo = { owner: string; name: string }

/** A single repo whose load failed, surfaced without failing the whole view. */
type RepoFailure = { repo: string; message: string }

// Per-repo GitHub data is considered fresh for a minute; opening a view after
// that triggers a background refetch while the (persisted) data shows instantly.
const STALE_TIME = 60_000

/** The flattened, view-facing shape shared by the issues and PRs aggregators —
 * the same surface the old single batched query exposed, so the tabs are
 * source-agnostic. `rows` is the concatenation across every repo's query. */
type Aggregated<TRow> = {
  rows: TRow[]
  errors: RepoFailure[]
  // First load with nothing yet to show (every repo still pending).
  isLoading: boolean
  // Hard failure: every repo errored. A partial failure stays in `errors`.
  isError: boolean
  errorMessage?: string
  // Any repo is fetching — drives the toolbar's refresh spinner.
  isFetching: boolean
  // Refetch just these repos (a project-level refresh).
  refetch: () => void
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load.'
}

/**
 * Collapse a set of per-repo query results into one view-facing object. `rows`
 * and `errors` are memoized on a signature of every repo's load state, so they
 * keep a stable reference between unrelated re-renders (e.g. typing in the
 * search box) — which is what lets the views' downstream useMemo/memo work hold.
 */
function useAggregated<TData, TRow>(
  repos: Repo[],
  results: UseQueryResult<TData>[],
  selectRows: (data: TData) => TRow[]
): Aggregated<TRow> {
  // Changes only when some repo's data or error actually changes.
  const signature = results
    .map((result) => `${result.status}:${result.dataUpdatedAt}:${result.errorUpdatedAt}`)
    .join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: rows recompute only when the per-repo data signature changes
  const rows = useMemo(
    () => results.flatMap((result) => (result.data ? selectRows(result.data) : [])),
    [signature]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: errors recompute only when the per-repo data signature changes
  const errors = useMemo(
    () =>
      results.flatMap((result, index) =>
        result.isError
          ? [
              {
                repo: `${repos[index].owner}/${repos[index].name}`,
                message: failureMessage(result.error)
              }
            ]
          : []
      ),
    [signature, repos]
  )

  return {
    rows,
    errors,
    isLoading: results.length > 0 && results.every((result) => result.isPending),
    isError: results.length > 0 && results.every((result) => result.isError),
    errorMessage: errors[0]?.message,
    isFetching: results.some((result) => result.isFetching),
    refetch: () => {
      for (const result of results) void result.refetch()
    }
  }
}

/** Open issues across `repos`, one cache entry per repo. */
export function useRepoIssues(repos: Repo[]): Omit<Aggregated<IssueRow>, 'rows'> & {
  issues: IssueRow[]
} {
  const results = trpc.useQueries((t) =>
    repos.map((repo) => t.github.issuesForRepo(repo, { staleTime: STALE_TIME }))
  )
  const { rows, ...rest } = useAggregated(repos, results, (data) => data.issues)
  return { issues: rows, ...rest }
}

/** Open pull requests across `repos`, one cache entry per repo. */
export function useRepoPulls(repos: Repo[]): Omit<Aggregated<PullRequestRow>, 'rows'> & {
  pulls: PullRequestRow[]
} {
  const results = trpc.useQueries((t) =>
    repos.map((repo) => t.github.pullsForRepo(repo, { staleTime: STALE_TIME }))
  )
  const { rows, ...rest } = useAggregated(repos, results, (data) => data.pulls)
  return { pulls: rows, ...rest }
}
