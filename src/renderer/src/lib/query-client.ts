import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { del, get, set } from 'idb-keyval'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // Persisted entries must outlive a session for the cache to survive a
      // restart, so keep them for a day after they go unused. The GitHub
      // per-repo queries set their own 60s staleTime, so they still refetch in
      // the background on open.
      gcTime: 1000 * 60 * 60 * 24,
      refetchOnWindowFocus: false
    }
  }
})

// IndexedDB-backed cache persistence: on launch the GitHub issue/PR data is
// restored instantly (shown stale) while a background refetch updates it, so
// the app never blocks on the network at open. Only the per-repo GitHub queries
// are written out — see `shouldDehydrateQuery` in main.tsx.
export const persister = createAsyncStoragePersister({
  key: 'polaris-query-cache',
  throttleTime: 1_000,
  storage: {
    getItem: async (key) => (await get(key)) ?? null,
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key)
  }
})
