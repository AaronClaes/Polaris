import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { githubAccounts } from '../../db/schema'
import { deleteToken, fetchViewer, storeToken } from '../../services/github'
import { isEncryptionAvailable } from '../../services/secrets'
import { publicProcedure, router } from '..'

const owner = z.string().trim().min(1, 'An account or organization is required')
const token = z.string().trim().min(1, 'A token is required')

export const githubRouter = router({
  // Connected owners, oldest first. Tokens never cross the IPC boundary — only
  // the display metadata does.
  listAccounts: publicProcedure.query(({ ctx }) =>
    ctx.db.select().from(githubAccounts).orderBy(asc(githubAccounts.createdAt)).all()
  ),

  // Link an owner: validate the token against GitHub first, store it encrypted,
  // then upsert the owner's metadata (re-linking an owner refreshes its token).
  connect: publicProcedure.input(z.object({ owner, token })).mutation(async ({ ctx, input }) => {
    if (!isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable, so the token cannot be saved safely.')
    }

    const viewer = await fetchViewer(input.token)
    storeToken(input.owner, input.token)

    return ctx.db
      .insert(githubAccounts)
      .values({
        owner: input.owner,
        login: viewer.login,
        name: viewer.name,
        avatarUrl: viewer.avatarUrl
      })
      .onConflictDoUpdate({
        target: githubAccounts.owner,
        set: {
          login: viewer.login,
          name: viewer.name,
          avatarUrl: viewer.avatarUrl
        }
      })
      .returning()
      .get()
  }),

  // Unlink an owner: drop both the stored token and its metadata row.
  disconnect: publicProcedure.input(z.object({ owner })).mutation(({ ctx, input }) => {
    deleteToken(input.owner)
    ctx.db.delete(githubAccounts).where(eq(githubAccounts.owner, input.owner)).run()
    return { owner: input.owner }
  })
})
