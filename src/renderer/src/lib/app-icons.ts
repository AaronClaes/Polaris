/** Sentinel `icon` value meaning "use the resolved app's icon". Only valid for
 *  terminal / IDE actions, where it tracks whichever default app is set; every
 *  other action stores a Tabler icon key (see `icons.ts`) or {@link FAVICON_ICON_KEY}. */
export const APP_ICON_KEY = 'app-icon'

/** App icons effectively never change, so cache aggressively; the resolved data
 *  URL is also persisted (see the query persistence allowlist) across restarts. */
export const APP_ICON_STALE_TIME = 1000 * 60 * 60 * 24
