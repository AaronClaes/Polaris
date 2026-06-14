import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { DB } from './client'
import {
  emailThreadState,
  type NewTrackedItem,
  projectRepos,
  type TrackedItem,
  trackedItems
} from './schema'

/**
 * Write-through reconciler for {@link trackedItems}. Called as a side-effect of a
 * *successful* source fetch (see the github/gmail routers) so the store mirrors
 * what each fetch saw. The feed renders from the store (see the trackedItems
 * router); these fetches are its background refresh. Every entrypoint is
 * best-effort: a reconcile failure is logged and swallowed so it can never break
 * the feed it backs.
 *
 * The interesting part is per-source closure policy. GitHub is fetched OPEN-only,
 * so an item that vanishes from a scope's fetch has closed → we tombstone it.
 * Gmail vanishing means it aged out of the search window, NOT that it's done, so
 * Gmail never tombstones; its only closure signal is an explicit reply.
 */

type Source = 'github' | 'gmail'
type Kind = 'issue' | 'pr' | 'thread'
type ClosedReason = NonNullable<NewTrackedItem['closedReason']>

/** One observation of an item from a single successful fetch. */
interface Observation {
  source: Source
  kind: Kind
  externalId: string
  scopeKey: string
  projectId: number | null
  title: string
  url: string
  payload: unknown
  sourceCreatedAt: Date | null
  lastActivityAt: number | null
  // Set when the fetch itself proves the item resolved (e.g. you replied).
  // Absence-based closure is handled separately by the tombstone pass below.
  closed: { reason: ClosedReason } | null
}

interface ApplyOptions {
  // When set, after upserts any still-open stored row in this scope that wasn't
  // observed is closed as `upstream_closed`. Use only where absence ⇒ closed
  // (GitHub) — never for Gmail, where absence = aged out of the window.
  tombstone?: { source: Source; kind: Kind; scopeKey: string }
}

/** Upsert a batch of observations, then optionally tombstone the unseen. */
function applyObservations(db: DB, observations: Observation[], opts: ApplyOptions = {}): void {
  db.transaction((tx) => {
    const now = new Date()

    for (const o of observations) {
      const existing = tx
        .select()
        .from(trackedItems)
        .where(and(eq(trackedItems.source, o.source), eq(trackedItems.externalId, o.externalId)))
        .get()

      if (!existing) {
        tx.insert(trackedItems)
          .values({
            source: o.source,
            kind: o.kind,
            externalId: o.externalId,
            scopeKey: o.scopeKey,
            projectId: o.projectId,
            title: o.title,
            url: o.url,
            payload: o.payload,
            upstreamState: o.closed ? 'closed' : 'open',
            closedReason: o.closed?.reason ?? null,
            firstSeenAt: now,
            lastSeenAt: now,
            sourceCreatedAt: o.sourceCreatedAt,
            lastActivityAt: o.lastActivityAt,
            closedAt: o.closed ? now : null
          })
          .run()
        continue
      }

      const set: Partial<NewTrackedItem> = {
        scopeKey: o.scopeKey,
        projectId: o.projectId,
        title: o.title,
        url: o.url,
        payload: o.payload,
        lastSeenAt: now,
        lastActivityAt: o.lastActivityAt ?? existing.lastActivityAt,
        // Backfill an upstream creation time once we learn it; never overwrite.
        sourceCreatedAt: existing.sourceCreatedAt ?? o.sourceCreatedAt,
        updatedAt: now
      }

      if (o.closed) {
        // Explicit upstream resolution (e.g. replied). Stamp closedAt once.
        if (existing.upstreamState !== 'closed') {
          set.upstreamState = 'closed'
          set.closedReason = o.closed.reason
          set.closedAt = now
        }
      } else if (existing.upstreamState === 'closed') {
        // Seen open again after having been closed — it came back.
        set.upstreamState = 'open'
        set.closedReason = null
        set.closedAt = null
        set.reopenedAt = now
        set.reopenCount = (existing.reopenCount ?? 0) + 1
      }

      // An item you'd dismissed ('done') with genuinely newer activity that isn't
      // your own reply needs you again — the store equivalent of the email
      // watermark's "reappears on a newer message". Compared against the stored
      // activity time, so re-observing the same state is a no-op.
      if (
        existing.disposition === 'done' &&
        !o.closed &&
        o.lastActivityAt != null &&
        (existing.lastActivityAt == null || o.lastActivityAt > existing.lastActivityAt)
      ) {
        set.disposition = 'none'
      }

      tx.update(trackedItems).set(set).where(eq(trackedItems.id, existing.id)).run()
    }

    if (opts.tombstone) {
      const { source, kind, scopeKey } = opts.tombstone
      const observedIds = observations.map((o) => o.externalId)
      const scope = and(
        eq(trackedItems.source, source),
        eq(trackedItems.kind, kind),
        eq(trackedItems.scopeKey, scopeKey),
        eq(trackedItems.upstreamState, 'open')
      )
      tx.update(trackedItems)
        .set({
          upstreamState: 'closed',
          closedReason: 'upstream_closed',
          closedAt: now,
          updatedAt: now
        })
        // notInArray with an empty list is invalid SQL, so when nothing was
        // observed (an empty scope), close every still-open row in it.
        .where(
          observedIds.length > 0
            ? and(scope, notInArray(trackedItems.externalId, observedIds))
            : scope
        )
        .run()
    }
  })
}

