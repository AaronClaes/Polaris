import {
  IconAlertTriangle,
  IconArrowsSort,
  IconBolt,
  IconBrandGithub,
  IconCheck,
  IconDots,
  IconInbox,
  IconPencil,
  IconPin,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTrash,
  type TablerIcon
} from '@tabler/icons-react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import { ActionIcon } from '@/components/action-icon'
import { ActionLaunchButton } from '@/components/action-launch-button'
import { AddActionDialog } from '@/components/add-action-dialog'
import { ColorPicker } from '@/components/color-picker'
import { GroupDialog } from '@/components/group-dialog'
import { GroupLauncher } from '@/components/group-launcher'
import { IconPicker } from '@/components/icon-picker'
import { PathInput } from '@/components/path-input'
import { ProjectHome } from '@/components/project-home'
import { ProjectIcon } from '@/components/project-icon'
import { ProjectIssues } from '@/components/project-issues'
import { ProjectNotes } from '@/components/project-notes'
import { ProjectPulls } from '@/components/project-pulls'
import { ProjectRepos } from '@/components/project-repos'
import { ProjectTodos } from '@/components/project-todos'
import { ReorderableActions } from '@/components/reorderable-actions'
import { TagSelect } from '@/components/tag-select'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger
} from '@/components/ui/menu'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { buildRootEntries } from '@/lib/action-tree'
import { useRepoCounts, useRepoRefresh } from '@/lib/github-queries'
import { getIcon } from '@/lib/icons'
import type {
  ActionGroupRow,
  ProjectActionRow,
  ProjectRepoRow,
  ProjectWithActions
} from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import type {
  AppLauncherActionConfig,
  CommandActionConfig,
  LinkActionConfig,
  RepoActionConfig
} from '../../../main/db/schema'

/** The project detail tabs, in display order. Drives the `?tab=` search param
 *  (see the route) so cards and links can deep-link to a specific tab. */
export const PROJECT_TABS = ['home', 'issues', 'pulls', 'todos', 'notes', 'settings'] as const
export type ProjectTab = (typeof PROJECT_TABS)[number]
const DEFAULT_TAB: ProjectTab = 'home'

// Which tab a project opens on when no explicit `?tab=` is given: the last tab
// the user switched to, remembered across projects for the session. Stored in
// sessionStorage so it survives navigation but resets when the app is closed.
const REMEMBERED_TAB_KEY = 'polaris:project-tab'

/** Read the session's remembered tab, falling back to Home if absent/invalid. */
function readRememberedTab(): ProjectTab {
  try {
    const stored = sessionStorage.getItem(REMEMBERED_TAB_KEY)
    if (stored && (PROJECT_TABS as readonly string[]).includes(stored)) {
      return stored as ProjectTab
    }
  } catch {
    // sessionStorage can be unavailable (e.g. privacy modes); use the default.
  }
  return DEFAULT_TAB
}

/** Persist the tab as the session default. Only manual switches call this, so a
 *  deep-link (a `?tab=` from a card) never changes where other projects open. */
function writeRememberedTab(tab: ProjectTab): void {
  try {
    sessionStorage.setItem(REMEMBERED_TAB_KEY, tab)
  } catch {
    // Best-effort persistence; ignore storage failures.
  }
}

function actionTarget(action: ProjectActionRow): string {
  switch (action.type) {
    case 'link':
      return (action.config as LinkActionConfig).url
    case 'command':
      return (action.config as CommandActionConfig).command
    case 'repo': {
      const config = action.config as RepoActionConfig
      return `${config.owner}/${config.name}`
    }
    default:
      // terminal / ide: the directory it opens (the cwd override) or, when none
      // is set, a label for the default app it resolves to at run time.
      return (
        (action.config as AppLauncherActionConfig).cwd ??
        (action.type === 'terminal' ? 'Default terminal' : 'Default editor')
      )
  }
}

/**
 * Pin/unpin toggle for the dashboard. The icon is the same either way — Tabler
 * has no good "unpinned" glyph — so the button variant carries the state:
 * `outline` when pinned, `ghost` when not.
 */
