import { useEffect, useMemo } from 'react'
import type { EmailThreadRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

// Matches the GitHub views: fresh for a minute, background-refetched on open and
// window focus (react-query's default), no polling.
const STALE_TIME = 60_000

/**
 * The client emails that need a reply, for the work-item feed. Renders from the
 * store (`trackedItems.gmail`) — instant, resilient to a failed fetch, and
 * retaining threads aged past the Gmail search window — while `gmail.needsMe`
 * runs in the background to fetch + reconcile, then invalidates the store read.
 * Only runs when a Google account is linked, so it's a no-op otherwise.
 */
export function useNeedsMeEmails(): {
  emails: EmailThreadRow[]
  errors: { account: string; message: string }[]
  isLoading: boolean
} {
  const utils = trpc.useUtils()
  const accounts = trpc.google.listAccounts.useQuery()
  const connected = (accounts.data?.length ?? 0) > 0

  // Render source: the store (fast, offline-ok).
  const stored = trpc.trackedItems.gmail.useQuery(undefined, { enabled: connected })
  // Background refresh: fetch + reconcile; on settle, re-read the store.
  const refresh = trpc.gmail.needsMe.useQuery(undefined, {
    enabled: connected,
    staleTime: STALE_TIME
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the store only when the refresh settles
  useEffect(() => {
    if (connected) void utils.trackedItems.gmail.invalidate()
  }, [connected, refresh.status, refresh.dataUpdatedAt, refresh.errorUpdatedAt])

  const emails = useMemo(() => stored.data?.threads ?? [], [stored.data])
  return {
    emails,
    errors: refresh.data?.errors ?? [],
    // Skeleton only when there's nothing yet: store empty and a first fetch pending.
    isLoading: connected && emails.length === 0 && (stored.isLoading || refresh.isLoading)
  }
}

/**
 * Mark a thread done (a local dismissal — Gmail is untouched; it sets
 * `disposition='done'` on the stored row). Optimistically drops the row from the
 * store-backed feed so it disappears at once; on error it's restored. We don't
 * refetch on success — the dismissal is persisted, and the next stale refresh
 * reconciles anyway.
 */
export function useCompleteEmail() {
  const utils = trpc.useUtils()
  return trpc.gmail.markDone.useMutation({
    onMutate: async (vars) => {
      await utils.trackedItems.gmail.cancel()
      const previous = utils.trackedItems.gmail.getData()
      utils.trackedItems.gmail.setData(undefined, (old) =>
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
      if (context?.previous) utils.trackedItems.gmail.setData(undefined, context.previous)
    }
  })
}

/**
 * Set (or clear) a thread's local display title. A blank title clears the override,
 * reverting to the original subject. Optimistically rewrites the row in the
 * store-backed feed so the new title shows at once; on error it's restored. No
 * refetch — the override is persisted, and the next stale refresh reconciles.
 */
export function useEditEmailTitle() {
  const utils = trpc.useUtils()
  return trpc.gmail.setTitle.useMutation({
    onMutate: async (vars) => {
      await utils.trackedItems.gmail.cancel()
      const previous = utils.trackedItems.gmail.getData()
      const title = vars.title.trim()
      utils.trackedItems.gmail.setData(undefined, (old) =>
        old
          ? {
              ...old,
              threads: old.threads.map((thread) =>
                thread.account === vars.account && thread.id === vars.threadId
                  ? {
                      ...thread,
                      subject: title || thread.originalSubject,
                      titleEdited: title.length > 0
                    }
                  : thread
              )
            }
          : old
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) utils.trackedItems.gmail.setData(undefined, context.previous)
    }
  })
}
