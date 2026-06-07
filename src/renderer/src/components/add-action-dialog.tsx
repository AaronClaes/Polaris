import {
  IconChevronLeft,
  IconLink,
  IconPlus,
  IconTerminal2,
  type TablerIcon
} from '@tabler/icons-react'
import { type FormEvent, type ReactElement, useId, useState } from 'react'
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
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@/components/ui/select'
import { FAVICON_ICON_KEY } from '@/lib/favicon'
import type { ActionGroupRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import type { ActionType } from '../../../main/db/schema'

interface AddActionDialogProps {
  projectId: number
  /** Project default path — shown as the cwd placeholder for command actions. */
  projectPath: string | null
  /** Groups the action can be filed under. */
  groups: ActionGroupRow[]
  /** Preselect a target group (e.g. when adding from within a group section). */
  defaultGroupId?: number | null
  /** Controlled open state. When provided, no trigger is rendered. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Custom trigger (uncontrolled mode only); defaults to an "Add action" button. */
  trigger?: ReactElement
}

/** The pickable action types, in display order, with their card presentation. */
const ACTION_TYPE_ORDER = ['command', 'link'] as const satisfies readonly ActionType[]
const ACTION_TYPE_META: Record<
  ActionType,
  { title: string; description: string; Icon: TablerIcon }
> = {
  command: { title: 'Command', description: 'Run a shell command', Icon: IconTerminal2 },
  link: { title: 'Link', description: 'Open a URL in your browser', Icon: IconLink }
}

/** Sensible default icon for a freshly chosen action type. Links default to the
 *  site favicon; the user can still override to any Tabler icon. */
const DEFAULT_ICON_FOR_TYPE: Record<ActionType, string> = {
  command: 'terminal',
  link: FAVICON_ICON_KEY
}

const NO_GROUP = 'none'
const EMPTY = { label: '', url: '', command: '', cwd: '' }

/**
 * Dialog + form to add an action to a project. Creation is two steps: first a
 * grid of type cards (Command / Link), then the settings for the chosen type
 * with a "Change type" button back to the grid.
 */
export function AddActionDialog({
  projectId,
  projectPath,
  groups,
  defaultGroupId = null,
  open: openProp,
  onOpenChange,
  trigger
}: AddActionDialogProps): ReactElement {
  const utils = trpc.useUtils()
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  // 'pick' = choosing a type from the grid; 'configure' = the type's settings.
  const [step, setStep] = useState<'pick' | 'configure'>('pick')
  const [type, setType] = useState<ActionType>('command')
  const [icon, setIcon] = useState(DEFAULT_ICON_FOR_TYPE.command)
  const [groupValue, setGroupValue] = useState(defaultGroupId ? String(defaultGroupId) : NO_GROUP)
  const [form, setForm] = useState(EMPTY)
  const labelId = useId()
  const urlId = useId()
  const commandId = useId()
  const cwdId = useId()

  const reset = (): void => {
    setStep('pick')
    setType('command')
    setIcon(DEFAULT_ICON_FOR_TYPE.command)
    setGroupValue(defaultGroupId ? String(defaultGroupId) : NO_GROUP)
    setForm(EMPTY)
  }

  // Closing (cancel or after submit) resets the flow so reopening starts at the
  // type grid rather than the last configured step.
  const setOpen = (next: boolean): void => {
    if (!next) reset()
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  const create = trpc.actions.create.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      setOpen(false)
    }
  })

  // Picking a type from the grid seeds that type's default glyph, then advances
  // to its settings; the user can still change either afterwards.
  const chooseType = (next: ActionType): void => {
    setType(next)
    setIcon(DEFAULT_ICON_FOR_TYPE[next])
    setStep('configure')
  }

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
    const groupId = groupValue === NO_GROUP ? null : Number(groupValue)
    if (type === 'link') {
      create.mutate({
        projectId,
        groupId,
        type: 'link',
        label: form.label,
        icon,
        config: { url: form.url.trim() }
      })
    } else {
      create.mutate({
        projectId,
        groupId,
        type: 'command',
        label: form.label,
        icon,
        config: {
          command: form.command.trim(),
          cwd: form.cwd.trim() || undefined
        }
      })
    }
  }

  const groupTriggerLabel =
    groupValue === NO_GROUP
      ? 'No group'
      : (groups.find((g) => String(g.id) === groupValue)?.name ?? 'No group')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger
          render={
            trigger ?? (
              <Button variant="outline" size="sm">
                <IconPlus />
                Add action
              </Button>
            )
          }
        />
      )}
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add action</DialogTitle>
          <DialogDescription>
            {step === 'pick' ? 'Choose what this action does.' : ACTION_TYPE_META[type].description}
          </DialogDescription>
        </DialogHeader>

        {step === 'pick' ? (
          <>
            <DialogPanel>
              <div className="grid grid-cols-2 gap-3">
                {ACTION_TYPE_ORDER.map((option) => {
                  const meta = ACTION_TYPE_META[option]
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => chooseType(option)}
                      className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-ring hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
                        <meta.Icon size={20} />
                      </span>
                      <span className="font-medium text-sm">{meta.title}</span>
                      <span className="text-muted-foreground text-xs">{meta.description}</span>
                    </button>
                  )
                })}
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form className="contents" onSubmit={handleSubmit}>
            <DialogPanel className="grid gap-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 w-fit text-muted-foreground"
                onClick={() => setStep('pick')}
              >
                <IconChevronLeft />
                Change type
              </Button>

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

              <div className="grid gap-1.5">
                <Label>Icon</Label>
                <IconPicker
                  value={icon}
                  onChange={setIcon}
                  linkUrl={type === 'link' ? form.url : undefined}
                />
              </div>

              <div className="grid gap-1.5">
                <Label>Group (optional)</Label>
                <Select
                  value={groupValue}
                  onValueChange={(value) => setGroupValue(value ?? NO_GROUP)}
                >
                  <SelectTrigger>{groupTriggerLabel}</SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NO_GROUP}>No group</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={String(group.id)}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

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
        )}
      </DialogPopup>
    </Dialog>
  )
}
