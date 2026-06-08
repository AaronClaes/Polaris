import { IconCopy } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { ACTION_ICON_CLASS, ActionIcon } from '@/components/action-icon'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import type { ProjectActionRow } from '@/lib/project-types'
import type { LinkActionConfig } from '../../../main/db/schema'

/**
 * A loose action's launch button, shared by the dashboard card and the project
 * header. Left-click runs the action; a link action additionally gets a
 * right-click context menu to copy its URL. Grouped actions launch from the
 * group's split-button instead, so they don't pass through here.
 */
export function ActionLaunchButton({
  action,
  loading,
  onRun
}: {
  action: ProjectActionRow
  loading: boolean
  onRun: () => void
}): ReactElement {
  const content = (
    <>
      <ActionIcon action={action} className={ACTION_ICON_CLASS} />
      {action.label}
    </>
  )

  if (action.type !== 'link') {
    return (
      <Button variant="outline" size="sm" loading={loading} onClick={onRun}>
        {content}
      </Button>
    )
  }

  const { url } = action.config as LinkActionConfig
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<Button variant="outline" size="sm" loading={loading} onClick={onRun} />}
      >
        {content}
      </ContextMenuTrigger>
      <ContextMenuPopup>
        <ContextMenuItem
          onClick={() => {
            navigator.clipboard.writeText(url).catch(() => {})
          }}
        >
          <IconCopy />
          Copy URL
        </ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  )
}
