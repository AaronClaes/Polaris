import { IconChevronDown, IconCopy } from '@tabler/icons-react'
import { type ReactElement, useMemo, useState } from 'react'
import { ACTION_ICON_CLASS, ActionIcon } from '@/components/action-icon'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { getIcon } from '@/lib/icons'
import type { ActionGroupRow, ProjectActionRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import type { LinkActionConfig, RepoActionConfig } from '../../../main/db/schema'

interface GroupLauncherProps {
  group: ActionGroupRow
  /** The group's member actions (already filtered to this group). */
  actions: ProjectActionRow[]
  /** Bubble a run error (or null to clear) up to the surrounding surface. */
  onError?: (message: string | null) => void
  className?: string
}

/** Summarize a partial-failure run for a short inline message. */
function summarize(results: { label: string; ok: boolean }[]): string {
  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) return ''
  return `${failed.length} of ${results.length} failed: ${failed.map((r) => r.label).join(', ')}`
}

/**
 * Split-button launcher for an action group: a primary button runs the whole
 * group at once, and the adjacent menu launches members individually.
 */
export function GroupLauncher({
  group,
  actions,
  onError,
  className
}: GroupLauncherProps): ReactElement {
  const GroupIcon = useMemo(() => getIcon(group.icon).Icon, [group.icon])

  const runGroup = trpc.groups.run.useMutation({
    onSuccess: (res) => onError?.(res.ok ? null : summarize(res.results)),
    onError: (error) => onError?.(error.message)
  })
  const runAction = trpc.actions.run.useMutation({
    onSuccess: (res) => onError?.(res.ok ? null : (res.error ?? 'Action failed')),
    onError: (error) => onError?.(error.message)
  })
  // Controlled so the copy button can close the menu itself — it stops the
  // click from reaching the item (which would otherwise run the action), so the
  // item's own close-on-click never fires.
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={cn('inline-flex', className)}>
      <Button
        variant="outline"
        size="sm"
        className="rounded-r-none before:rounded-r-none"
        loading={runGroup.isPending}
        onClick={() => runGroup.mutate({ groupId: group.id })}
      >
        <GroupIcon />
        {group.name}
      </Button>
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="-ml-px rounded-l-none before:rounded-l-none"
              aria-label={`${group.name} actions`}
              title={`${group.name} actions`}
            />
          }
        >
          <IconChevronDown />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          {actions.length === 0 ? (
            <MenuItem disabled>No actions in this group</MenuItem>
          ) : (
            actions.map((action) => (
              <MenuItem key={action.id} onClick={() => runAction.mutate({ id: action.id })}>
                <ActionIcon action={action} className={ACTION_ICON_CLASS} />
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {(action.type === 'link' || action.type === 'repo') && (
                  <button
                    type="button"
                    // Secondary action inside a menu item: stop the click so it
                    // neither runs the action nor closes the menu. tabIndex -1
                    // keeps it out of the menu's arrow/Tab focus management.
                    tabIndex={-1}
                    aria-label={`Copy URL for ${action.label}`}
                    title="Copy URL"
                    className="-me-1 ms-4 inline-flex size-6 shrink-0 items-center justify-center rounded-sm opacity-70 transition hover:bg-foreground/10 hover:opacity-100 [&>svg]:size-4"
                    onClick={(event) => {
                      event.stopPropagation()
                      const { url } = action.config as LinkActionConfig | RepoActionConfig
                      navigator.clipboard.writeText(url).catch(() => {})
                      setMenuOpen(false)
                    }}
                  >
                    <IconCopy />
                  </button>
                )}
              </MenuItem>
            ))
          )}
        </MenuPopup>
      </Menu>
    </div>
  )
}
