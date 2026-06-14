import { z } from 'zod'
import { emailContacts, emailThreadState, googleAccounts } from '../../db/schema'
import { markThreadDone, reconcileGmail } from '../../db/tracked-items'
import { buildSearchQuery, type EmailThread, listThreadsForAccount } from '../../services/gmail'
import { publicProcedure, router } from '..'

/** A contact match for one address: its project (null if unlinked) and whether it
 *  was an exact-address hit (vs a domain wildcard) — exact wins ties. */
type Match = { projectId: number | null; exact: boolean }

/**
 * Attribute a thread to a project from its messages. Scans them oldest-first and
 * picks from the EARLIEST message that contains a matched contact — so a contact
 * who joins on a later reply still attributes (the bug this fixed), while the
 * owning project stays stable as the thread grows (message order never changes).
 * Rule A: a project-linked contact always beats an unlinked one. Rule B: among
 * project-linked matches, the earlier message wins, then From ▸ To ▸ CC, then
 * exact-over-wildcard, then first-listed. Returns null when no participant in any
 * message maps to a project (the thread still shows — dashboard-only).
 */
function attributeProject(
  messages: EmailThread['messages'],
  resolve: (email: string) => Match | null
): number | null {
  const candidates: {
    msgIndex: number
    rank: number
    projectId: number | null
    exact: boolean
    order: number
  }[] = []
  messages.forEach((message, msgIndex) => {
    for (const [role, rank] of [
      ['from', 0],
      ['to', 1],
      ['cc', 2]
    ] as const) {
      message[role].forEach((email, order) => {
        const match = resolve(email)
        if (match) {
          candidates.push({ msgIndex, rank, projectId: match.projectId, exact: match.exact, order })
        }
      })
    }
  })

  const linked = candidates.filter((c) => c.projectId != null)
  if (linked.length === 0) return null
  linked.sort(
    (a, b) =>
      a.msgIndex - b.msgIndex ||
      a.rank - b.rank ||
      Number(b.exact) - Number(a.exact) ||
      a.order - b.order
  )
  return linked[0].projectId
}

export const gmailRouter = router({
  // The client emails that need a reply: every allowlisted thread whose latest
  // message isn't yours and that you haven't dismissed (with no newer activity
  // since). Each is attributed to a project (null = dashboard-only). Fetched live
  // per linked account; one account failing is collected, not thrown (mirrors
  // google.agenda / github.listRepos). Returns nothing — no fetch — when no
  // Google account is linked or the allowlist is empty.
  needsMe: publicProcedure.query(async ({ ctx }) => {
    const accounts = ctx.db.select().from(googleAccounts).all()
    if (accounts.length === 0) return { threads: [], errors: [] }

    const contacts = ctx.db.select().from(emailContacts).all()
    const query = buildSearchQuery(contacts.map((c) => c.pattern))
    if (!query) return { threads: [], errors: [] }

    // Resolvers: exact address beats domain wildcard. Patterns are already stored
    // lowercased; a wildcard is keyed by its bare domain.
    const exact = new Map<string, number | null>()
    const wildcard = new Map<string, number | null>()
    for (const contact of contacts) {
      if (contact.pattern.startsWith('@')) wildcard.set(contact.pattern.slice(1), contact.projectId)
      else exact.set(contact.pattern, contact.projectId)
    }
    const resolve = (email: string): Match | null => {
      if (exact.has(email)) return { projectId: exact.get(email) ?? null, exact: true }
      const domain = email.split('@')[1] ?? ''
      if (wildcard.has(domain)) return { projectId: wildcard.get(domain) ?? null, exact: false }
      return null
    }

    const myAddresses = new Set(accounts.map((a) => a.email.toLowerCase()))

    const fetched: EmailThread[] = []
    const errors: { account: string; message: string }[] = []
    for (const account of accounts) {
      try {
        fetched.push(...(await listThreadsForAccount(account.email, query, myAddresses)))
      } catch (err) {
        errors.push({
          account: account.email,
          message: err instanceof Error ? err.message : 'Failed to load email.'
        })
      }
    }

    // Write-through to the lifecycle store from the full (unfiltered) fetch, so a
    // replied thread is recorded as resolved and an unreplied one persists past
    // the 60-day window. Best-effort; the live feed below is unaffected.
    reconcileGmail(
      ctx.db,
      fetched.map((thread) => ({
        account: thread.account,
        threadId: thread.id,
        subject: thread.subject,
        participants: thread.participants,
        lastMessageFrom: thread.lastMessageFrom,
        lastMessageAt: thread.lastMessageAt,
        lastMessageFromMe: thread.lastMessageFromMe,
        url: thread.url,
        projectId: attributeProject(thread.messages, resolve)
      }))
    )

    // Dismissal watermarks (account:threadId → last-message-at when dismissed).
    const watermarks = new Map<string, number>()
    for (const row of ctx.db.select().from(emailThreadState).all()) {
      watermarks.set(`${row.account}:${row.threadId}`, row.dismissedMessageAt)
    }

    const threads = fetched
      .filter((thread) => {
        // You've replied → resolved automatically.
        if (thread.lastMessageFromMe) return false
        // Dismissed, and nothing newer has arrived since → stay hidden.
        const watermark = watermarks.get(`${thread.account}:${thread.id}`)
        return watermark === undefined || thread.lastMessageAt > watermark
      })
      .map((thread) => ({
        id: thread.id,
        account: thread.account,
        subject: thread.subject,
        participants: thread.participants,
        projectId: attributeProject(thread.messages, resolve),
        lastMessageAt: thread.lastMessageAt,
        url: thread.url
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)

    return { threads, errors }
  }),

  // Mark a thread done — local dismissal, Gmail untouched. Records it on the
  // tracked row as `disposition='done'` so the store-backed feed drops it; a
  // newer, not-from-you message un-dismisses it on the next reconcile. The
  // `lastMessageAt` input is kept for call-site compatibility (the watermark now
  // lives on the row's `lastActivityAt`, kept current by reconcile).
  markDone: publicProcedure
    .input(
      z.object({
        account: z.string().min(1),
        threadId: z.string().min(1),
        lastMessageAt: z.number()
      })
    )
    .mutation(({ ctx, input }) => {
      markThreadDone(ctx.db, input.account, input.threadId)
      return { account: input.account, threadId: input.threadId }
    })
})
