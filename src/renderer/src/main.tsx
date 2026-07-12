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

// Version marker for the persisted cache (favicons, the app icon, and per-repo
// worktree lists — GitHub data lives in the SQLite tracked-items store and is
// no longer persisted here). Bump to throw the persisted cache away on
// hydration if its shape changes.
const CACHE_BUSTER = 'persist-4-icons-worktrees'

createRoot(rootElement).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: MAX_AGE,
          buster: CACHE_BUSTER,
          // Persist only small, Date-free payloads: resolved favicons and the app
          // icon. GitHub issue/PR data now renders from the SQLite tracked-items
          // store, so it's no longer persisted here. (projects.list carries Dates
          // that plain JSON would corrupt, so it stays out.)
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              if (query.state.status !== 'success') return false
              const group = query.queryKey[0]
              if (!Array.isArray(group)) return false
              const [namespace, procedure] = group
              if (namespace === 'favicon') return procedure === 'get'
              if (namespace === 'settings') return procedure === 'appIcon'
              // Worktree lists are derived from `git worktree list`, which
              // costs a login-shell spawn per repo — persisting the last
              // snapshot paints the glyphs instantly on launch while the
              // real state revalidates behind it.
              if (namespace === 'worktrees') return procedure === 'forRepo'
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
