/** Sentinel `icon` value meaning "use the resolved app's icon". Only valid for
 *  terminal / IDE / Finder actions: it tracks whichever default app is set
 *  (terminal / IDE) or is always Finder; every other action stores a Tabler icon
 *  key (see `icons.ts`) or {@link FAVICON_ICON_KEY}. */
export const APP_ICON_KEY = 'app-icon'

/** Registry key for macOS Finder's icon, resolved via the same app-icon query as
 *  the terminal / IDE. Mirrors the main process's `FINDER_APP.key`. */
export const FINDER_APP_KEY = 'finder'

/** App icons effectively never change, so cache aggressively; the resolved data
 *  URL is also persisted (see the query persistence allowlist) across restarts. */
export const APP_ICON_STALE_TIME = 1000 * 60 * 60 * 24
