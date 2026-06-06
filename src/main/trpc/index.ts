import { initTRPC } from '@trpc/server'
import type { CreateContextOptions } from 'electron-trpc-experimental/main'
import superjson from 'superjson'
import { db } from '../db/client'

export interface Context {
  db: typeof db
}

/**
 * Build the per-call context. electron-trpc passes the IpcMainInvokeEvent; we
 * expose the shared drizzle handle (and, later, request-scoped services).
 */
export async function createContext(_opts: CreateContextOptions): Promise<Context> {
  return { db }
}

// superjson on the server — mirrored by the renderer's ipcLink — so Dates and
// other rich types survive the JSON-based IPC transport.
const t = initTRPC.context<Context>().create({ transformer: superjson })

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware
