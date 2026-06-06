import { useNavigate } from '@tanstack/react-router'
import { type FormEvent, type ReactElement, useId, useState } from 'react'
import { ColorPicker } from '@/components/color-picker'
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
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_COLOR_KEY } from '@/lib/colors'
import { DEFAULT_ICON_KEY } from '@/lib/icons'
import { trpc } from '@/lib/trpc'

const EMPTY_FORM = {
  name: '',
  description: '',
  icon: DEFAULT_ICON_KEY,
  color: DEFAULT_COLOR_KEY,
  path: ''
}

interface CreateProjectDialogProps {
  /** The button (or element) that opens the dialog. */
  trigger: ReactElement
}

/** Create-project form in a dialog; navigates to the new project on success. */
export function CreateProjectDialog({ trigger }: CreateProjectDialogProps): ReactElement {
  const navigate = useNavigate()
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const nameId = useId()
  const descriptionId = useId()
  const pathId = useId()

  const createProject = trpc.projects.create.useMutation({
    onSuccess: (project) => {
      utils.projects.list.invalidate()
      setForm(EMPTY_FORM)
      setOpen(false)
      navigate({
        to: '/projects/$projectId',
        params: { projectId: String(project.id) }
      })
    }
  })

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!form.name.trim()) return
    createProject.mutate(form)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Give it a name, a look, and where it lives.</DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                placeholder="Polaris"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea
                id={descriptionId}
                placeholder="What is this project?"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Icon</Label>
                <IconPicker
                  value={form.icon}
                  onChange={(icon) => setForm((p) => ({ ...p, icon }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Color</Label>
                <ColorPicker
                  value={form.color}
                  onChange={(color) => setForm((p) => ({ ...p, color }))}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={pathId}>Default path (optional)</Label>
              <Input
                id={pathId}
                placeholder="/Users/you/projects/polaris"
                value={form.path}
                onChange={(e) => setForm((p) => ({ ...p, path: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">
                Working directory commands run in (each action can override it).
              </p>
            </div>

            {createProject.error && (
              <p className="text-destructive-foreground text-sm">{createProject.error.message}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" loading={createProject.isPending} disabled={!form.name.trim()}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
