import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import type { IssueRow, PullRequestRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** A repo to fetch — the per-repo refresh query's input and cache key. */
type Repo = { owner: string; name: string }

/** A single repo whose refresh failed, surfaced without failing the whole view. */
type RepoFailure = { repo: string; message: string }

// Per-repo GitHub data is considered fresh for a minute; opening a view after
// that triggers a background refresh while the store data shows instantly.
const STALE_TIME = 60_000

/** The flattened, view-facing shape shared by the issues and PRs aggregators —
 * the same surface consumers already expect. `rows` come from the store (the
 * render source); status/errors come from the live per-repo refresh. */
type Aggregated<TRow> = {
  rows: TRow[]
  errors: RepoFailure[]
  // First load with nothing yet to show (store empty and a first fetch pending).
  isLoading: boolean
  // Hard failure: nothing in the store to fall back on and every repo errored.
  isError: boolean
  errorMessage?: string
  // Any refresh is in flight — drives the refresh button's spinner.
  isFetching: boolean
  // Re-trigger the per-repo refresh (which reconciles, then re-reads the store).
  refetch: () => void
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to load.'
}

// Module-level so the rows useMemo dependency stays stable across renders.
const selectIssues = (data: { issues: IssueRow[] }): IssueRow[] => data.issues
const selectPulls = (data: { pulls: PullRequestRow[] }): PullRequestRow[] => data.pulls

/**
 * Merge the store-read render query with the per-repo background refresh into one
 * view-facing object. The store is the render source — instant and offline-ok —
 * while the live per-repo fetches reconcile it and, once they settle, invalidate
 * the store read so it picks up the reconciled rows. Errors and the spinner come
 * from the live refresh; the store keeps rows visible even when a refresh fails.
 */
function useRepoStoreQuery<TStore, TRow>(
  repos: Repo[],
  refresh: UseQueryResult<unknown, unknown>[],
  stored: UseQueryResult<TStore, unknown>,
  selectRows: (data: TStore) => TRow[],
  invalidate: () => void
): Aggregated<TRow> {
  // Changes only when some repo's refresh actually settles (data or error).
  const signature = refresh
    .map((result) => `${result.status}:${result.dataUpdatedAt}:${result.errorUpdatedAt}`)
    .join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the store only when a refresh settles
  useEffect(() => {
    invalidate()
  }, [signature])

  const rows = useMemo(
    () => (stored.data ? selectRows(stored.data) : []),
    [stored.data, selectRows]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: errors recompute only when the refresh signature changes
  const errors = useMemo(
    () =>
      refresh.flatMap((result, index) =>
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

  const storeEmpty = rows.length === 0
  const refreshing = refresh.length > 0
  return {
    rows,
    errors,
    // Skeleton only when there's genuinely nothing yet: the store read hasn't
    // returned, or it's empty and a first fetch is still in flight.
    isLoading: stored.isLoading || (storeEmpty && refreshing && refresh.every((r) => r.isPending)),
    // Hard error only when we have nothing in the store to keep showing.
    isError: storeEmpty && refreshing && refresh.every((r) => r.isError),
    errorMessage: errors[0]?.message,
    isFetching: stored.isFetching || refresh.some((r) => r.isFetching),
    refetch: () => {
      for (const result of refresh) void result.refetch()
    }
  }
}

/** Open issues across `repos`: rendered from the store, refreshed per repo. */
export function useRepoIssues(repos: Repo[]): Omit<Aggregated<IssueRow>, 'rows'> & {
  issues: IssueRow[]
} {
  const utils = trpc.useUtils()
  const refresh = trpc.useQueries((t) =>
    repos.map((repo) => t.github.issuesForRepo(repo, { staleTime: STALE_TIME }))
  )
  const stored = trpc.trackedItems.githubIssues.useQuery({ repos })
  const { rows, ...rest } = useRepoStoreQuery(repos, refresh, stored, selectIssues, () => {
    void utils.trackedItems.githubIssues.invalidate({ repos })
  })
  return { issues: rows, ...rest }
}

/** Open pull requests across `repos`: rendered from the store, refreshed per repo. */
export function useRepoPulls(repos: Repo[]): Omit<Aggregated<PullRequestRow>, 'rows'> & {
  pulls: PullRequestRow[]
} {
  const utils = trpc.useUtils()
  const refresh = trpc.useQueries((t) =>
    repos.map((repo) => t.github.pullsForRepo(repo, { staleTime: STALE_TIME }))
  )
  const stored = trpc.trackedItems.githubPulls.useQuery({ repos })
  const { rows, ...rest } = useRepoStoreQuery(repos, refresh, stored, selectPulls, () => {
    void utils.trackedItems.githubPulls.invalidate({ repos })
  })
  return { pulls: rows, ...rest }
}

/** A project-level refresh: refetch both the issue and PR queries for `repos`,
 * with one combined in-flight flag for a refresh button's spinner. Reuses the
 * same per-repo refresh queries the views use, so it adds no extra fetch — it
 * only re-triggers the ones already there. */
export function useRepoRefresh(repos: Repo[]): { refresh: () => void; isFetching: boolean } {
  const { isFetching: issuesFetching, refetch: refetchIssues } = useRepoIssues(repos)
  const { isFetching: pullsFetching, refetch: refetchPulls } = useRepoPulls(repos)
  return {
    refresh: () => {
      refetchIssues()
      refetchPulls()
    },
    isFetching: issuesFetching || pullsFetching
  }
}

/** Open issue and PR counts for `repos`, for the dashboard cards and tab badges.
 * Reads the same store + refresh as the full views (no extra fetch). The
 * `*Loaded` flags gate display so a count appears only once there's data —
 * avoiding a flash of "0" on a cold first launch before the store has anything. */
export function useRepoCounts(repos: Repo[]): {
  issues: number
  pulls: number
  issuesLoaded: boolean
  pullsLoaded: boolean
} {
  const { issues, isLoading: issuesLoading } = useRepoIssues(repos)
  const { pulls, isLoading: pullsLoading } = useRepoPulls(repos)
  return {
    issues: issues.length,
    pulls: pulls.length,
    issuesLoaded: !issuesLoading,
    pullsLoaded: !pullsLoading
  }
}
