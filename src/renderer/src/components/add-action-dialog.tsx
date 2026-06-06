import { IconPlus } from '@tabler/icons-react'
import { type FormEvent, type ReactElement, useId, useState } from 'react'
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
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@/components/ui/select'
import { trpc } from '@/lib/trpc'
import type { ActionType } from '../../../main/db/schema'

interface AddActionDialogProps {
  projectId: number
  /** Project default path — shown as the cwd placeholder for command actions. */
  projectPath: string | null
}

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  command: 'Run a command',
  link: 'Open a link'
}

const EMPTY = { label: '', url: '', command: '', cwd: '' }

/** Dialog + form to add a link or command action to a project. */
export function AddActionDialog({ projectId, projectPath }: AddActionDialogProps): ReactElement {
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ActionType>('command')
  const [form, setForm] = useState(EMPTY)
  const labelId = useId()
  const urlId = useId()
  const commandId = useId()
  const cwdId = useId()

  const create = trpc.actions.create.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      setForm(EMPTY)
      setType('command')
      setOpen(false)
    }
  })

  const set =
    (key: keyof typeof EMPTY) =>
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const canSubmit =
    form.label.trim().length > 0 &&
    (type === 'link' ? form.url.trim().length > 0 : form.command.trim().length > 0)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    if (type === 'link') {
      create.mutate({
        projectId,
        type: 'link',
        label: form.label,
        config: { url: form.url.trim() }
      })
    } else {
      create.mutate({
        projectId,
        type: 'command',
        label: form.label,
        config: {
          command: form.command.trim(),
          cwd: form.cwd.trim() || undefined
        }
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <IconPlus />
        Add action
      </DialogTrigger>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add action</DialogTitle>
          <DialogDescription>
            A link to open or a command to run for this project.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(next) => setType(next as ActionType)}>
                <SelectTrigger>{ACTION_TYPE_LABELS[type]}</SelectTrigger>
                <SelectPopup>
                  <SelectItem value="command">{ACTION_TYPE_LABELS.command}</SelectItem>
                  <SelectItem value="link">{ACTION_TYPE_LABELS.link}</SelectItem>
                </SelectPopup>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={labelId}>Label</Label>
              <Input
                id={labelId}
                placeholder={type === 'link' ? 'Open production' : 'Open in Cursor'}
                value={form.label}
                onChange={set('label')}
                required
              />
            </div>

            {type === 'link' ? (
              <div className="grid gap-1.5">
                <Label htmlFor={urlId}>URL</Label>
                <Input
                  id={urlId}
                  type="url"
                  placeholder="https://example.com"
                  value={form.url}
                  onChange={set('url')}
                  required
                />
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={commandId}>Command</Label>
                  <Input
                    id={commandId}
                    placeholder="open -a Cursor ."
                    value={form.command}
                    onChange={set('command')}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={cwdId}>Working directory (optional)</Label>
                  <Input
                    id={cwdId}
                    placeholder={projectPath ?? 'Project default path'}
                    value={form.cwd}
                    onChange={set('cwd')}
                  />
                </div>
              </>
            )}

            {create.error && (
              <p className="text-destructive-foreground text-sm">{create.error.message}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" loading={create.isPending} disabled={!canSubmit}>
              Add action
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
