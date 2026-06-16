import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { emailContacts, projects } from '../../db/schema'
import { publicProcedure, router } from '..'

// The owning project, joined into the list so each row can show (and be grouped
// by) which project it belongs to. Left-joined, so an unlinked contact's
// `project` is null — mirrors the todos global list.
const projectRef = {
  id: projects.id,
  name: projects.name,
  icon: projects.icon,
  color: projects.color
}

// A full address (`bob@clientA.com`) or a bare domain (`clientA.com`), the part
// after a wildcard's `@`. Deliberately loose — we only guard against obvious
// junk, not RFC-perfect addresses, since the real check is whether mail arrives.
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
const EMAIL = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * Normalize and validate an email pattern: trim + lowercase, then accept either a
 * full address or a domain wildcard (a leading `@`, e.g. `@clientA.com`, matching
 * every sender at that domain). Throws a user-facing message on junk — the caller
 * treats a throw as "don't store this". Shared by the contacts and blocklist
 * routers, which take the same address/`@domain` shape.
 */
export function normalizePattern(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (!value) throw new Error('Enter an email address or a domain.')

  if (value.startsWith('@')) {
    const domain = value.slice(1)
    if (!DOMAIN.test(domain)) {
      throw new Error('That domain looks off — use a form like @clientA.com.')
    }
    return value
  }

  if (!EMAIL.test(value)) {
    throw new Error('That looks off — use a full address (bob@clientA.com) or @clientA.com.')
  }
  return value
}

const projectId = z.number().int().nullable().optional()

export const emailContactsRouter = router({
  // The whole allowlist, each entry tagged with its owning project (null when
  // unlinked). Oldest first — the order they were added. Tokens/secrets aren't
  // involved here; this is plain whitelist metadata.
  list: publicProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        id: emailContacts.id,
        pattern: emailContacts.pattern,
        projectId: emailContacts.projectId,
        createdAt: emailContacts.createdAt,
        project: projectRef
      })
      .from(emailContacts)
      .leftJoin(projects, eq(emailContacts.projectId, projects.id))
      .orderBy(asc(emailContacts.createdAt))
      .all()
  ),

  // Add an allowed sender. Validates/normalizes the pattern, then rejects a
  // duplicate with a friendly message rather than a raw UNIQUE-constraint throw.
  create: publicProcedure
    .input(z.object({ pattern: z.string(), projectId }))
    .mutation(({ ctx, input }) => {
      const pattern = normalizePattern(input.pattern)
      const existing = ctx.db
        .select({ id: emailContacts.id })
        .from(emailContacts)
        .where(eq(emailContacts.pattern, pattern))
        .get()
      if (existing) throw new Error(`${pattern} is already on the list.`)

      return ctx.db
        .insert(emailContacts)
        .values({ pattern, projectId: input.projectId ?? null })
        .returning()
        .get()
    }),

  // Re-file (or unlink) a contact: set or clear its project link.
  setProject: publicProcedure
    .input(z.object({ id: z.number().int(), projectId }))
    .mutation(({ ctx, input }) =>
      ctx.db
        .update(emailContacts)
        .set({ projectId: input.projectId ?? null })
        .where(eq(emailContacts.id, input.id))
        .returning()
        .get()
    ),

  // Drop a sender from the allowlist — its mail stops entering Polaris.
  delete: publicProcedure.input(z.object({ id: z.number().int() })).mutation(({ ctx, input }) => {
    ctx.db.delete(emailContacts).where(eq(emailContacts.id, input.id)).run()
    return { id: input.id }
  })
})
