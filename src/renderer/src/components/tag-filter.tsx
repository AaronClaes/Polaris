import { IconTag } from '@tabler/icons-react'
import { type ReactElement, useState } from 'react'
import { TagDot } from '@/components/tag-select'
import { Button } from '@/components/ui/button'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { trpc } from '@/lib/trpc'
import { useTagFilterStore } from '@/stores/tag-filter-store'

/**
 * Header control to turn project tags on and off. Turning a tag off hides every
 * project carrying it — and all that project's data — across the whole app (see
 * useVisibleProjects). The on/off state is persisted (tag-filter-store), so the
 * chosen focus survives a restart. Renders nothing until at least one tag exists,
 * keeping the header clean for anyone not using tags.
 */
export function TagFilterButton(): ReactElement | null {
  const [open, setOpen] = useState(false)
  const tags = trpc.tags.list.useQuery().data ?? []
  const disabledTagIds = useTagFilterStore((state) => state.disabledTagIds)
  const setEnabled = useTagFilterStore((state) => state.setEnabled)

  if (tags.length === 0) return null

  // Mark the button when any tag is hidden, so active filtering is visible at a glance.
  const filtering = tags.some((tag) => disabledTagIds.includes(tag.id))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon-sm" aria-label="Filter by tag" title="Filter by tag">
            <span className="relative inline-flex">
              <IconTag />
              {filtering && (
                <span className="-right-1 -top-1 absolute size-2 rounded-full bg-primary ring-2 ring-background" />
              )}
            </span>
          </Button>
        }
      />
      <PopoverPopup align="end" className="w-60">
        <div className="grid gap-0.5">
          <p className="px-1 pb-1 font-medium text-muted-foreground text-xs">
            Show projects tagged
          </p>
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <TagDot color={tag.color} />
                <span className="truncate">{tag.label}</span>
              </span>
              <Switch
                checked={!disabledTagIds.includes(tag.id)}
                onCheckedChange={(checked) => setEnabled(tag.id, checked)}
                aria-label={tag.label}
              />
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  )
}