function PinButton({
  pinned,
  loading,
  disabled,
  onToggle
}: {
  pinned: boolean
  loading: boolean
  disabled?: boolean
  onToggle: () => void
}): ReactElement {
  const tip = pinned ? 'Unpin from dashboard' : 'Pin to dashboard'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={pinned ? 'outline' : 'ghost'}
            size="icon-sm"
            loading={loading}
            disabled={disabled}
            aria-label={tip}
            onClick={onToggle}
          />
        }
      >
        <IconPin />
      </TooltipTrigger>
      <TooltipPopup>{tip}</TooltipPopup>
    </Tooltip>
  )
}

/**
 * Refetches this project's GitHub data (issues + PRs across its linked repos)
 * from the project header, so a single control covers every tab. Icon-only with
 * a tooltip; the spinner runs while any of those per-repo queries are in flight.
 */
function RefreshButton({
  loading,
  onRefresh
}: {
  loading: boolean
  onRefresh: () => void
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            loading={loading}
            aria-label="Refresh"
            onClick={onRefresh}
          />
        }
      >
        <IconRefresh />
      </TooltipTrigger>
      <TooltipPopup>Refresh</TooltipPopup>
    </Tooltip>
  )
}

/**
 * The project's launch bar: group split-buttons + loose-action buttons, like the
 * dashboard card — but here it shows everything, unpinned items included (pinning
 * only governs the dashboard). Empty groups are skipped (nothing to run).
 */
function LauncherRow({
  project,
  membersByGroup,
  looseActions,
  onError
}: {
  project: ProjectWithActions
  membersByGroup: Map<number, ProjectActionRow[]>
  looseActions: ProjectActionRow[]
  onError: (message: string | null) => void
}): ReactElement | null {
  const runAction = trpc.actions.run.useMutation({
    onSuccess: (res) => onError(res.ok ? null : (res.error ?? 'Action failed')),
    onError: (error) => onError(error.message)
  })

  const groupsWithMembers = project.groups.filter(
    (group) => (membersByGroup.get(group.id)?.length ?? 0) > 0
  )

  if (groupsWithMembers.length === 0 && looseActions.length === 0) return null

  // Groups and loose actions launch in their shared root order.
  const rootItems = buildRootEntries(groupsWithMembers, looseActions)

  return (
    <div className="flex flex-wrap gap-1.5">
      {rootItems.map((entry) =>
        entry.kind === 'group' ? (
          <GroupLauncher
            key={`group-${entry.group.id}`}
            group={entry.group}
            actions={membersByGroup.get(entry.group.id) ?? []}
            onError={onError}
          />
        ) : (
          <ActionLaunchButton
            key={`action-${entry.action.id}`}
            action={entry.action}
            loading={runAction.isPending && runAction.variables?.id === entry.action.id}
            onRun={() => runAction.mutate({ id: entry.action.id })}
          />
        )
      )}
    </div>
  )
}

