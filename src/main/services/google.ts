import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { deleteSecret, getSecret, setSecret } from './secrets'

/**
 * Google auth + Calendar service. Holds one OAuth grant per linked Google
 * account, keyed by email in the secrets store; tokens never leave the main
 * process (the renderer only ever sees account metadata + normalized events).
 *
 * Auth is the OAuth 2.0 "loopback" flow for native apps: we spin up a throwaway
 * HTTP server on 127.0.0.1, open the system browser to Google's consent screen
 * (with PKCE), and catch the redirect to read the authorization code. The client
 * secret isn't truly confidential for a desktop app — PKCE is what secures the
 * exchange — but it still stays out of git (see `.env.example`). Uses the global
 * `fetch` and Node built-ins only; no SDK, mirroring the GitHub service.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

// openid/email/profile identify the account; calendar.readonly is the only data
// scope (a "sensitive", not "restricted", scope — the gentler verification bar).
const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.readonly'
]

const TOKENS_PREFIX = 'google:tokens:'
// Refresh a little before the access token actually lapses to avoid races.
const EXPIRY_BUFFER_MS = 60_000
// Abandon a sign-in the user never completes rather than leaking a server.
const AUTH_TIMEOUT_MS = 5 * 60 * 1000

/** The client credentials from the gitignored `.env` (see `.env.example`).
 *  Throws a setup-facing message when unset so the UI can prompt for config. */
function oauthConfig(): { clientId: string; clientSecret: string } {
  const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
  const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth is not configured. Set MAIN_VITE_GOOGLE_CLIENT_ID and MAIN_VITE_GOOGLE_CLIENT_SECRET in your .env (see .env.example).'
    )
  }
  return { clientId, clientSecret }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function challengeOf(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/** The authenticated account behind a grant (OpenID userinfo). */
export interface GoogleProfile {
  email: string
  name: string | null
  picture: string | null
}

interface StoredTokens {
  refreshToken: string
  accessToken: string
  // Epoch ms when the access token expires.
  expiresAt: number
}

function storeTokens(email: string, tokens: StoredTokens): void {
  setSecret(`${TOKENS_PREFIX}${email}`, JSON.stringify(tokens))
}

function readTokens(email: string): StoredTokens | null {
  const raw = getSecret(`${TOKENS_PREFIX}${email}`)
  return raw ? (JSON.parse(raw) as StoredTokens) : null
}

export function deleteTokens(email: string): void {
  deleteSecret(`${TOKENS_PREFIX}${email}`)
}

/** A tiny page shown in the browser tab after the redirect lands. */
function resultPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Polaris</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0c;color:#e6e6e6;display:grid;
place-items:center;height:100vh;margin:0}main{text-align:center}</style></head>
<body><main><h1>Polaris</h1><p>${message}</p></main></body></html>`
}

/**
 * Run the loopback consent flow: listen on an ephemeral 127.0.0.1 port, open the
 * system browser to Google's consent screen, and resolve with the authorization
 * code once the redirect lands. Rejects on denial, a state mismatch, or timeout.
 */
function captureAuthCode(
  clientId: string,
  challenge: string,
  state: string
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    let redirectUri = ''
    let settled = false

    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      action()
    }

    const timer = setTimeout(
      () => finish(() => reject(new Error('Timed out waiting for Google sign-in.'))),
      AUTH_TIMEOUT_MS
    )

    server.on('request', (req, res) => {
      const params = new URL(req.url ?? '/', redirectUri).searchParams
      // Ignore noise (e.g. a favicon request) until the real callback arrives.
      if (!params.has('code') && !params.has('error')) {
        res.writeHead(404).end()
        return
      }
      const respond = (message: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(resultPage(message))
      }
      if (params.get('error')) {
        respond('Sign-in was cancelled. You can close this tab.')
        finish(() => reject(new Error('Google sign-in was cancelled.')))
        return
      }
      if (params.get('state') !== state) {
        respond('Sign-in failed. You can close this tab.')
        finish(() => reject(new Error('Google sign-in failed: state mismatch.')))
        return
      }
      const code = params.get('code')
      if (!code) {
        respond('Sign-in failed. You can close this tab.')
        finish(() => reject(new Error('Google sign-in failed: no authorization code.')))
        return
      }
      respond('Connected. You can close this tab and return to Polaris.')
      finish(() => resolve({ code, redirectUri }))
    })

    server.on('error', (err) => finish(() => reject(err)))

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      redirectUri = `http://127.0.0.1:${port}`
      const authUrl = new URL(AUTH_ENDPOINT)
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        // offline + consent guarantee a refresh token, even on re-link.
        access_type: 'offline',
        prompt: 'consent',
        state
      }).toString()
      shell.openExternal(authUrl.toString())
    })
  })
}

/** Exchange the authorization code (+ PKCE verifier) for tokens. */
async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<StoredTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  })
  if (!res.ok) {
    throw new Error(`Google rejected the sign-in (${res.status}).`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove Polaris from your Google account access, then reconnect.'
    )
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  }
}

async function fetchUserInfo(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) throw new Error(`Could not read your Google profile (${res.status}).`)
  const data = (await res.json()) as { email: string; name?: string; picture?: string }
  return { email: data.email, name: data.name ?? null, picture: data.picture ?? null }
}

