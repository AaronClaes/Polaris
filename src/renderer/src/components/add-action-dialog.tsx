import {
  IconBrandGithub,
  IconChevronLeft,
  IconCode,
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
import { APP_ICON_KEY } from '@/lib/app-icons'
import { FAVICON_ICON_KEY } from '@/lib/favicon'
import type { ActionGroupRow, ProjectActionRow, ProjectRepoRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import type {
  ActionType,
  AppLauncherActionConfig,
  CommandActionConfig,
  LinkActionConfig,
  RepoActionConfig
} from '../../../main/db/schema'

interface AddActionDialogProps {
  projectId: number
  /** Project default path — shown as the cwd placeholder for command actions. */
  projectPath: string | null
  /** Groups the action can be filed under. */
  groups: ActionGroupRow[]
  /** The project's linked repos — the options for a GitHub repo action. */
  repos: ProjectRepoRow[]
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

/** The pickable action types, in display order, with their card presentation.
 *  `labelPlaceholder` seeds the Label field's placeholder. Terminal / IDE open
 *  the project in the default app set in Settings, so they take no command. */
const ACTION_TYPE_ORDER = [
  'command',
  'terminal',
  'ide',
  'repo',
  'link'
] as const satisfies readonly ActionType[]
const ACTION_TYPE_META: Record<
  ActionType,
  { title: string; description: string; labelPlaceholder: string; Icon: TablerIcon }
> = {
  command: {
    title: 'Command',
    description: 'Run a shell command',
    labelPlaceholder: 'Start dev server',
    Icon: IconTerminal2
  },
  terminal: {
    title: 'Terminal',
    description: 'Open in your default terminal',
    labelPlaceholder: 'Open terminal',
    Icon: IconTerminal2
  },
  ide: {
    title: 'IDE',
    description: 'Open in your default editor',
    labelPlaceholder: 'Open in editor',
    Icon: IconCode
  },
  repo: {
    title: 'GitHub repo',
    description: 'Open a linked repository on GitHub',
    labelPlaceholder: 'Open repo',
    Icon: IconBrandGithub
  },
  link: {
    title: 'Link',
    description: 'Open a URL in your browser',
    labelPlaceholder: 'Open production',
    Icon: IconLink
  }
}

/** Sensible default icon for a freshly chosen action type. Links default to the
 *  site favicon, terminal / IDE to the resolved app's icon, and repos to the
 *  GitHub glyph; the user can still override any of them (repos can also pick
 *  the GitHub favicon, like a link). */
const DEFAULT_ICON_FOR_TYPE: Record<ActionType, string> = {
  command: 'terminal',
  terminal: APP_ICON_KEY,
  ide: APP_ICON_KEY,
  repo: 'github',
  link: FAVICON_ICON_KEY
}

const NO_GROUP = 'none'
// Sentinel for the link "Open in" select: the OS default browser, no profile.
const OS_DEFAULT = 'default'
const EMPTY = { label: '', url: '', command: '', cwd: '', repoId: '', profile: OS_DEFAULT }

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
  if (action.type === 'command') {
    const config = action.config as CommandActionConfig
    return { ...EMPTY, label: action.label, command: config.command, cwd: config.cwd ?? '' }
  }
  if (action.type === 'repo') {
    const config = action.config as RepoActionConfig
    return {
      ...EMPTY,
      label: action.label,
      repoId: String(config.repoId),
      profile: profileValue(config.browser, config.profileDirectory)
    }
  }
  // terminal / ide — no command, just an optional working directory.
  const config = action.config as AppLauncherActionConfig
  return { ...EMPTY, label: action.label, cwd: config.cwd ?? '' }
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
  repos,
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

  // The currently picked repo (repo actions). Resolved from the live list, so a
  // stored repo that's since been unlinked reads as no selection.
  const selectedRepo = repos.find((repo) => String(repo.repoId) === form.repoId)

  // Label is always required; link needs a URL, command a command, and a repo
  // action a (still-linked) repo. Terminal / IDE carry no extra required field.
  const canSubmit =
    form.label.trim().length > 0 &&
    (type === 'link'
      ? form.url.trim().length > 0
      : type === 'command'
        ? form.command.trim().length > 0
        : type === 'repo'
          ? selectedRepo != null
          : true)

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return

    // Editing keeps the type fixed and leaves group membership alone (managed
    // via the row's "Move to" menu); creating files the new action in a group.
    const groupId = groupValue === NO_GROUP ? null : Number(groupValue)
    const cwd = form.cwd.trim() || undefined

    // Each branch passes its own `type` literal so the discriminated mutation
    // input resolves to the matching config shape.
    switch (type) {
      case 'link': {
        const config = { url: form.url.trim(), ...parseProfile(form.profile) }
        if (action) update.mutate({ id: action.id, type: 'link', label: form.label, icon, config })
        else create.mutate({ projectId, groupId, type: 'link', label: form.label, icon, config })
        break
      }
      case 'command': {
        const config = { command: form.command.trim(), cwd }
        if (action)
          update.mutate({ id: action.id, type: 'command', label: form.label, icon, config })
        else create.mutate({ projectId, groupId, type: 'command', label: form.label, icon, config })
        break
      }
      case 'terminal': {
        if (action)
          update.mutate({
            id: action.id,
            type: 'terminal',
            label: form.label,
            icon,
            config: { cwd }
          })
        else
          create.mutate({
            projectId,
            groupId,
            type: 'terminal',
            label: form.label,
            icon,
            config: { cwd }
          })
        break
      }
      case 'ide': {
        if (action)
          update.mutate({ id: action.id, type: 'ide', label: form.label, icon, config: { cwd } })
        else
          create.mutate({
            projectId,
            groupId,
            type: 'ide',
            label: form.label,
            icon,
            config: { cwd }
          })
        break
      }
      case 'repo': {
        if (!selectedRepo) return
        const config = {
          repoId: selectedRepo.repoId,
          owner: selectedRepo.owner,
          name: selectedRepo.name,
          url: selectedRepo.url,
          ...parseProfile(form.profile)
        }
        if (action) update.mutate({ id: action.id, type: 'repo', label: form.label, icon, config })
        else create.mutate({ projectId, groupId, type: 'repo', label: form.label, icon, config })
        break
      }
    }
  }

  const groupTriggerLabel =
    groupValue === NO_GROUP
      ? 'No group'
      : (groups.find((g) => String(g.id) === groupValue)?.name ?? 'No group')

  // The resolved default apps drive the terminal / IDE "App icon" option — its
  // glyph is whichever default the action will open.
  const defaultApps = trpc.settings.defaultApps.useQuery().data
  const appIcon =
    type === 'terminal' || type === 'ide'
      ? {
          key: type === 'terminal' ? defaultApps?.terminal : defaultApps?.ide,
          fallback: type === 'terminal' ? IconTerminal2 : IconCode
        }
      : undefined

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
                  placeholder={ACTION_TYPE_META[type].labelPlaceholder}
                  value={form.label}
                  onChange={set('label')}
                  required
                />
              </div>

              {type === 'link' && (
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
              )}

              {type === 'repo' && (
                <div className="grid gap-1.5">
                  <Label>Repository</Label>
                  {repos.length === 0 ? (
                    <p className="rounded-md border border-border border-dashed px-3 py-2 text-muted-foreground text-sm">
                      No repositories linked. Link one in the project's Settings tab first.
                    </p>
                  ) : (
                    <Select
                      value={form.repoId || null}
                      onValueChange={(value) =>
                        setForm((prev) => ({ ...prev, repoId: value ?? '' }))
                      }
                    >
                      <SelectTrigger>
                        {selectedRepo
                          ? `${selectedRepo.owner}/${selectedRepo.name}`
                          : 'Select a repository'}
                      </SelectTrigger>
                      <SelectPopup>
                        {repos.map((repo) => (
                          <SelectItem key={repo.repoId} value={String(repo.repoId)}>
                            {repo.owner}/{repo.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                </div>
              )}

              {/* "Open in" is shared by link and repo — both open a URL in a
                  browser. Shown only when a linked browser exposes profiles. */}
              {(type === 'link' || type === 'repo') && hasBrowserProfiles && (
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

              {type === 'command' && (
                <div className="grid gap-1.5">
                  <Label htmlFor={commandId}>Command</Label>
                  <Input
                    id={commandId}
                    placeholder="pnpm dev"
                    value={form.command}
                    onChange={set('command')}
                    required
                  />
                </div>
              )}

              {/* The working directory applies to anything launched on a path:
                  the command's cwd, or the dir the terminal / IDE opens in. */}
              {(type === 'command' || type === 'terminal' || type === 'ide') && (
                <div className="grid gap-1.5">
                  <Label htmlFor={cwdId}>Working directory (optional)</Label>
                  <PathInput
                    id={cwdId}
                    placeholder={projectPath ?? 'Project default path'}
                    value={form.cwd}
                    onChange={(value) => setForm((prev) => ({ ...prev, cwd: value }))}
                  />
                </div>
              )}

              <div className="grid gap-1.5">
                <Label>Icon</Label>
                <IconPicker
                  value={icon}
                  onChange={setIcon}
                  // Repos offer a favicon too; it's GitHub's, resolved from the
                  // repo URL (or github.com before one is picked).
                  linkUrl={
                    type === 'link'
                      ? form.url
                      : type === 'repo'
                        ? (selectedRepo?.url ?? 'https://github.com')
                        : undefined
                  }
                  appIcon={appIcon}
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
