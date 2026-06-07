/**
 * Favicon resolver. Mirrors what a browser does: fetch the page, read its
 * declared `<link rel="icon">` (preferring SVG, then the largest raster, then
 * apple-touch-icon), and fall back to `/favicon.ico`. The chosen icon is
 * returned as a data URL, so the renderer shows it under a tight CSP (`data:`
 * is already allowed) and caches it like any other query. Runs in the main
 * process to dodge CORS — third-party services (Google, DuckDuckGo) only know
 * sites they've crawled and 404 on preview/self-hosted domains.
 */

const PAGE_TIMEOUT_MS = 6000
const ICON_TIMEOUT_MS = 6000
const MAX_ICON_BYTES = 512 * 1024
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Polaris Safari/537.36'

// host → resolved data URL (or null = looked up, none found). Dedupes lookups
// within a session; the renderer's persisted query cache covers across launches.
const cache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

/** Resolve a page URL's favicon as a data URL, or null if none can be found. */
export async function resolveFavicon(pageUrl: string): Promise<{ dataUrl: string } | null> {
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const key = parsed.host.toLowerCase()
  if (cache.has(key)) {
    const hit = cache.get(key) ?? null
    return hit ? { dataUrl: hit } : null
  }
  const pending = inflight.get(key)
  if (pending) {
    const shared = await pending
    return shared ? { dataUrl: shared } : null
  }

  const job = resolve(parsed).catch(() => null)
  inflight.set(key, job)
  const result = await job
  inflight.delete(key)
  cache.set(key, result)
  return result ? { dataUrl: result } : null
}

async function resolve(pageUrl: URL): Promise<string | null> {
  for (const candidate of await discoverCandidates(pageUrl)) {
    const dataUrl = await fetchIcon(candidate)
    if (dataUrl) return dataUrl
  }
  return null
}

/** Ordered icon URLs to try: the page's declared `<link rel=icon>` (best
 *  first), then web-app-manifest icons (the only source on some PWAs), then the
 *  conventional `/favicon.ico` at the origin. */
async function discoverCandidates(pageUrl: URL): Promise<string[]> {
  const urls: string[] = []
  try {
    const res = await fetch(pageUrl.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    })
    if (res.ok) {
      const base = new URL(res.url || pageUrl.toString())
      const html = await res.text()
      const push = (href: string, relativeTo: URL): void => {
        try {
          urls.push(new URL(href, relativeTo).toString())
        } catch {
          // skip an unparseable href
        }
      }
      for (const href of parseIconHrefs(html)) push(href, base)
      const manifestHref = findManifestHref(html)
      if (manifestHref) {
        try {
          for (const href of await manifestIconHrefs(new URL(manifestHref, base))) push(href, base)
        } catch {
          // skip an unreachable/invalid manifest
        }
      }
    }
  } catch {
    // network/timeout — fall through to the conventional path
  }
  urls.push(new URL('/favicon.ico', pageUrl.origin).toString())
  return [...new Set(urls)] // de-dupe, preserve order
}

/** The `<link rel="manifest">` href in the page head, if any. */
function findManifestHref(html: string): string | undefined {
  const headEnd = html.search(/<\/head>/i)
  const scope = headEnd >= 0 ? html.slice(0, headEnd) : html
  for (const tag of scope.match(/<link\b[^>]*>/gi) ?? []) {
    if (attr(tag, 'rel')?.toLowerCase().includes('manifest')) return attr(tag, 'href')
  }
  return undefined
}

/** Absolute icon URLs from a web app manifest's `icons`, best-first. */
async function manifestIconHrefs(manifestUrl: URL): Promise<string[]> {
  const res = await fetch(manifestUrl.toString(), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/manifest+json,application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
  })
  if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().includes('json')) return []
  const manifest = (await res.json()) as {
    icons?: { src?: string; sizes?: string; type?: string }[]
  }
  if (!Array.isArray(manifest.icons)) return []
  return manifest.icons
    .filter((icon): icon is { src: string; sizes?: string; type?: string } => !!icon.src)
    .map((icon) => ({
      src: icon.src,
      rank: icon.type?.includes('svg') ? 100_000 : maxSize((icon.sizes ?? '').toLowerCase())
    }))
    .sort((a, b) => b.rank - a.rank)
    .map((icon) => icon.src)
}

/** Pull icon `<link>` hrefs out of raw HTML, best-first (svg > big raster >
 *  apple-touch-icon > unspecified). DOM-free; a regex is enough here. */
function parseIconHrefs(html: string): string[] {
  const headEnd = html.search(/<\/head>/i)
  const scope = headEnd >= 0 ? html.slice(0, headEnd) : html
  const links: { href: string; rank: number }[] = []
  for (const tag of scope.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase()
    if (!rel?.includes('icon')) continue
    const href = attr(tag, 'href')
    if (!href) continue
    const type = attr(tag, 'type')?.toLowerCase() ?? ''
    const size = maxSize(attr(tag, 'sizes')?.toLowerCase() ?? '')
    const isSvg = type.includes('svg') || /\.svg(\?|#|$)/.test(href)
    // Higher rank wins. SVG is scalable → best; apple-touch icons are large
    // PNGs that default to ~180px when unsized.
    const rank = isSvg ? 100_000 : rel.includes('apple-touch') && size === 0 ? 180 : size
    links.push({ href, rank })
  }
  links.sort((a, b) => b.rank - a.rank)
  return links.map((link) => link.href)
}

/** Largest dimension declared in a `sizes` attribute (0 if none / "any"). */
function maxSize(sizes: string): number {
  if (!sizes || sizes === 'any') return 0
  let max = 0
  for (const token of sizes.split(/\s+/)) {
    const match = token.match(/(\d+)x(\d+)/)
    if (match) max = Math.max(max, Number(match[1]), Number(match[2]))
  }
  return max
}

/** Read an HTML attribute value (double-, single-, or unquoted) from a tag. */
function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))
  return match ? (match[2] ?? match[3] ?? match[4]) : undefined
}

/** Fetch one icon URL and return a data URL, or null if it isn't an image. */
async function fetchIcon(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_ICON_BYTES) return null
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const mime = imageMime(contentType, buf)
    return mime ? `data:${mime};base64,${buf.toString('base64')}` : null
  } catch {
    return null
  }
}

/** Confirm bytes are an image by sniffing magic numbers — content-type alone
 *  lies (SPA fallbacks return HTML, sometimes with an image content-type). */
function imageMime(contentType: string, buf: Buffer): string | null {
  if (isSvg(buf)) return 'image/svg+xml'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00)
    return 'image/x-icon'
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  // Couldn't sniff but the server claims an image (and not HTML) — trust it.
  if (contentType.startsWith('image/') && !contentType.includes('html')) return contentType
  return null
}

function isSvg(buf: Buffer): boolean {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 256)).trimStart().toLowerCase()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}
