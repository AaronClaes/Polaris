import { useMemo } from 'react'
import type { EmailThreadRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

// Matches the GitHub views: fresh for a minute, background-refetched on open and
// window focus (react-query's default), no polling.
const STALE_TIME = 60_000

/**
 * The client emails that need a reply, for the work-item feed. Only fetches when
 * a Google account is linked (otherwise there's nothing to read), so the
 * dashboard is unchanged for anyone not using the integration. The router has
 * already filtered to unreplied + not-dismissed threads and attributed each to a
 * project; the dashboard shows them all, a project Home tab filters by project.
 */
export function useNeedsMeEmails(): {
  emails: EmailThreadRow[]
  errors: { account: string; message: string }[]
  isLoading: boolean
} {
  const accounts = trpc.google.listAccounts.useQuery()
  const connected = (accounts.data?.length ?? 0) > 0
  const query = trpc.gmail.needsMe.useQuery(undefined, {
    enabled: connected,
    staleTime: STALE_TIME
  })
  const emails = useMemo(() => query.data?.threads ?? [], [query.data])
  return {
    emails,
    errors: query.data?.errors ?? [],
    isLoading: connected && query.isLoading
  }
}

/**
 * Mark a thread done (a local dismissal — Gmail is untouched). Optimistically
 * drops the row from the cached feed so it disappears at once; on error it's
 * restored. We deliberately don't refetch on success — the dismissal is
 * persisted, and a Gmail round-trip per click would be wasteful; the next
 * focus/stale refetch reconciles.
 */
export function useCompleteEmail() {
  const utils = trpc.useUtils()
  return trpc.gmail.markDone.useMutation({
    onMutate: async (vars) => {
      await utils.gmail.needsMe.cancel()
      const previous = utils.gmail.needsMe.getData()
      utils.gmail.needsMe.setData(undefined, (old) =>
        old
          ? {
              ...old,
              threads: old.threads.filter(
                (thread) => !(thread.account === vars.account && thread.id === vars.threadId)
              )
            }
          : old
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) utils.gmail.needsMe.setData(undefined, context.previous)
    }
  })
}
