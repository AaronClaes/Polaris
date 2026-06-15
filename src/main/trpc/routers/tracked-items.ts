import { z } from 'zod'
import { emailContacts, googleAccounts } from '../../db/schema'
import { type GmailThreadPayload, selectActive } from '../../db/tracked-items'
import { publicProcedure, router } from '..'
import type { IssueRow, PullRow } from './github'

/**
 * Read side of the lifecycle store — the Phase 2 render source. These return the
 * *active* tracked rows as the shapes the feed reads while a background refresh
 * keeps the store fresh. GitHub mirrors `github.issuesForRepo`/`pullsForRepo`
 * exactly; the Gmail read extends `gmail.needsMe`'s thread shape with the
 * store-only fields (title override + the matched contact[s]). Local SELECTs only:
 * no network, so they paint instantly and survive a failed fetch.
 */

const repoInput = z.object({ owner: z.string().min(1), name: z.string().min(1) })

export const trackedItemsRouter = router({
  // Active open issues across the given repos, from the store.
  githubIssues: publicProcedure
    .input(z.object({ repos: z.array(repoInput) }))
    .query(({ ctx, input }) => {
      const scopeKeys = input.repos.map((r) => `${r.owner}/${r.name}`)
      const issues = selectActive(ctx.db, 'github', 'issue', scopeKeys).map(
        (row) => row.payload as IssueRow
      )
      return { issues }
    }),

  // Active open pull requests across the given repos, from the store.
  githubPulls: publicProcedure
    .input(z.object({ repos: z.array(repoInput) }))
    .query(({ ctx, input }) => {
      const scopeKeys = input.repos.map((r) => `${r.owner}/${r.name}`)
      const pulls = selectActive(ctx.db, 'github', 'pr', scopeKeys).map(
        (row) => row.payload as PullRow
      )
      return { pulls }
    }),

  // Active (unreplied, not-dismissed) client threads across all linked accounts,
  // from the store — including ones aged past the Gmail search window (the
  // retention win). `errors` is always empty (a local read can't fail per-account);
  // it mirrors `gmail.needsMe`'s shape so the feed loader treats the two alike.
  gmail: publicProcedure.query(({ ctx }) => {
    const accounts = ctx.db
      .select()
      .from(googleAccounts)
      .all()
      .map((a) => a.email)

    // Re-apply the current allowlist at read time: the store keeps Gmail threads
    // indefinitely (no tombstone), so without this, removing a contact would leave
    // their retained threads showing. Patterns and participant emails are both
    // lowercased, so set membership matches.
    const exact = new Set<string>()
    const domains = new Set<string>()
    for (const c of ctx.db.select().from(emailContacts).all()) {
      if (c.pattern.startsWith('@')) domains.add(c.pattern.slice(1))
      else exact.add(c.pattern)
    }
    // The participants that match the allowlist — i.e. the contact(s) that put the
    // thread on the dashboard. Empty means the thread no longer matches (a removed
    // contact); such threads are filtered out below.
    const contactsOf = (p: GmailThreadPayload): GmailThreadPayload['participants'] =>
      p.participants.filter(
        (pt) => exact.has(pt.email) || domains.has(pt.email.split('@')[1] ?? '')
      )

    const threads = selectActive(ctx.db, 'gmail', 'thread', accounts)
      .map((row) => ({ row, payload: row.payload as GmailThreadPayload }))
      .map(({ row, payload }) => ({ row, payload, contacts: contactsOf(payload) }))
      .filter(({ contacts }) => contacts.length > 0)
      .map(({ row, payload, contacts }) => ({
        id: payload.id,
        account: payload.account,
        // A user override replaces the (often unhelpful) subject in the feed; the
        // original stays available for the "was…" tooltip and as the reset target.
        subject: row.titleOverride ?? payload.subject,
        originalSubject: payload.subject,
        titleEdited: row.titleOverride != null,
        participants: payload.participants,
        // The allowlisted participant(s) — surfaced apart from the avatar stack so
        // it's clear who put the thread on the dashboard.
        contacts,
        projectId: row.projectId,
        lastMessageAt: payload.lastMessageAt,
        url: payload.url
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    return { threads, errors: [] as { account: string; message: string }[] }
  })
})
