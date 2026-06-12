import './styles/globals.css'

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { persister, queryClient } from '@/lib/query-client'
import { router } from '@/lib/router'
import { initTheme } from '@/lib/theme'
import { trpc, trpcClient } from '@/lib/trpc'

// Apply the saved theme before first paint so there's no flash of the wrong one.
initTheme()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

// A day-old snapshot is still worth showing instantly; anything older is dropped.
const MAX_AGE = 1000 * 60 * 60 * 24

// Bump whenever the persisted GitHub query shape changes. A snapshot written by
// an older build is restored synchronously on first paint (the dashboard runs
// buildWorkItems over it before the background refetch lands), so an out-of-date
// shape would crash on a field that didn't exist yet. A mismatched buster makes
// the persister throw the stale cache away on hydration instead.
const CACHE_BUSTER = 'gh-shape-2-linked-branches'

createRoot(rootElement).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: MAX_AGE,
          buster: CACHE_BUSTER,
          // Persist only small, Date-free payloads: the per-repo GitHub queries
          // and resolved favicons. (projects.list carries Dates that plain JSON
          // would corrupt, so it stays out.)
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              if (query.state.status !== 'success') return false
              const group = query.queryKey[0]
              if (!Array.isArray(group)) return false
              const [namespace, procedure] = group
              if (namespace === 'github')
                return procedure === 'issuesForRepo' || procedure === 'pullsForRepo'
              if (namespace === 'favicon') return procedure === 'get'
              if (namespace === 'settings') return procedure === 'appIcon'
              return false
            }
          }
        }}
      >
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </trpc.Provider>
  </StrictMode>
)
