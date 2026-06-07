import { IconWorld } from '@tabler/icons-react'
import type { ReactElement } from 'react'
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
 * An action's leading glyph: the linked site's favicon for favicon-mode link
 * actions (globe fallback), otherwise the chosen Tabler icon. Pass `size` for a
 * fixed pixel size, or a sizing `className` (e.g. {@link ACTION_ICON_CLASS}) for
 * CSS-sized contexts like buttons and menus.
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
  const Icon = getIcon(action.icon).Icon
  return <Icon size={size} className={className} />
}
