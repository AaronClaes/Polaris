import './styles/globals.css'

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { persister, queryClient } from '@/lib/query-client'
import { router } from '@/lib/router'
import { trpc, trpcClient } from '@/lib/trpc'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

// A day-old snapshot is still worth showing instantly; anything older is dropped.
const MAX_AGE = 1000 * 60 * 60 * 24

createRoot(rootElement).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: MAX_AGE,
          // Persist only the per-repo GitHub queries: it keeps the on-disk blob
          // small, and avoids round-tripping queries whose payload carries Dates
          // (e.g. projects.list) through plain JSON, which would corrupt them.
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              const group = query.queryKey[0]
              const procedure = Array.isArray(group) ? group[1] : undefined
              return (
                query.state.status === 'success' &&
                (procedure === 'issuesForRepo' || procedure === 'pullsForRepo')
              )
            }
          }
        }}
      >
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </trpc.Provider>
  </StrictMode>
)
