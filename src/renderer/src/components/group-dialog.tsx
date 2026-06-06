import { IconFolderPlus } from '@tabler/icons-react'
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react'
import { IconPicker } from '@/components/icon-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_GROUP_ICON_KEY } from '@/lib/icons'
import type { ActionGroupRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

interface GroupDialogProps {
  projectId: number
  /** When provided, the dialog edits this group instead of creating one. */
  group?: ActionGroupRow
  /** Controlled open state. When provided, no trigger is rendered. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Trigger element (uncontrolled mode only); defaults to a "New group" button. */
  trigger?: ReactElement
}

/** Dialog + form to create or edit an action group (name + icon). */
export function GroupDialog({
  projectId,
  group,
  open: openProp,
  onOpenChange,
  trigger
}: GroupDialogProps): ReactElement {
  const isEdit = group != null
  const isControlled = openProp !== undefined
  const utils = trpc.useUtils()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  const setOpen = (next: boolean): void => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  const [name, setName] = useState(group?.name ?? '')
  const [icon, setIcon] = useState(group?.icon ?? DEFAULT_GROUP_ICON_KEY)
  const nameId = useId()

  // Seed the form from the group (or empty) each time the dialog opens.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(group?.name ?? '')
      setIcon(group?.icon ?? DEFAULT_GROUP_ICON_KEY)
    }
    wasOpen.current = open
  }, [open, group])

  const onSuccess = (): void => {
    utils.projects.list.invalidate()
    setOpen(false)
  }
  const createGroup = trpc.groups.create.useMutation({ onSuccess })
  const updateGroup = trpc.groups.update.useMutation({ onSuccess })
  const pending = createGroup.isPending || updateGroup.isPending
  const error = createGroup.error ?? updateGroup.error

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!name.trim()) return
    if (isEdit) updateGroup.mutate({ id: group.id, name, icon })
    else createGroup.mutate({ projectId, name, icon })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger
          render={
            trigger ?? (
              <Button variant="outline" size="sm">
                <IconFolderPlus />
                New group
              </Button>
            )
          }
        />
      )}
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit group' : 'New group'}</DialogTitle>
          <DialogDescription>
            Bundle actions so you can launch them together — and still on their own.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                placeholder="Dev environment"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Icon</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            {error && <p className="text-destructive-foreground text-sm">{error.message}</p>}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {isEdit ? 'Save' : 'Create group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
