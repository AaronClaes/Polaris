import { IconChevronDown } from '@tabler/icons-react'
import { type ReactElement, useMemo } from 'react'
import { ACTION_ICON_CLASS, ActionIcon } from '@/components/action-icon'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { getIcon } from '@/lib/icons'
import type { ActionGroupRow, ProjectActionRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

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

  return (
    <div className={cn('inline-flex', className)}>
      <Button
        variant="outline"
        size="sm"
        className="rounded-r-none"
        loading={runGroup.isPending}
        onClick={() => runGroup.mutate({ groupId: group.id })}
      >
        <GroupIcon />
        {group.name}
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="-ml-px rounded-l-none"
              aria-label={`${group.name} actions`}
              title={`${group.name} actions`}
            />
          }
        >
          <IconChevronDown />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          {actions.length === 0 ? (
            <MenuItem disabled>All actions are hidden</MenuItem>
          ) : (
            actions.map((action) => (
              <MenuItem key={action.id} onClick={() => runAction.mutate({ id: action.id })}>
                <ActionIcon action={action} className={ACTION_ICON_CLASS} />
                {action.label}
              </MenuItem>
            ))
          )}
        </MenuPopup>
      </Menu>
    </div>
  )
}