/** One action: chosen icon, label, target, a Run button and a move/delete menu. */
function ActionRow({
  action,
  groups,
  repos,
  projectPath,
  onError
}: {
  action: ProjectActionRow
  groups: ActionGroupRow[]
  /** Linked repos — options when editing a GitHub repo action. */
  repos: ProjectRepoRow[]
  /** Project default path — the cwd placeholder when editing a command action. */
  projectPath: string | null
  onError: (message: string | null) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const [editOpen, setEditOpen] = useState(false)

  const runAction = trpc.actions.run.useMutation({
    onSuccess: (res) => onError(res.ok ? null : (res.error ?? 'Action failed')),
    onError: (error) => onError(error.message)
  })
  const deleteAction = trpc.actions.delete.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const setGroup = trpc.actions.setGroup.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const setPinned = trpc.actions.setPinned.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })

  const moveTargets = groups.filter((g) => g.id !== action.groupId)
  const hasMove = action.groupId != null || moveTargets.length > 0

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="text-muted-foreground">
        <ActionIcon action={action} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{action.label}</p>
        <p className="truncate font-mono text-muted-foreground text-xs">{actionTarget(action)}</p>
      </div>
      {/* Pinning is per dashboard unit: a loose action pins itself; a grouped
          action surfaces via its group's pin, so it gets no button of its own. */}
      {action.groupId == null && (
        <PinButton
          pinned={action.pinned}
          loading={setPinned.isPending}
          onToggle={() => setPinned.mutate({ id: action.id, pinned: !action.pinned })}
        />
      )}
      <Button
        variant="outline"
        size="sm"
        loading={runAction.isPending}
        onClick={() => runAction.mutate({ id: action.id })}
      >
        <IconPlayerPlay />
        Run
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`More actions for ${action.label}`}
            />
          }
        >
          <IconDots />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          <MenuItem onClick={() => setEditOpen(true)}>
            <IconPencil />
            Edit
          </MenuItem>
          <MenuSeparator />
          {hasMove && (
            <>
              <MenuGroup>
                <MenuGroupLabel>Move to</MenuGroupLabel>
                {action.groupId != null && (
                  <MenuItem onClick={() => setGroup.mutate({ id: action.id, groupId: null })}>
                    <IconInbox />
                    Ungrouped
                  </MenuItem>
                )}
                {moveTargets.map((group) => {
                  const GroupIcon = getIcon(group.icon).Icon
                  return (
                    <MenuItem
                      key={group.id}
                      onClick={() => setGroup.mutate({ id: action.id, groupId: group.id })}
                    >
                      <GroupIcon />
                      {group.name}
                    </MenuItem>
                  )
                })}
              </MenuGroup>
              <MenuSeparator />
            </>
          )}
          <MenuItem variant="destructive" onClick={() => deleteAction.mutate({ id: action.id })}>
            <IconTrash />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>

      <AddActionDialog
        projectId={action.projectId}
        projectPath={projectPath}
        groups={groups}
        repos={repos}
        action={action}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  )
}

