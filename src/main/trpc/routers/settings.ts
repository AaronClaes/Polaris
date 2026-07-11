import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { settings } from '../../db/schema'
import {
  DEFAULT_APP_SETTING_KEYS,
  IDES,
  readAppIcon,
  readDefaultApps,
  TERMINALS
} from '../../services/default-apps'
import { readWorktreesRoot, WORKTREES_ROOT_SETTING_KEY } from '../../services/worktrees'
import { publicProcedure, router } from '..'

export const settingsRouter = router({
  // The chosen default terminal + IDE (as registry keys) alongside the supported
  // options, so the settings dropdowns render from a single main-side source.
  defaultApps: publicProcedure.query(({ ctx }) => {
    const current = readDefaultApps(ctx.db)
    return {
      terminal: current.terminal.key,
      ide: current.ide.key,
      terminals: TERMINALS,
      ides: IDES
    }
  }),

  // Persist a default-app choice. The key is validated against the registry so a
  // stale/unknown app can't be stored; the runner falls back regardless.
  setDefaultApp: publicProcedure
    .input(z.object({ kind: z.enum(['terminal', 'ide']), key: z.string().trim().min(1) }))
    .mutation(({ ctx, input }) => {
      const registry = input.kind === 'terminal' ? TERMINALS : IDES
      if (!registry.some((app) => app.key === input.key)) {
        throw new Error(`Unknown ${input.kind}: ${input.key}`)
      }
      const settingKey = DEFAULT_APP_SETTING_KEYS[input.kind]
      ctx.db
        .insert(settings)
        .values({ key: settingKey, value: input.key })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: input.key, updatedAt: sql`(unixepoch())` }
        })
        .run()
      return { ok: true }
    }),

  // A supported app's macOS icon as a data URL (null when not installed). Keyed
  // by registry key so the renderer can cache it indefinitely — see the favicon
  // query for the same pattern.
  appIcon: publicProcedure
    .input(z.object({ key: z.string().trim().min(1) }))
    .query(({ input }) => readAppIcon(input.key)),

  // The effective worktrees root (stored value or the ~/polaris/worktrees
  // default) — always a concrete path, so the settings field and the creation
  // dialog's path preview render the real destination.
  worktreesRoot: publicProcedure.query(({ ctx }) => ({ root: readWorktreesRoot(ctx.db) })),

  // Persist the worktrees root. A blank path clears the row, reverting to the
  // default (the query above never surfaces "unset").
  setWorktreesRoot: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(({ ctx, input }) => {
      const path = input.path.trim()
      if (!path) {
        ctx.db.delete(settings).where(eq(settings.key, WORKTREES_ROOT_SETTING_KEY)).run()
      } else {
        ctx.db
          .insert(settings)
          .values({ key: WORKTREES_ROOT_SETTING_KEY, value: path })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: path, updatedAt: sql`(unixepoch())` }
          })
          .run()
      }
      return { root: readWorktreesRoot(ctx.db) }
    })
})
