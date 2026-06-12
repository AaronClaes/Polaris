import { IconRefresh, IconSettings } from '@tabler/icons-react'
import { useIsFetching } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { TagFilterButton } from '@/components/tag-filter'
import { Button } from '@/components/ui/button'
import { THEME_OPTIONS, toggleAppearance, useAppearance } from '@/lib/theme'
import { trpc } from '@/lib/trpc'

/**
 * Full-width draggable title bar (VS Code style). Shows the active project
 * centered, with global refresh, a light/dark toggle and settings on the right.
 * `drag-region` lets it move the window; the left padding clears the inset macOS
 * traffic lights (window uses
 * `titleBarStyle: 'hiddenInset'`); interactive controls opt out with `no-drag`.
 */
export function TopBar(): ReactElement {
  const params = useParams({ strict: false }) as { projectId?: string }
  // Raw (unfiltered) list on purpose: this is a by-id lookup for the title, not a
  // list of projects to show, so it must still resolve a project whose tag is
  // hidden (e.g. open when its tag was toggled off). Lists use useVisibleProjects.
  const projectsQuery = trpc.projects.list.useQuery()
  const active = params.projectId
    ? projectsQuery.data?.find((p) => String(p.id) === params.projectId)
    : undefined

  // Refresh re-fetches all GitHub data app-wide; invalidating the whole router
  // namespace covers every per-repo issues/PRs query (and accounts/repos). The
  // spinner tracks any in-flight github query.
  const utils = trpc.useUtils()
  const refreshing = useIsFetching({
    predicate: (query) => {
      const group = query.queryKey[0]
      return Array.isArray(group) && group[0] === 'github'
    }
  })

  const navigate = useNavigate()
  // A binary light/dark toggle (Auto lives in Settings): it shows the glyph for
  // the appearance on screen now — resolving `auto` to whatever the OS gives —
  // and a click flips to the opposite explicit mode.
  const appearance = useAppearance()
  const themeOption =
    THEME_OPTIONS.find((option) => option.value === appearance) ?? THEME_OPTIONS[0]
  const ThemeIcon = themeOption.Icon
  const nextLabel = appearance === 'dark' ? 'light' : 'dark'

  return (
    <header className="drag-region relative flex h-10 shrink-0 items-center justify-center border-border border-b bg-background pl-20">
      {active ? (
        <div className="flex items-center gap-2 text-sm">
          <ProjectIcon icon={active.icon} color={active.color} size={13} className="size-4.5" />
          <span className="font-medium">{active.name}</span>
        </div>
      ) : (
        <span className="font-medium text-muted-foreground text-sm">Polaris</span>
      )}
      <div className="no-drag absolute right-2 flex items-center gap-1">
        <TagFilterButton />
        <Button
          variant="outline"
          size="icon-sm"
          loading={refreshing > 0}
          aria-label="Refresh"
          title="Refresh"
          onClick={() => utils.github.invalidate()}
        >
          <IconRefresh />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Switch to ${nextLabel} theme`}
          title={`Switch to ${nextLabel} theme`}
          onClick={toggleAppearance}
        >
          <ThemeIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Settings"
          title="Settings"
          onClick={() => navigate({ to: '/settings' })}
        >
          <IconSettings />
        </Button>
      </div>
    </header>
  )
}