/** Owner+name → the project a repo is linked under (first match, case-insensitive). */
function resolveRepoProject(db: DB, owner: string, name: string): number | null {
  const lcOwner = owner.toLowerCase()
  const lcName = name.toLowerCase()
  const match = db
    .select()
    .from(projectRepos)
    .all()
    .find((r) => r.owner.toLowerCase() === lcOwner && r.name.toLowerCase() === lcName)
  return match?.projectId ?? null
}

/** The fields the GitHub reconciler reads off a normalized issue/PR row; the
 * whole row (with its `repo`/`bucket`) is stored verbatim as the payload. */
interface GithubRow {
  id: string
  title: string
  url: string
  createdAt: string
  updatedAt: string
}

/**
 * Reconcile one repo's OPEN issues *or* PRs (a single (scope, kind) unit). The
 * tombstone pass closes anything we'd previously seen open in this repo+kind that
 * isn't in the fetch — i.e. it was closed/merged upstream.
 */
export function reconcileGithub(
  db: DB,
  params: { owner: string; name: string; kind: 'issue' | 'pr'; rows: GithubRow[] }
): void {
  try {
    const scopeKey = `${params.owner}/${params.name}`
    const projectId = resolveRepoProject(db, params.owner, params.name)
    const observations: Observation[] = params.rows.map((row) => {
      const activityMs = Date.parse(row.updatedAt)
      return {
        source: 'github',
        kind: params.kind,
        externalId: row.id,
        scopeKey,
        projectId,
        title: row.title,
        url: row.url,
        payload: row,
        sourceCreatedAt: new Date(row.createdAt),
        lastActivityAt: Number.isNaN(activityMs) ? null : activityMs,
        closed: null
      }
    })
    applyObservations(db, observations, {
      tombstone: { source: 'github', kind: params.kind, scopeKey }
    })
  } catch (err) {
    console.error('tracked-items: github reconcile failed', err)
  }
}

/** A Gmail thread to record, already attributed to a project by the caller. */
interface GmailThreadInput {
  account: string
  threadId: string
  subject: string
  participants: { name: string; email: string }[]
  lastMessageFrom: string
  lastMessageAt: number
  lastMessageFromMe: boolean
  url: string
  projectId: number | null
}

/** The thread snapshot stored in a Gmail row's `payload` (`projectId` lives in
 * its own column). The read layer reconstructs the feed row from this. */
export interface GmailThreadPayload {
  id: string
  account: string
  subject: string
  participants: { name: string; email: string }[]
  lastMessageFrom: string
  lastMessageAt: number
  lastMessageFromMe: boolean
  url: string
}

/**
 * Reconcile the full (unfiltered) set of fetched threads. No tombstone pass:
 * a thread absent from a later fetch has only aged past the search window, so it
 * stays in the store until you actually reply (recorded here) or mark it done
 * (see markThreadDone). A reply on a previously-replied thread reopens it via
 * applyObservations.
 */
export function reconcileGmail(db: DB, threads: GmailThreadInput[]): void {
  try {
    const observations: Observation[] = threads.map((t) => ({
      source: 'gmail',
      kind: 'thread',
      externalId: `${t.account}:${t.threadId}`,
      scopeKey: t.account,
      projectId: t.projectId,
      title: t.subject,
      url: t.url,
      payload: {
        id: t.threadId,
        account: t.account,
        subject: t.subject,
        participants: t.participants,
        lastMessageFrom: t.lastMessageFrom,
        lastMessageAt: t.lastMessageAt,
        lastMessageFromMe: t.lastMessageFromMe,
        url: t.url
      } satisfies GmailThreadPayload,
      sourceCreatedAt: null,
      lastActivityAt: t.lastMessageAt,
      closed: t.lastMessageFromMe ? { reason: 'replied' } : null
    }))
    applyObservations(db, observations)
  } catch (err) {
    console.error('tracked-items: gmail reconcile failed', err)
  }
}

