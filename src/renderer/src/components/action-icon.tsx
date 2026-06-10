import { IconApps, IconCode, IconTerminal2, IconWorld, type TablerIcon } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { APP_ICON_KEY, APP_ICON_STALE_TIME } from '@/lib/app-icons'
import { FAVICON_ICON_KEY, FAVICON_STALE_TIME, faviconQueryUrl } from '@/lib/favicon'
import { getIcon } from '@/lib/icons'
import type { ProjectActionRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import type { LinkActionConfig } from '../../../main/db/schema'

/** Sizing for action icons inside buttons/menus, mirroring the `[&_svg]` rules
 *  so a favicon <img> tracks the same responsive size as a Tabler glyph. */
export const ACTION_ICON_CLASS = 'size-4.5 sm:size-4'

/**
 * A site favicon as an <img>, resolved by the main process (it reads the page's
 * declared `<link rel=icon>`, like a browser) and returned as a data URL. Falls
 * back to a globe while loading or when no icon is found. The query is cached
 * and persisted, so a given host is fetched once.
 */
export function FaviconImg({
  url,
  size,
  className
}: {
  url: string | null | undefined
  size?: number
  className?: string
}): ReactElement {
  const queryUrl = faviconQueryUrl(url)
  const { data } = trpc.favicon.get.useQuery(
    { url: queryUrl ?? '' },
    { enabled: queryUrl !== null, staleTime: FAVICON_STALE_TIME }
  )
  if (!data?.dataUrl) return <IconWorld size={size} className={className} />
  return (
    <img
      src={data.dataUrl}
      alt=""
      width={size}
      height={size}
      className={cn('rounded-[3px] object-contain', className)}
    />
  )
}

/**
 * A macOS app icon as an <img>, resolved by the main process from the app's
 * `.app` bundle and returned as a data URL. Falls back to `Fallback` while
 * loading or when the app isn't installed. The query is cached and persisted,
 * so a given app is fetched once. `appKey` is a default-apps registry key; pass
 * `undefined` (e.g. while the default-apps query loads) to show the fallback.
 */
export function AppIconImg({
  appKey,
  size,
  className,
  Fallback = IconApps
}: {
  appKey: string | undefined
  size?: number
  className?: string
  Fallback?: TablerIcon
}): ReactElement {
  const { data } = trpc.settings.appIcon.useQuery(
    { key: appKey ?? '' },
    { enabled: appKey != null && appKey.length > 0, staleTime: APP_ICON_STALE_TIME }
  )
  if (!data?.dataUrl) return <Fallback size={size} className={className} />
  return (
    <img
      src={data.dataUrl}
      alt=""
      width={size}
      height={size}
      className={cn('rounded-[3px] object-contain', className)}
    />
  )
}

/** The icon of the current default terminal / IDE — used by a terminal / IDE
 *  action whose icon tracks the resolved app (see {@link APP_ICON_KEY}). It
 *  reads the default-apps setting, so it updates if the default app changes. */
function ActionAppIcon({
  kind,
  size,
  className
}: {
  kind: 'terminal' | 'ide'
  size?: number
  className?: string
}): ReactElement {
  const { data } = trpc.settings.defaultApps.useQuery()
  const appKey = data ? (kind === 'terminal' ? data.terminal : data.ide) : undefined
  return (
    <AppIconImg
      appKey={appKey}
      size={size}
      className={className}
      Fallback={kind === 'terminal' ? IconTerminal2 : IconCode}
    />
  )
}

/**
 * An action's leading glyph: the linked site's favicon for favicon-mode link
 * actions (globe fallback), the default app's icon for app-icon-mode terminal /
 * IDE actions, otherwise the chosen Tabler icon. Pass `size` for a fixed pixel
 * size, or a sizing `className` (e.g. {@link ACTION_ICON_CLASS}) for CSS-sized
 * contexts like buttons and menus.
 */
export function ActionIcon({
  action,
  size,
  className
}: {
  action: Pick<ProjectActionRow, 'type' | 'icon' | 'config'>
  size?: number
  className?: string
}): ReactElement {
  if (action.type === 'link' && action.icon === FAVICON_ICON_KEY) {
    return (
      <FaviconImg url={(action.config as LinkActionConfig).url} size={size} className={className} />
    )
  }
  if ((action.type === 'terminal' || action.type === 'ide') && action.icon === APP_ICON_KEY) {
    return <ActionAppIcon kind={action.type} size={size} className={className} />
  }
  const Icon = getIcon(action.icon).Icon
  return <Icon size={size} className={className} />
}
