/** Sentinel `icon` value meaning "use the linked site's favicon". Only valid
 *  for link actions; everything else stores a Tabler icon key (see `icons.ts`). */
export const FAVICON_ICON_KEY = 'favicon'

/** Favicons rarely change, so cache aggressively; the resolved data URL is also
 *  persisted (see the query persistence allowlist) to survive app restarts. */
export const FAVICON_STALE_TIME = 1000 * 60 * 60 * 24

/**
 * The http(s) URL to ask the main process to resolve a favicon for, or null if
 * the input isn't usable yet (e.g. while still typing). A bare domain is
 * promoted to https so the live picker preview works before a scheme is typed.
 */
export function faviconQueryUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
    } catch {
      // try the next candidate
    }
  }
  return null
}
