import { getAccessToken } from './google'

/**
 * Gmail read service. Pulls the threads that involve a linked allowlist contact
 * and normalizes them for the dashboard's "needs you" feed. Reuses the Google
 * OAuth grant (see {@link getAccessToken}); needs the `gmail.readonly` scope.
 *
 * We never walk the whole mailbox — the allowlist is pushed into a Gmail search
 * query so the API only returns matching threads, bounded to a recency window.
 * Bodies are never fetched (metadata format: headers + timestamps only). Uses the
 * global `fetch`, mirroring the GitHub and Google services.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
// Only consider mail from the last 60 days — wide enough to still surface a
// thread you opened weeks ago and forgot, without scanning the whole mailbox.
const WINDOW = 'newer_than:60d'
// The feed's universe: every thread in your inbox within the window. `in:inbox`
// means archiving a thread in Gmail drops it here too (a free "handled" signal).
// No `category:primary` — Workspace inboxes (and anyone with the category tabs
// turned off) classify nothing into Primary, so that operator can match zero mail;
// the blocklist does the noise pruning instead. Who's a real contact (project
// attribution) and which senders to hide (the blocklist) are applied later, not in
// this query, so a blocked sender can still be rescued by a contact on the thread.
const INBOX_QUERY = `in:inbox ${WINDOW}`
// Page size for threads.list — Gmail's maximum, so the full match set pages in
// as few calls as possible (one call unless an account has 500+ matches).
const PAGE_SIZE = 500
// How many thread-metadata fetches run at once. Kept small on purpose: each
// `threads.get` costs 40 Gmail quota units and the binding limit is per-USER —
// 6,000 units/min (~100/sec), NOT the much larger per-project quota shown in the
// Cloud console. A wide fan-out (we once used 25 → a 1,000-unit burst) blows past
// the per-user rate instantly and 429s; 5 keeps each burst near budget, and the
// backoff in `gmailGet` absorbs whatever pressure is left.
const METADATA_CONCURRENCY = 5
// Headers we read off each message (no body, so this stays a metadata fetch).
const HEADERS = ['From', 'To', 'Cc', 'Subject']
// Retry budget for a rate-limited / transient request before giving up on it.
const MAX_RETRIES = 5
// Base for the truncated exponential backoff (ms); capped at MAX_BACKOFF.
const BACKOFF_BASE = 500
const MAX_BACKOFF = 32_000
// Gmail signals a rate limit as either a 429 or a 403 with one of these reasons;
// both are transient and should be retried (vs. a 403 for missing scope, which
// is terminal — reconnect the account).
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'])

/** A person on a thread (you excluded), for the avatar stack and attribution. */
export interface ThreadParticipant {
  name: string
  email: string
}

/**
 * A Gmail thread normalized for the work-item engine. `messages` carries every
 * message's participants by role, chronological — attribution scans them in
 * order for the EARLIEST message containing a contact (a contact who joins on a
 * later reply still counts), which keeps the owning project stable as people
 * reply. `lastMessage*` drives the "have I replied" signal and the dismissal
 * watermark.
 */
export interface EmailThread {
  id: string
  account: string
  subject: string
  // Everyone but you, deduped across the whole thread — for the avatar stack.
  participants: ThreadParticipant[]
  // The most recent message's sender + time (epoch ms).
  lastMessageFrom: string
  lastMessageAt: number
  // True when you sent the latest message (i.e. you've already replied).
  lastMessageFromMe: boolean
  // Each message's participants by role (lowercased emails), oldest first — the
  // input to project attribution.
  messages: { from: string[]; to: string[]; cc: string[] }[]
  // Opens the thread in Gmail, targeted at the right account.
  url: string
}

/** The Gmail search query for the inbox feed (see {@link INBOX_QUERY}). No longer
 * derived from the allowlist — Polaris now pulls the whole Primary inbox and prunes
 * with the blocklist at read time — so this always returns the same query and the
 * caller always fetches once an account is linked. */
export function buildInboxQuery(): string {
  return INBOX_QUERY
}

interface RawHeader {
  name: string
  value: string
}
interface RawMessage {
  internalDate?: string
  payload?: { headers?: RawHeader[] }
}
interface RawThread {
  id: string
  messages?: RawMessage[]
}

function headerValue(message: RawMessage, name: string): string {
  const lower = name.toLowerCase()
  const found = message.payload?.headers?.find((h) => h.name.toLowerCase() === lower)
  return found?.value ?? ''
}

/**
 * Parse an address-list header ("Bob Smith" <bob@x.com>, other@y.com) into
 * participants. Splits on top-level commas (respecting quoted display names),
 * then pulls the `<email>` (or the bare token) out of each part. Tolerant by
 * design — getting the address right matters more than a perfect RFC parse.
 */