/**
 * Link a Google account end to end: run the consent flow, exchange the code,
 * read the profile, and persist the tokens (keyed by email). Returns the profile
 * so the caller can upsert the account row. A throw means "nothing was stored".
 */
export async function connectGoogleAccount(): Promise<GoogleProfile> {
  const { clientId, clientSecret } = oauthConfig()
  const verifier = base64url(randomBytes(48))
  const challenge = challengeOf(verifier)
  const state = base64url(randomBytes(16))

  const { code, redirectUri } = await captureAuthCode(clientId, challenge, state)
  const tokens = await exchangeCode(clientId, clientSecret, code, verifier, redirectUri)
  const profile = await fetchUserInfo(tokens.accessToken)
  storeTokens(profile.email, tokens)
  return profile
}

/**
 * A valid access token for an account, refreshing via the stored refresh token
 * when the cached one has (nearly) expired. Throws when the account isn't linked
 * or the refresh token was revoked — the caller surfaces that per-account.
 */
async function getAccessToken(email: string): Promise<string> {
  const tokens = readTokens(email)
  if (!tokens) throw new Error(`No stored Google credentials for ${email}.`)
  if (tokens.expiresAt - EXPIRY_BUFFER_MS > Date.now()) return tokens.accessToken

  const { clientId, clientSecret } = oauthConfig()
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token'
    })
  })
  if (!res.ok) {
    // 400 invalid_grant → the grant was revoked or (in testing mode) expired.
    throw new Error('Google sign-in expired. Reconnect the account in Settings.')
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  const refreshed: StoredTokens = {
    refreshToken: tokens.refreshToken,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  }
  storeTokens(email, refreshed)
  return refreshed.accessToken
}

/** An event participant (everyone but you, minus anyone who declined and any
 *  rooms/resources). The Calendar API exposes no profile photos, so the renderer
 *  shows initials; `email` is the stable identity (and lets a later domain→project
 *  map scope the meeting by attendee domain without touching this service). */
export interface CalendarAttendee {
  name: string
  email: string
}

/** A calendar event normalized for the renderer. `allDay` events have a date-only
 *  start (local midnight). */
export interface CalendarEvent {
  id: string
  // The linked account this event came from (its calendar can span accounts).
  account: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  location: string | null
  // A Google Meet link when the event has one, else null.
  hangoutLink: string | null
  // The event's page on Google Calendar, for opening out.
  htmlLink: string
  // Other participants (you excluded), for the avatar stack.
  attendees: CalendarAttendee[]
}

interface RawAttendee {
  email?: string
  displayName?: string
  self?: boolean
  responseStatus?: string
  // A meeting room / resource, not a person — kept out of the participant list.
  resource?: boolean
}

interface RawEvent {
  id: string
  status?: string
  summary?: string
  htmlLink?: string
  hangoutLink?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: RawAttendee[]
}

function mapEvent(account: string, raw: RawEvent): CalendarEvent | null {
  const startRaw = raw.start?.dateTime ?? raw.start?.date
  const endRaw = raw.end?.dateTime ?? raw.end?.date
  if (!startRaw || !endRaw) return null

  // A timed event has `dateTime`; an all-day event has date-only `date`
  // ("YYYY-MM-DD"), which we pin to local midnight so it lands on the right day.
  const allDay = !raw.start?.dateTime
  const start = allDay ? new Date(`${startRaw}T00:00:00`) : new Date(startRaw)
  const end = allDay ? new Date(`${endRaw}T00:00:00`) : new Date(endRaw)

  // Participants: everyone but you, dropping anyone who declined and any
  // rooms/resources. Fall back to the email when there's no display name.
  const attendees: CalendarAttendee[] = []
  for (const attendee of raw.attendees ?? []) {
    if (attendee.self || attendee.resource) continue
    if (attendee.responseStatus === 'declined') continue
    if (!attendee.email) continue
    attendees.push({ name: attendee.displayName?.trim() || attendee.email, email: attendee.email })
  }

  return {
    id: raw.id,
    account,
    title: raw.summary?.trim() || '(no title)',
    start,
    end,
    allDay,
    location: raw.location?.trim() || null,
    hangoutLink: raw.hangoutLink ?? null,
    htmlLink: raw.htmlLink ?? '',
    attendees
  }
}

/**
 * List one account's primary-calendar events in [timeMin, timeMax), expanding
 * recurring events to instances and skipping cancelled events and ones you've
 * declined. A 2-day agenda window stays well under one page, so we don't
 * paginate. Throws on an API error so the caller can flag that account alone.
 */
export async function listAgendaEvents(
  email: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalendarEvent[]> {
  const accessToken = await getAccessToken(email)
  const url = new URL(`${CALENDAR_API}/calendars/primary/events`)
  url.search = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100'
  }).toString()

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Google Calendar returned ${res.status}.`)
  const data = (await res.json()) as { items?: RawEvent[] }

  const events: CalendarEvent[] = []
  for (const raw of data.items ?? []) {
    if (raw.status === 'cancelled') continue
    // Hide events you've declined — they're not on your agenda.
    const self = raw.attendees?.find((attendee) => attendee.self)
    if (self?.responseStatus === 'declined') continue
    const mapped = mapEvent(email, raw)
    if (mapped) events.push(mapped)
  }
  return events
}