/** A group as a bordered section: header (run-all + manage) over member rows. */
function GroupSection({
  project,
  group,
  members,
  onError
}: {
  project: ProjectWithActions
  group: ActionGroupRow
  members: ProjectActionRow[]
  onError: (message: string | null) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const GroupIcon = getIcon(group.icon).Icon

  const runGroup = trpc.groups.run.useMutation({
    onSuccess: (res) => {
      if (res.ok) return onError(null)
      const failed = res.results.filter((r) => !r.ok)
      onError(
        `${failed.length} of ${res.results.length} failed: ${failed.map((r) => r.label).join(', ')}`
      )
    },
    onError: (error) => onError(error.message)
  })
  const deleteGroup = trpc.groups.delete.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const updateGroup = trpc.groups.update.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <span className="text-muted-foreground">
          <GroupIcon size={18} />
        </span>
        <span className="truncate font-medium text-sm">{group.name}</span>
        <span className="text-muted-foreground text-xs">{members.length}</span>
        <div className="ml-auto flex items-center gap-1">
          <PinButton
            pinned={group.pinned}
            loading={updateGroup.isPending}
            disabled={members.length === 0}
            onToggle={() => updateGroup.mutate({ id: group.id, pinned: !group.pinned })}
          />
          <Button
            variant="outline"
            size="sm"
            loading={runGroup.isPending}
            disabled={members.length === 0}
            onClick={() => runGroup.mutate({ groupId: group.id })}
          >
            <IconPlayerPlay />
            Run all
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Manage ${group.name}`}
                  title="Manage group"
                />
              }
            >
              <IconDots />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-48">
              <MenuItem onClick={() => setAddOpen(true)}>
                <IconPlus />
                Add action
              </MenuItem>
              <MenuItem onClick={() => setEditOpen(true)}>
                <IconPencil />
                Edit group
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => deleteGroup.mutate({ id: group.id })}>
                <IconTrash />
                Delete group
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      <AddActionDialog
        projectId={project.id}
        projectPath={project.path}
        groups={project.groups}
        repos={project.repos}
        defaultGroupId={group.id}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      <GroupDialog
        projectId={project.id}
        group={group}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      {members.length === 0 ? (
        <p className="px-3 py-4 text-center text-muted-foreground text-xs">
          No actions yet. Add one to this group.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {members.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              groups={project.groups}
              repos={project.repos}
              projectPath={project.path}
              onError={onError}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The action-management surface (the Actions tab): toolbar + groups + loose actions. */
function ActionsTab({
  project,
  membersByGroup,
  looseActions,
  onError
}: {
  project: ProjectWithActions
  membersByGroup: Map<number, ProjectActionRow[]>
  looseActions: ProjectActionRow[]
  onError: (message: string | null) => void
}): ReactElement {
  const utils = trpc.useUtils()
  const [reordering, setReordering] = useState(false)

  const isEmpty = project.groups.length === 0 && looseActions.length === 0
  // Reordering is only meaningful with groups (move in/out, reorder them) or
  // more than one loose action to shuffle.
  const canReorder = project.groups.length > 0 || project.actions.length > 1

  // Groups and loose actions interleave in one root list, ordered by their
  // shared sortOrder; a loose action renders as a bare row between group cards.
  const rootItems = useMemo(
    () => buildRootEntries(project.groups, looseActions),
    [project.groups, looseActions]
  )

  const exitReorder = (): void => {
    // Re-sync the rest of the app (sidebar, dashboard) with the new order.
    utils.projects.list.invalidate()
    setReordering(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        {reordering ? (
          <Button variant="outline" size="sm" onClick={exitReorder}>
            <IconCheck />
            Done
          </Button>
        ) : (
          <>
            {canReorder && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onError(null)
                  setReordering(true)
                }}
              >
                <IconArrowsSort />
                Reorder
              </Button>
            )}
            <GroupDialog projectId={project.id} />
            <AddActionDialog
              projectId={project.id}
              projectPath={project.path}
              groups={project.groups}
              repos={project.repos}
            />
          </>
        )}
      </div>

      {reordering ? (
        <ReorderableActions project={project} />
      ) : isEmpty ? (
        <p className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
          No actions yet. Add a link to open, a command to run, or a group to launch several at
          once.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rootItems.map((entry) =>
            entry.kind === 'group' ? (
              <GroupSection
                key={`group-${entry.group.id}`}
                project={project}
                group={entry.group}
                members={membersByGroup.get(entry.group.id) ?? []}
                onError={onError}
              />
            ) : (
              <ActionRow
                key={`action-${entry.action.id}`}
                action={entry.action}
                groups={project.groups}
                repos={project.repos}
                projectPath={project.path}
                onError={onError}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

/** A titled section inside the project Settings tab — a header (title + optional
 *  description) over its content, sharing the project's lightweight heading
 *  style so every vertical-tab panel reads the same. */
function SettingsPanel({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <div className="min-w-0">
        <h3 className="font-medium text-sm">{title}</h3>
        {description && <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>}
      </div>
      {children}
    </section>
  )
}

type ProjectForm = {
  name: string
  description: string
  icon: string
  color: string
  tagId: number | null
  path: string
}

/** Project row → the editable form shape (nullable columns become ''). */
function seedProjectForm(p: ProjectWithActions): ProjectForm {
  return {
    name: p.name,
    description: p.description ?? '',
    icon: p.icon,
    color: p.color,
    tagId: p.tagId,
    path: p.path ?? ''
  }
}

/** The General settings panel: editable project basics (name, description, look,
 *  default path). Auto-saves — every edit is debounced and persisted via
 *  projects.update, so there's no Save button. The required name is never saved
 *  blank (the field just shows a hint until it's filled back in). */
function GeneralPanel({ project }: { project: ProjectWithActions }): ReactElement {
  const utils = trpc.useUtils()
  const tags = trpc.tags.list.useQuery().data ?? []
  const update = trpc.projects.update.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })

  const [form, setForm] = useState(() => seedProjectForm(project))
  const nameId = useId()
  const descriptionId = useId()
  const pathId = useId()

  // Re-seed when navigating to a different project (this instance is reused).
  const seededId = useRef(project.id)
  useEffect(() => {
    if (seededId.current !== project.id) {
      seededId.current = project.id
      setForm(seedProjectForm(project))
    }
  }, [project])

  const persisted = seedProjectForm(project)
  const dirty =
    form.name !== persisted.name ||
    form.description !== persisted.description ||
    form.icon !== persisted.icon ||
    form.color !== persisted.color ||
    form.tagId !== persisted.tagId ||
    form.path !== persisted.path
  const nameValid = form.name.trim().length > 0

  // Debounced auto-save: persist once edits settle and the name is non-blank.
  // When the save lands, the query invalidates and `persisted` catches up to
  // `form`, so `dirty` flips false and this doesn't re-fire.
  const save = update.mutate
  useEffect(() => {
    if (!dirty || !nameValid) return
    const timer = setTimeout(() => {
      save({
        id: project.id,
        name: form.name,
        description: form.description,
        icon: form.icon,
        color: form.color,
        tagId: form.tagId,
        path: form.path
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [form, dirty, nameValid, project.id, save])

  return (
    <SettingsPanel
      title="General"
      description="Name, appearance, and where this project's commands run."
    >
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          aria-invalid={!nameValid}
          required
        />
        {!nameValid && <p className="text-destructive-foreground text-xs">Name is required.</p>}
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
          <IconPicker value={form.icon} onChange={(icon) => setForm((p) => ({ ...p, icon }))} />
        </div>
        <div className="grid gap-1.5">
          <Label>Color</Label>
          <ColorPicker value={form.color} onChange={(color) => setForm((p) => ({ ...p, color }))} />
        </div>
      </div>

      {tags.length > 0 && (
        <div className="grid gap-1.5">
          <Label>Tag</Label>
          <TagSelect
            tags={tags}
            value={form.tagId}
            onChange={(tagId) => setForm((p) => ({ ...p, tagId }))}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={pathId}>Default path (optional)</Label>
        <PathInput
          id={pathId}
          placeholder="/Users/you/projects/polaris"
          value={form.path}
          onChange={(value) => setForm((p) => ({ ...p, path: value }))}
        />
        <p className="text-muted-foreground text-xs">
          Working directory commands run in (each action can override it).
        </p>
      </div>

      {update.error && (
        <p className="text-destructive-foreground text-sm">{update.error.message}</p>
      )}
    </SettingsPanel>
  )
}

/** The Danger zone panel: permanently delete the project (with confirmation). */
function DangerZonePanel({ project }: { project: ProjectWithActions }): ReactElement {
  const utils = trpc.useUtils()
  const navigate = useNavigate()
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      navigate({ to: '/' })
    }
  })

  return (
    <SettingsPanel title="Danger zone" description="Irreversible actions for this project.">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/36 px-3 py-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">Delete this project</p>
          <p className="text-muted-foreground text-sm">
            Permanently removes the project and all its actions. This can't be undone.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive-outline" size="sm" className="shrink-0">
                <IconTrash />
                Delete project
              </Button>
            }
          />
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the project and all its actions and groups. This can't be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              <Button
                variant="destructive"
                loading={deleteProject.isPending}
                onClick={() => deleteProject.mutate({ id: project.id })}
              >
                Delete project
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      </div>
    </SettingsPanel>
  )
}

interface ProjectSettingsSection {
  id: string
  label: string
  Icon: TablerIcon
  render: () => ReactElement
}

/** The Settings tab: a vertical section menu (like the app-wide settings page)
 *  over General, Actions, GitHub, and Danger zone panels. */
function SettingsTab({
  project,
  membersByGroup,
  looseActions,
  onError
}: {
  project: ProjectWithActions
  membersByGroup: Map<number, ProjectActionRow[]>
  looseActions: ProjectActionRow[]
  onError: (message: string | null) => void
}): ReactElement {
  const [activeId, setActiveId] = useState('general')

  const sections: ProjectSettingsSection[] = [
    {
      id: 'general',
      label: 'General',
      Icon: IconSettings,
      render: () => <GeneralPanel project={project} />
    },
    {
      id: 'actions',
      label: 'Actions',
      Icon: IconBolt,
      render: () => (
        <SettingsPanel
          title="Actions"
          description="Links to open and commands to run for this project."
        >
          <ActionsTab
            project={project}
            membersByGroup={membersByGroup}
            looseActions={looseActions}
            onError={onError}
          />
        </SettingsPanel>
      )
    },
    {
      id: 'github',
      label: 'GitHub',
      Icon: IconBrandGithub,
      render: () => <ProjectRepos project={project} />
    },
    {
      id: 'danger',
      label: 'Danger zone',
      Icon: IconAlertTriangle,
      render: () => <DangerZonePanel project={project} />
    }
  ]
  const active = sections.find((s) => s.id === activeId) ?? sections[0]

  return (
    <div className="flex gap-6">
      <nav className="w-44 shrink-0">
        <ul className="grid gap-0.5">
          {sections.map((section) => {
            const isActive = section.id === active.id
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(section.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground [&_svg]:text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  <section.Icon />
                  {section.label}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">{active.render()}</div>
    </div>
  )
}

export function ProjectDetail({ project }: { project: ProjectWithActions }): ReactElement {
  const utils = trpc.useUtils()
  const [runError, setRunError] = useState<string | null>(null)
  // A note can take over the whole project page; only meaningful on the Notes tab.
  const [notesExpanded, setNotesExpanded] = useState(false)
  const navigate = useNavigate()
  const setPinned = trpc.projects.setPinned.useMutation({
    onSuccess: () => utils.projects.list.invalidate()
  })
  // The shell is a pathless layout route, so the route ID is `/shell/...` even
  // though the URL stays `/projects/$projectId`.
  const { tab } = useSearch({ from: '/shell/projects/$projectId' })
  // A `?tab=` deep-link (e.g. a card's Issues link) wins; otherwise open on the
  // tab the user last switched to this session, remembered across projects.
  const [rememberedTab, setRememberedTab] = useState<ProjectTab>(readRememberedTab)
  const activeTab = tab ?? rememberedTab

  // Reflect the open tab in `?tab=`; the default tab clears the param to keep
  // URLs clean. `replace` so tab switches don't pile up in history. Remember the
  // choice so it carries to the next project — a manual switch persists; a
  // deep-link (which never reaches here) does not.
  const handleTabChange = (value: string): void => {
    const next = value as ProjectTab
    setRememberedTab(next)
    writeRememberedTab(next)
    navigate({
      to: '/projects/$projectId',
      params: { projectId: String(project.id) },
      search: { tab: next === DEFAULT_TAB ? undefined : next },
      replace: true
    })
  }

  const looseActions = useMemo(
    () => project.actions.filter((a) => a.groupId == null),
    [project.actions]
  )
  const membersByGroup = useMemo(() => {
    const map = new Map<number, ProjectActionRow[]>()
    for (const action of project.actions) {
      if (action.groupId == null) continue
      const list = map.get(action.groupId)
      if (list) list.push(action)
      else map.set(action.groupId, [action])
    }
    return map
  }, [project.actions])

  // Counts for the tab badges. Reads the same per-repo cache the tabs' own
  // views use, so this is free; the badge shows only once that count has data.
  const repos = useMemo(
    () => project.repos.map((repo) => ({ owner: repo.owner, name: repo.name })),
    [project.repos]
  )
  const counts = useRepoCounts(repos)
  // Project-level GitHub refresh, surfaced in the header so it covers every tab.
  const { refresh, isFetching } = useRepoRefresh(repos)

  // Open-todo count for the tab badge. Shares the Todos tab's own query cache.
  // `loaded` gates the badge so it doesn't flash "0" before the query resolves.
  const todosQuery = trpc.todos.list.useQuery({ projectId: project.id })
  const openTodos = (todosQuery.data ?? []).filter((todo) => !todo.completed).length
  const todosLoaded = !todosQuery.isLoading

  // Fullscreen note mode: the active note fills the project page. Gate on the
  // Notes tab being open so navigating elsewhere always restores the chrome.
  const expanded = notesExpanded && activeTab === 'notes'
  // The Notes tab fills the viewport region (the list/editor scroll internally)
  // instead of growing the page; every other tab keeps its natural scroll.
  const notesActive = activeTab === 'notes'

  return (
    <div
      className={cn(
        expanded ? 'flex h-full flex-col' : 'mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10',
        notesActive && 'h-full'
      )}
    >
      {!expanded && (
        <>
          <header className="flex items-start gap-4">
            <ProjectIcon icon={project.icon} color={project.color} size={30} className="size-14" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 truncate font-heading font-semibold text-2xl tracking-tight">
                  {project.name}
                </h1>
                <PinButton
                  pinned={project.pinned}
                  loading={setPinned.isPending}
                  onToggle={() => setPinned.mutate({ id: project.id, pinned: !project.pinned })}
                />
                {/* Only when there are repos to refresh — todos/notes are local. */}
                {repos.length > 0 && <RefreshButton loading={isFetching} onRefresh={refresh} />}
              </div>
              {project.description && (
                <p className="mt-0.5 text-muted-foreground text-sm">{project.description}</p>
              )}
              {project.path && (
                <p
                  className="mt-2 truncate font-mono text-muted-foreground text-xs"
                  title={project.path}
                >
                  {project.path}
                </p>
              )}
            </div>
          </header>

          <LauncherRow
            project={project}
            membersByGroup={membersByGroup}
            looseActions={looseActions}
            onError={setRunError}
          />

          {runError && (
            <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
              {runError}
            </p>
          )}
        </>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => handleTabChange(String(value))}
        className={cn(notesActive && 'flex min-h-0 flex-1 flex-col')}
      >
        {!expanded && (
          <TabsList variant="underline" className="w-full justify-start border-border border-b">
            <TabsTab value="home" className="grow-0">
              Home
            </TabsTab>
            <TabsTab value="issues" className="grow-0">
              Issues
              {repos.length > 0 && counts.issuesLoaded && (
                <Badge variant="secondary" size="sm" className="rounded-full">
                  {counts.issues}
                </Badge>
              )}
            </TabsTab>
            <TabsTab value="pulls" className="grow-0">
              Pull requests
              {repos.length > 0 && counts.pullsLoaded && (
                <Badge variant="secondary" size="sm" className="rounded-full">
                  {counts.pulls}
                </Badge>
              )}
            </TabsTab>
            <TabsTab value="todos" className="grow-0">
              Todos
              {todosLoaded && (
                <Badge variant="secondary" size="sm" className="rounded-full">
                  {openTodos}
                </Badge>
              )}
            </TabsTab>
            <TabsTab value="notes" className="grow-0">
              Notes
            </TabsTab>
            <TabsTab value="settings" className="grow-0">
              Settings
            </TabsTab>
          </TabsList>
        )}

        <TabsPanel value="home" className="pt-5" keepMounted>
          <ProjectHome project={project} />
        </TabsPanel>

        <TabsPanel value="issues" className="pt-5" keepMounted>
          <ProjectIssues project={project} />
        </TabsPanel>

        <TabsPanel value="pulls" className="pt-5" keepMounted>
          <ProjectPulls project={project} />
        </TabsPanel>

        <TabsPanel value="todos" className="pt-5" keepMounted>
          <ProjectTodos key={project.id} project={project} />
        </TabsPanel>

        <TabsPanel value="notes" className={cn('min-h-0 flex-1', !expanded && 'pt-5')} keepMounted>
          <ProjectNotes project={project} expanded={expanded} onExpandedChange={setNotesExpanded} />
        </TabsPanel>

        <TabsPanel value="settings" className="pt-5">
          <SettingsTab
            project={project}
            membersByGroup={membersByGroup}
            looseActions={looseActions}
            onError={setRunError}
          />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
