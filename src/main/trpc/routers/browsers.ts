import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { browsers } from '../../db/schema'
import { detectInstalled, readProfiles, resolveBrowser } from '../../services/browsers'
import { publicProcedure, router } from '..'

const key = z.string().trim().min(1)

export const browsersRouter = router({
  // Installed browsers that can actually open a URL in a chosen profile — the
  // candidates to link. Browser Company apps (Dia/Arc) are installed-detectable
  // but excluded here: they can't target a profile from outside the app.
  listInstalled: publicProcedure.query(() =>
    detectInstalled()
      .filter((browser) => browser.supportsProfiles)
      .map((browser) => ({ key: browser.key, name: browser.name }))
  ),

  // Linked browsers with their current profiles, oldest first. Profiles are read
  // fresh from each browser's Local State (so renamed/added profiles show up). A
  // linked browser whose app was removed — or a stale row for one we no longer
  // support (e.g. a Dia link saved before this gating) — is dropped.
  listLinked: publicProcedure.query(({ ctx }) => {
    const linked = ctx.db.select().from(browsers).orderBy(asc(browsers.createdAt)).all()
    return linked.flatMap((row) => {
      const entry = resolveBrowser(row.key)
      if (!entry?.supportsProfiles) return []
      return [{ key: entry.key, name: entry.name, profiles: readProfiles(entry.userDataDir) }]
    })
  }),

  // Link an installed browser by key. Idempotent; rejects an unknown,
  // not-installed, or profile-incapable key so the picker can't persist a
  // browser whose profiles we can't actually target.
  link: publicProcedure.input(z.object({ key })).mutation(({ ctx, input }) => {
    const entry = resolveBrowser(input.key)
    if (!entry) throw new Error('Unknown browser')
    if (!entry.supportsProfiles) {
      throw new Error(`${entry.name} can't open links in a specific profile`)
    }
    if (!detectInstalled().some((browser) => browser.key === entry.key)) {
      throw new Error(`${entry.name} is not installed`)
    }
    ctx.db.insert(browsers).values({ key: entry.key }).onConflictDoNothing().run()
    return { key: entry.key }
  }),

  // Unlink a browser. Link actions that referenced it fall back to the OS
  // default browser (the runner treats an unknown browser as no target).
  unlink: publicProcedure.input(z.object({ key })).mutation(({ ctx, input }) => {
    ctx.db.delete(browsers).where(eq(browsers.key, input.key)).run()
    return { key: input.key }
  })
})
