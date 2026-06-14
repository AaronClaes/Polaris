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

// IndexedDB-backed cache persistence: resolved favicons and the app icon are
// restored instantly on launch so the UI never waits to draw them. GitHub
// issue/PR data is no longer persisted here — it renders from the SQLite
// tracked-items store. See `shouldDehydrateQuery` in main.tsx for what's written.
export const persister = createAsyncStoragePersister({
  key: 'polaris-query-cache',
  throttleTime: 1_000,
  storage: {
    getItem: async (key) => (await get(key)) ?? null,
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key)
  }
})