/**
 * Read the *active* tracked rows for a (source, kind) within the given scopes —
 * the Phase 2 render source. Active = still open upstream and not dismissed/done.
 * Returns raw rows; the caller reconstructs the feed shape from each `payload`.
 * (Snooze-aware filtering arrives with the snooze feature; nothing is snoozed
 * yet.) An empty scope list short-circuits to avoid an empty-IN query.
 */
export function selectActive(
  db: DB,
  source: Source,
  kind: Kind,
  scopeKeys: string[]
): TrackedItem[] {
  if (scopeKeys.length === 0) return []
  return db
    .select()
    .from(trackedItems)
    .where(
      and(
        eq(trackedItems.source, source),
        eq(trackedItems.kind, kind),
        inArray(trackedItems.scopeKey, scopeKeys),
        eq(trackedItems.upstreamState, 'open'),
        notInArray(trackedItems.disposition, ['done', 'dismissed'])
      )
    )
    .all()
}

/**
 * Mark a Gmail thread done — a local dismissal (Gmail untouched), now recorded on
 * the tracked row as `disposition='done'` so the store read drops it. Newer,
 * not-from-you activity un-dismisses it on the next reconcile (see the un-dismiss
 * rule in applyObservations), reproducing the old watermark's reappear behavior.
 * No-op if the thread isn't in the store (it always is — it was just rendered).
 */
export function markThreadDone(db: DB, account: string, threadId: string): void {
  const now = new Date()
  db.update(trackedItems)
    .set({
      disposition: 'done',
      closedReason: 'manual',
      closedAt: now,
      lastUserActionAt: now,
      updatedAt: now
    })
    .where(
      and(eq(trackedItems.source, 'gmail'), eq(trackedItems.externalId, `${account}:${threadId}`))
    )
    .run()
}

/** Same Gmail deep link the service builds — replicated to keep this DB layer
 * free of a dependency on the service module. */
function gmailThreadUrl(account: string, threadId: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${threadId}`
}

/**
 * One-time backfill: fold legacy {@link emailThreadState} dismissals into the
 * store as `disposition='done'`, so threads you'd already dismissed stay hidden
 * once the feed renders from the store. Runs at startup before any fetch, so most
 * threads aren't in the store yet — those get a minimal placeholder row (enriched
 * by the next reconcile if still active). Self-guarding and idempotent: it only
 * marks a row done when it's still untouched and the dismissal hasn't been
 * superseded by newer activity, so re-running never re-dismisses a reopened thread.
 */
export function migrateEmailDismissals(db: DB): void {
  const dismissals = db.select().from(emailThreadState).all()
  if (dismissals.length === 0) return
  const now = new Date()
  db.transaction((tx) => {
    for (const d of dismissals) {
      const externalId = `${d.account}:${d.threadId}`
      const existing = tx
        .select()
        .from(trackedItems)
        .where(and(eq(trackedItems.source, 'gmail'), eq(trackedItems.externalId, externalId)))
        .get()

      if (existing) {
        // Honor the watermark: skip if it's been reopened or newer activity has
        // arrived since the dismissal (lastActivityAt past the dismissed mark).
        const superseded =
          existing.lastActivityAt != null && existing.lastActivityAt > d.dismissedMessageAt
        if (existing.disposition === 'none' && !superseded) {
          tx.update(trackedItems)
            .set({ disposition: 'done', closedReason: 'manual', closedAt: now, updatedAt: now })
            .where(eq(trackedItems.id, existing.id))
            .run()
        }
        continue
      }

      const url = gmailThreadUrl(d.account, d.threadId)
      tx.insert(trackedItems)
        .values({
          source: 'gmail',
          kind: 'thread',
          externalId,
          scopeKey: d.account,
          projectId: null,
          title: '',
          url,
          payload: {
            id: d.threadId,
            account: d.account,
            subject: '',
            participants: [],
            lastMessageFrom: '',
            lastMessageAt: d.dismissedMessageAt,
            lastMessageFromMe: false,
            url
          } satisfies GmailThreadPayload,
          upstreamState: 'open',
          disposition: 'done',
          closedReason: 'manual',
          firstSeenAt: now,
          lastSeenAt: now,
          sourceCreatedAt: null,
          lastActivityAt: d.dismissedMessageAt,
          closedAt: now
        })
        .run()
    }
  })
}
