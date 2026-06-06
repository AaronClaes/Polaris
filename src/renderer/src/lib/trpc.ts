import { createTRPCReact } from '@trpc/react-query'
import { ipcLink } from 'electron-trpc-experimental/renderer'
import superjson from 'superjson'
// Type-only import of the main-process router — erased at build, gives a fully
// typed client across the IPC boundary.
import type { AppRouter } from '../../../main/trpc/router'

export const trpc = createTRPCReact<AppRouter>()

// superjson here must match the server transformer (see src/main/trpc/index.ts).
export const trpcClient = trpc.createClient({
  links: [ipcLink<AppRouter>({ transformer: superjson })]
})
