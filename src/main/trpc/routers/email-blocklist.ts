import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { emailBlocklist } from '../../db/schema'
import { publicProcedure, router } from '..'
import { normalizePattern } from './email-contacts'

/**
 * The email blocklist: senders (full addresses or `@domain` wildcards) whose mail
 * is kept out of the inbox feed. Inclusion is otherwise "every unreplied thread in
 * your primary inbox", so this is the noise valve. A block is applied at read time
 * (see the trackedItems.gmail router) against a thread's sender, and overridden
 * when the thread also involves a contact — so a domain block never hides a linked
 * contact at that domain. No project link: exclusion is global.
 */
export const emailBlocklistRouter = router({
  // The whole blocklist, oldest first (the order entries were added).
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(emailBlocklist).orderBy(asc(emailBlocklist.createdAt)).all()
  ),

  // Add a blocked sender. Validates/normalizes the pattern (shared with contacts),
  // then rejects a duplicate with a friendly message rather than a raw UNIQUE throw.
  create: publicProcedure.input(z.object({ pattern: z.string() })).mutation(({ ctx, input }) => {
    const pattern = normalizePattern(input.pattern)
    const existing = ctx.db
      .select({ id: emailBlocklist.id })
      .from(emailBlocklist)
      .where(eq(emailBlocklist.pattern, pattern))
      .get()
    if (existing) throw new Error(`${pattern} is already blocked.`)

    return ctx.db.insert(emailBlocklist).values({ pattern }).returning().get()
  }),

  // Unblock a sender — its mail can surface in the feed again.
  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(emailBlocklist).where(eq(emailBlocklist.id, input.id)).run()
    return { id: input.id }
  })
})
