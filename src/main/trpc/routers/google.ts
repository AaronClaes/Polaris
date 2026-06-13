import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { googleAccounts } from '../../db/schema'
import {
  type CalendarEvent,
  connectGoogleAccount,
  deleteTokens,
  listAgendaEvents
} from '../../services/google'
import { isEncryptionAvailable } from '../../services/secrets'
import { publicProcedure, router } from '..'

export const googleRouter = router({
  // Linked Google accounts, oldest first. Tokens never cross the IPC boundary —
  // only display metadata does.
  listAccounts: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(googleAccounts).orderBy(asc(googleAccounts.createdAt)).all()
  ),

  // Run the loopback OAuth flow (opens the system browser), then upsert the
  // signed-in account's metadata. Re-linking the same email refreshes its grant.
  connect: publicProcedure.mutation(async ({ ctx }) => {
    if (!isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable, so the sign-in cannot be saved safely.')
    }
    const profile = await connectGoogleAccount()
    return ctx.db
      .insert(googleAccounts)
      .values({ email: profile.email, name: profile.name, picture: profile.picture })
      .onConflictDoUpdate({
        target: googleAccounts.email,
        set: { name: profile.name, picture: profile.picture }
      })
      .returning()
      .get()
  }),

  // Unlink an account: drop both the stored tokens and its metadata row.
  disconnect: publicProcedure
    .input(z.object({ email: z.string().trim().min(1) }))
    .mutation(({ ctx, input }) => {
      deleteTokens(input.email)
      ctx.db.delete(googleAccounts).where(eq(googleAccounts.email, input.email)).run()
      return { email: input.email }
    }),

  // The dashboard agenda: every linked account's primary-calendar events from
  // local midnight today through the end of tomorrow, merged and sorted by start.
  // One account failing (e.g. an expired grant) is collected, not thrown, so it
  // doesn't blank the whole agenda — mirrors github.listRepos.
  agenda: publicProcedure.query(async ({ ctx }) => {
    const accounts = ctx.db.select().from(googleAccounts).all()
    const now = new Date()
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    // Start of the day after tomorrow → an exclusive end covering all of tomorrow.
    const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)

    const events: CalendarEvent[] = []
    const errors: { account: string; message: string }[] = []
    for (const account of accounts) {
      try {
        events.push(...(await listAgendaEvents(account.email, timeMin, timeMax)))
      } catch (err) {
        errors.push({
          account: account.email,
          message: err instanceof Error ? err.message : 'Failed to load calendar.'
        })
      }
    }
    events.sort((a, b) => a.start.getTime() - b.start.getTime())
    return { events, errors }
  })
})