export function parseAddresses(header: string): ThreadParticipant[] {
  if (!header.trim()) return []
  const parts: string[] = []
  let buf = ''
  let inQuotes = false
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes
    if (ch === ',' && !inQuotes) {
      parts.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  parts.push(buf)

  const out: ThreadParticipant[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const angle = trimmed.match(/<([^>]+)>/)
    const email = (angle ? angle[1] : trimmed).trim().toLowerCase()
    if (!email.includes('@')) continue
    const rawName = angle ? trimmed.slice(0, angle.index).trim() : ''
    const name = rawName.replace(/^"|"$/g, '').trim()
    out.push({ name: name || email, email })
  }
  return out
}

function threadUrl(account: string, threadId: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${threadId}`
}

/** Normalize a fetched thread; null if it somehow has no datable messages. */
function mapThread(account: string, raw: RawThread, myAddresses: Set<string>): EmailThread | null {
  const sorted = (raw.messages ?? [])
    .map((message) => ({ message, at: Number(message.internalDate ?? 0) }))
    .sort((a, b) => a.at - b.at)
  if (sorted.length === 0) return null

  const first = sorted[0].message
  const last = sorted[sorted.length - 1]

  const emails = (header: string): string[] => parseAddresses(header).map((p) => p.email)

  // Participants: everyone across the thread except you, deduped by email, first
  // non-empty display name wins.
  const byEmail = new Map<string, ThreadParticipant>()
  for (const { message } of sorted) {
    for (const field of ['From', 'To', 'Cc']) {
      for (const person of parseAddresses(headerValue(message, field))) {
        if (myAddresses.has(person.email)) continue
        const existing = byEmail.get(person.email)
        if (!existing || (existing.name === existing.email && person.name !== person.email)) {
          byEmail.set(person.email, person)
        }
      }
    }
  }

  // Per-message roles, oldest first — what attribution scans for the earliest
  // matching contact.
  const messages = sorted.map(({ message }) => ({
    from: emails(headerValue(message, 'From')),
    to: emails(headerValue(message, 'To')),
    cc: emails(headerValue(message, 'Cc'))
  }))

  const lastFrom = emails(headerValue(last.message, 'From'))[0] ?? ''
  return {
    id: raw.id,
    account,
    subject: headerValue(first, 'Subject').trim() || '(no subject)',
    participants: [...byEmail.values()],
    lastMessageFrom: lastFrom,
    lastMessageAt: last.at,
    lastMessageFromMe: lastFrom !== '' && myAddresses.has(lastFrom),
    messages,
    url: threadUrl(account, raw.id)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The first error `reason` (or status) out of a Gmail error body, for telling a
 *  rate-limit 403 apart from a missing-scope 403. '' if the body isn't parseable. */
async function errorReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: { errors?: { reason?: string }[]; status?: string }
    }
    return body.error?.errors?.[0]?.reason ?? body.error?.status ?? ''
  } catch {
    return ''
  }
}

/** How long to wait before retrying: honor `Retry-After` if Gmail sent one, else
 *  truncated exponential backoff with jitter (Google's recommendation for
 *  time-based quota errors). */
function backoffDelay(attempt: number, res: Response): number {
  const retryAfter = Number(res.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000
  const jitter = Math.floor(Math.random() * 1000)
  return Math.min(2 ** attempt * BACKOFF_BASE + jitter, MAX_BACKOFF)
}

/**
 * GET a Gmail endpoint, with retry. The binding quota is per-user (6,000 units/
 * min), so under a wide fan-out a request can come back 429 (or 403
 * `userRateLimitExceeded`) even though the project quota is untouched. Rather than
 * fail the whole account on a transient rate limit, we retry those — and 5xx —
 * with truncated exponential backoff (honoring `Retry-After`). A non-rate 401/403
 * is terminal (reconnect needed); other errors throw after the retry budget.
 */
async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`${GMAIL_API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    } catch {
      throw new Error('Could not reach Gmail. Check your connection and try again.')
    }
    if (res.ok) return (await res.json()) as T

    // Rate limits arrive as 429, or as 403 with a rate-limit reason; both retry.
    const rateLimited =
      res.status === 429 || (res.status === 403 && RATE_LIMIT_REASONS.has(await errorReason(res)))

    // A 401/403 that isn't a rate limit means the grant is bad — reconnect.
    if ((res.status === 401 || res.status === 403) && !rateLimited) {
      throw new Error('Gmail access was rejected. Reconnect the account to grant email access.')
    }

    // Back off and retry transient failures (rate limits + 5xx) within budget.
    if ((rateLimited || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(backoffDelay(attempt, res))
      continue
    }

    throw new Error(`Gmail returned ${res.status}.`)
  }
}

/**
 * List one account's threads matching `query`, normalized. Pages through every
 * matching thread id (no silent cap — completeness is the whole point), then
 * fetches each thread's metadata in bounded-concurrency batches. Throws on an API
 * error so the caller can flag that account alone. `myAddresses` (your linked
 * account emails) is how a message is recognized as sent by you.
 */
export async function listThreadsForAccount(
  account: string,
  query: string,
  myAddresses: Set<string>
): Promise<EmailThread[]> {
  const accessToken = await getAccessToken(account)

  // Page through the full match set; terminates when Gmail returns no token.
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
    const page = await gmailGet<{ threads?: { id: string }[]; nextPageToken?: string }>(
      `/threads?q=${encodeURIComponent(query)}&maxResults=${PAGE_SIZE}${tokenParam}`,
      accessToken
    )
    for (const thread of page.threads ?? []) ids.push(thread.id)
    pageToken = page.nextPageToken
  } while (pageToken)

  // Fetch metadata in batches so a large result set can't fan out unbounded.
  const headerParams = HEADERS.map((h) => `metadataHeaders=${h}`).join('&')
  const out: EmailThread[] = []
  for (let i = 0; i < ids.length; i += METADATA_CONCURRENCY) {
    const raws = await Promise.all(
      ids
        .slice(i, i + METADATA_CONCURRENCY)
        .map((id) =>
          gmailGet<RawThread>(`/threads/${id}?format=metadata&${headerParams}`, accessToken)
        )
    )
    for (const raw of raws) {
      const mapped = mapThread(account, raw, myAddresses)
      if (mapped) out.push(mapped)
    }
  }
  return out
}
