import {
  IconChevronLeft,
  IconLink,
  IconPlus,
  IconTerminal2,
  type TablerIcon
} from '@tabler/icons-react'
import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react'
import { IconPicker } from '@/components/icon-picker'
import { PathInput } from '@/components/path-input'
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
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger
} from '@/components/ui/select'
import { FAVICON_ICON_KEY } from '@/lib/favicon'
import type { ActionGroupRow, ProjectActionRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import type { ActionType, CommandActionConfig, LinkActionConfig } from '../../../main/db/schema'

interface AddActionDialogProps {
  projectId: number
  /** Project default path — shown as the cwd placeholder for command actions. */
  projectPath: string | null
  /** Groups the action can be filed under. */
  groups: ActionGroupRow[]
  /** Preselect a target group (e.g. when adding from within a group section). */
  defaultGroupId?: number | null
  /** When provided, the dialog edits this action (type fixed) instead of creating. */
  action?: ProjectActionRow
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
// Sentinel for the link "Open in" select: the OS default browser, no profile.
const OS_DEFAULT = 'default'
const EMPTY = { label: '', url: '', command: '', cwd: '', profile: OS_DEFAULT }

/** Encode a browser+profile as a single select value (or the OS-default sentinel). */
function profileValue(browser?: string | null, directory?: string | null): string {
  return browser && directory ? `${browser}::${directory}` : OS_DEFAULT
}

/** Decode an "Open in" select value back into a link config's browser/profile. */
function parseProfile(value: string): {
  browser: string | null
  profileDirectory: string | null
} {
  const sep = value.indexOf('::')
  if (sep === -1) return { browser: null, profileDirectory: null }
  return { browser: value.slice(0, sep), profileDirectory: value.slice(sep + 2) }
}

/** Form values seeded from an action being edited (or empty for create). */
function seedForm(action?: ProjectActionRow): typeof EMPTY {
  if (!action) return EMPTY
  if (action.type === 'link') {
    const config = action.config as LinkActionConfig
    return {
      ...EMPTY,
      label: action.label,
      url: config.url,
      profile: profileValue(config.browser, config.profileDirectory)
    }
  }
  const config = action.config as CommandActionConfig
  return { ...EMPTY, label: action.label, command: config.command, cwd: config.cwd ?? '' }
}

/** The group select's initial value: the edited action's group, else a preset. */
function initialGroup(action: ProjectActionRow | undefined, defaultGroupId: number | null): string {
  if (action?.groupId != null) return String(action.groupId)
  return defaultGroupId ? String(defaultGroupId) : NO_GROUP
}

/**
 * Dialog + form to add or edit a project action. Creating is two steps — a grid
 * of type cards (Command / Link), then the chosen type's settings (with a
 * "Change type" button back). Passing `action` edits it instead: the type is
 * fixed, so it opens straight on the settings with the fields prefilled.
 */
export function AddActionDialog({
  projectId,
  projectPath,
  groups,
  defaultGroupId = null,
  action,
  open: openProp,
  onOpenChange,
  trigger
}: AddActionDialogProps): ReactElement {
  const utils = trpc.useUtils()
  const isEdit = action != null
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  const setOpen = (next: boolean): void => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  // 'pick' = choosing a type from the grid (create only); 'configure' = the
  // type's settings. Editing skips the grid — the type can't change.
  const [step, setStep] = useState<'pick' | 'configure'>(isEdit ? 'configure' : 'pick')
  const [type, setType] = useState<ActionType>(action?.type ?? 'command')
  const [icon, setIcon] = useState(action?.icon ?? DEFAULT_ICON_FOR_TYPE.command)
  const [groupValue, setGroupValue] = useState(initialGroup(action, defaultGroupId))
  const [form, setForm] = useState(() => seedForm(action))
  const labelId = useId()
  const urlId = useId()
  const commandId = useId()
  const cwdId = useId()

  // Seed from the action (edit) or defaults (create) each time it opens —
  // mirroring GroupDialog — so a reopened dialog never shows stale state.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep(isEdit ? 'configure' : 'pick')
      setType(action?.type ?? 'command')
      setIcon(action?.icon ?? DEFAULT_ICON_FOR_TYPE.command)
      setGroupValue(initialGroup(action, defaultGroupId))
      setForm(seedForm(action))
    }
    wasOpen.current = open
  }, [open, action, isEdit, defaultGroupId])

  const onSuccess = (): void => {
    utils.projects.list.invalidate()
    setOpen(false)
  }
  const create = trpc.actions.create.useMutation({ onSuccess })
  const update = trpc.actions.update.useMutation({ onSuccess })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

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

    // Editing keeps the type fixed and leaves group membership alone (managed
    // via the row's "Move to" menu); creating files the new action in a group.
    if (action) {
      if (type === 'link') {
        update.mutate({
          id: action.id,
          type: 'link',
          label: form.label,
          icon,
          config: { url: form.url.trim(), ...parseProfile(form.profile) }
        })
      } else {
        update.mutate({
          id: action.id,
          type: 'command',
          label: form.label,
          icon,
          config: { command: form.command.trim(), cwd: form.cwd.trim() || undefined }
        })
      }
      return
    }
    const groupId = groupValue === NO_GROUP ? null : Number(groupValue)
    if (type === 'link') {
      create.mutate({
        projectId,
        groupId,
        type: 'link',
        label: form.label,
        icon,
        config: { url: form.url.trim(), ...parseProfile(form.profile) }
      })
    } else {
      create.mutate({
        projectId,
        groupId,
        type: 'command',
        label: form.label,
        icon,
        config: { command: form.command.trim(), cwd: form.cwd.trim() || undefined }
      })
    }
  }

  const groupTriggerLabel =
    groupValue === NO_GROUP
      ? 'No group'
      : (groups.find((g) => String(g.id) === groupValue)?.name ?? 'No group')

  // Linked browsers + their profiles drive the link "Open in" picker. The field
  // is shown only when at least one linked browser exposes a profile.
  const linkedBrowsers = trpc.browsers.listLinked.useQuery().data ?? []
  const hasBrowserProfiles = linkedBrowsers.some((browser) => browser.profiles.length > 0)
  const profileTriggerLabel = ((): string => {
    const { browser, profileDirectory } = parseProfile(form.profile)
    if (!browser || !profileDirectory) return 'Default (system browser)'
    const linked = linkedBrowsers.find((entry) => entry.key === browser)
    const profile = linked?.profiles.find((entry) => entry.directory === profileDirectory)
    return linked && profile ? `${linked.name} — ${profile.name}` : 'Default (system browser)'
  })()

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
          <DialogTitle>{isEdit ? 'Edit action' : 'Add action'}</DialogTitle>
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
              {!isEdit && (
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
              )}

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
                <>
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
                  {hasBrowserProfiles && (
                    <div className="grid gap-1.5">
                      <Label>Open in</Label>
                      <Select
                        value={form.profile}
                        onValueChange={(value) =>
                          setForm((prev) => ({ ...prev, profile: value ?? OS_DEFAULT }))
                        }
                      >
                        <SelectTrigger>{profileTriggerLabel}</SelectTrigger>
                        <SelectPopup>
                          <SelectItem value={OS_DEFAULT}>Default (system browser)</SelectItem>
                          {linkedBrowsers.map((browser) =>
                            browser.profiles.length > 0 ? (
                              <SelectGroup key={browser.key}>
                                <SelectGroupLabel>{browser.name}</SelectGroupLabel>
                                {browser.profiles.map((profile) => (
                                  <SelectItem
                                    key={`${browser.key}::${profile.directory}`}
                                    value={`${browser.key}::${profile.directory}`}
                                  >
                                    {profile.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ) : null
                          )}
                        </SelectPopup>
                      </Select>
                    </div>
                  )}
                </>
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
                    <PathInput
                      id={cwdId}
                      placeholder={projectPath ?? 'Project default path'}
                      value={form.cwd}
                      onChange={(value) => setForm((prev) => ({ ...prev, cwd: value }))}
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

              {!isEdit && (
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
              )}

              {error && <p className="text-destructive-foreground text-sm">{error.message}</p>}
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
              <Button type="submit" loading={pending} disabled={!canSubmit}>
                {isEdit ? 'Save changes' : 'Add action'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  )
}
