import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { settings } from '../../db/schema'
import {
  DEFAULT_APP_SETTING_KEYS,
  IDES,
  readAppIcon,
  readDefaultApps,
  TERMINALS
} from '../../services/default-apps'
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
    .query(({ input }) => readAppIcon(input.key))
})
