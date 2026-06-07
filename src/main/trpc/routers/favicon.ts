import { z } from 'zod'
import { resolveFavicon } from '../../services/favicon'
import { publicProcedure, router } from '..'

export const faviconRouter = router({
  /**
   * Resolve a page URL's favicon as a data URL (null if none found). Mirrors the
   * browser — reads the site's declared `<link rel=icon>`, falls back to
   * `/favicon.ico` — and runs in the main process to avoid CORS. The renderer
   * caches the result (long stale time + persisted), so each host is fetched once.
   */
  get: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .query(async ({ input }) => resolveFavicon(input.url))
})
