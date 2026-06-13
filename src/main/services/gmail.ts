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
// Only consider mail from the last 30 days — a command center cares about live
// threads, not history (matches the agreed window).
const WINDOW = 'newer_than:30d'
// Cap matching threads per account so a busy mailbox can't fan out unbounded;
// fetched newest-first, so this keeps the most recent.
const MAX_THREADS = 50
// Headers we read off each message (no body, so this stays a metadata fetch).
const HEADERS = ['From', 'To', 'Cc', 'Subject']

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

/** Build the Gmail search query from the allowlist: any thread where a contact
 * appears as From, To, or Cc, within the recency window. A full address matches
 * exactly; a wildcard (`@clientA.com`) matches its whole domain. Returns null when
 * there are no patterns, so the caller skips the fetch entirely. */
export function buildSearchQuery(patterns: string[]): string | null {
  if (patterns.length === 0) return null
  const terms = patterns.map((pattern) => {
    // `@clientA.com` → the bare domain (Gmail matches the domain); a full address
    // is used as-is. Quote to keep the tokenizer from splitting on punctuation.
    const value = pattern.startsWith('@') ? pattern.slice(1) : pattern
    return `(from:${value} OR to:${value} OR cc:${value})`
  })
  return `${WINDOW} (${terms.join(' OR ')})`
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

async function gmailGet<T>(path: string, accessToken: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
  } catch {
    throw new Error('Could not reach Gmail. Check your connection and try again.')
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Gmail access was rejected. Reconnect the account to grant email access.')
  }
  if (!res.ok) throw new Error(`Gmail returned ${res.status}.`)
  return (await res.json()) as T
}

/**
 * List one account's threads matching `query`, normalized. Fetches the matching
 * thread ids (one page, capped), then each thread's metadata in parallel. Throws
 * on an API error so the caller can flag that account alone. `myAddresses` (your
 * linked account emails) is how a message is recognized as sent by you.
 */
export async function listThreadsForAccount(
  account: string,
  query: string,
  myAddresses: Set<string>
): Promise<EmailThread[]> {
  const accessToken = await getAccessToken(account)

  const list = await gmailGet<{ threads?: { id: string }[] }>(
    `/threads?q=${encodeURIComponent(query)}&maxResults=${MAX_THREADS}`,
    accessToken
  )
  const ids = (list.threads ?? []).map((thread) => thread.id)

  const headerParams = HEADERS.map((h) => `metadataHeaders=${h}`).join('&')
  const threads = await Promise.all(
    ids.map((id) =>
      gmailGet<RawThread>(`/threads/${id}?format=metadata&${headerParams}`, accessToken)
    )
  )

  const out: EmailThread[] = []
  for (const raw of threads) {
    const mapped = mapThread(account, raw, myAddresses)
    if (mapped) out.push(mapped)
  }
  return out
}
