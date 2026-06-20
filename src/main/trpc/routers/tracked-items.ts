import { z } from 'zod'
import { emailBlocklist, emailContacts, googleAccounts } from '../../db/schema'
import { type GmailThreadPayload, selectActive, selectArchivedGithub } from '../../db/tracked-items'
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

  // Active (unreplied, not-dismissed) inbox threads across all linked accounts,
  // from the store — including ones aged past the Gmail search window (the
  // retention win). `errors` is always empty (a local read can't fail per-account);
  // it mirrors `gmail.needsMe`'s shape so the feed loader treats the two alike.
  gmail: publicProcedure.query(({ ctx }) => {
    const accounts = ctx.db
      .select()
      .from(googleAccounts)
      .all()
      .map((a) => a.email)

    // Contacts and the blocklist are both applied at read time (the store keeps
    // threads indefinitely, with no tombstone), so adding/removing either updates
    // the feed without a refetch. Patterns and emails are both lowercased.
    const contactExact = new Set<string>()
    const contactDomains = new Set<string>()
    for (const c of ctx.db.select().from(emailContacts).all()) {
      if (c.pattern.startsWith('@')) contactDomains.add(c.pattern.slice(1))
      else contactExact.add(c.pattern)
    }
    // The participants that match a contact — who files the thread under a project,
    // and (below) what rescues it from the blocklist.
    const contactsOf = (p: GmailThreadPayload): GmailThreadPayload['participants'] =>
      p.participants.filter(
        (pt) => contactExact.has(pt.email) || contactDomains.has(pt.email.split('@')[1] ?? '')
      )

    const blockedExact = new Set<string>()
    const blockedDomains = new Set<string>()
    for (const b of ctx.db.select().from(emailBlocklist).all()) {
      if (b.pattern.startsWith('@')) blockedDomains.add(b.pattern.slice(1))
      else blockedExact.add(b.pattern)
    }
    // A thread is blocked when its sender matches the blocklist. Matching the
    // sender (not any participant) avoids hiding a real conversation just because a
    // blocked address is cc'd.
    const senderBlocked = (from: string): boolean => {
      const email = from.toLowerCase()
      return blockedExact.has(email) || blockedDomains.has(email.split('@')[1] ?? '')
    }

    const threads = selectActive(ctx.db, 'gmail', 'thread', accounts)
      .map((row) => ({ row, payload: row.payload as GmailThreadPayload }))
      .map(({ row, payload }) => ({ row, payload, contacts: contactsOf(payload) }))
      // Hide a blocked sender — unless a contact is on the thread, in which case it
      // still matters (a domain block never buries a linked contact at that domain).
      .filter(
        ({ payload, contacts }) => !senderBlocked(payload.lastMessageFrom) || contacts.length > 0
      )
      .map(({ row, payload, contacts }) => ({
        id: payload.id,
        account: payload.account,
        // A user override replaces the (often unhelpful) subject in the feed; the
        // original stays available for the "was…" tooltip and as the reset target.
        subject: row.titleOverride ?? payload.subject,
        originalSubject: payload.subject,
        titleEdited: row.titleOverride != null,
        participants: payload.participants,
        // The contact(s) on the thread — surfaced apart from the avatar stack to
        // show who files it under a project (empty for an unlinked inbox thread).
        contacts,
        projectId: row.projectId,
        lastMessageAt: payload.lastMessageAt,
        url: payload.url
      }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    return { threads, errors: [] as { account: string; message: string }[] }
  }),

  // Completed GitHub issues/PRs for the Archive timeline, newest completion first.
  // The payload is the last-known OPEN snapshot (issue/PR row) — enough to render
  // the title, link, repo and assignment bucket; `closedAt` is when the store
  // recorded the closure (see selectArchivedGithub for the when-noticed caveat).
  // The renderer fuses an issue with the PR that closed it and merges in completed
  // todos, so this stays a dumb store read.
  archive: publicProcedure.query(({ ctx }) => {
    const items = selectArchivedGithub(ctx.db).map((row) => ({
      kind: row.kind as 'issue' | 'pr',
      projectId: row.projectId,
      closedAt: row.closedAt,
      payload: row.payload as IssueRow | PullRow
    }))
    return { items }
  })
})
