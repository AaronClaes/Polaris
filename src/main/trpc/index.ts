import { initTRPC } from '@trpc/server'
import type { WebContents } from 'electron'
import type { CreateContextOptions } from 'electron-trpc-experimental/main'
import superjson from 'superjson'
import { db } from '../db/client'

export interface Context {
  db: typeof db
  /** The web contents that made the call — used to scope per-window resources
   *  (e.g. the optimize service frees a window's temp results when it's destroyed). */
  sender: WebContents
}

/**
 * Build the per-call context. electron-trpc passes the IpcMainInvokeEvent; we
 * expose the shared drizzle handle and the calling window's web contents.
 */
export async function createContext(opts: CreateContextOptions): Promise<Context> {
  return { db, sender: opts.event.sender }
}

// superjson on the server — mirrored by the renderer's ipcLink — so Dates and
// other rich types survive the JSON-based IPC transport.
const t = initTRPC.context<Context>().create({ transformer: superjson })

export const router = t.router
export const publicProcedure = t.procedure
export const middleware = t.middleware
