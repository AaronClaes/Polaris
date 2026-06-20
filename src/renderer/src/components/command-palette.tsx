import {
  IconCircleDot,
  IconGitPullRequest,
  IconLayoutDashboard,
  IconSettings,
  type TablerIcon
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { SearchIcon } from 'lucide-react'
import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState
} from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { AutocompleteInput } from '@/components/ui/autocomplete'
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { useRepoIssues, useRepoPulls } from '@/lib/github-queries'
import type { IssueRow, ProjectWithActions, PullRequestRow } from '@/lib/project-types'
import { useVisibleProjects } from '@/lib/use-visible-projects'
import { useUiStore } from '@/stores/ui-store'

// Rows shown per source before you type; the search then widens to the whole set,
// capped per section so the list stays scannable.
const RECENT_COUNT = 5
const MAX_RESULTS = 8

// Stable empty repo list so the github hooks idle (no fetch) while the palette is
// closed — passing a fresh [] each render would thrash their query keys.
const NO_REPOS: { owner: string; name: string }[] = []

const repoKey = (repo: { owner: string; name: string }): string =>
  `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`

// Most-recent-first sort key; falls back to creation when no update time.
const recencyMs = (row: { updatedAt: string; createdAt: string }): number => {
  const ms = Date.parse(row.updatedAt || row.createdAt)
  return Number.isNaN(ms) ? 0 : ms
}

export function CommandPalette(): ReactElement {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const toggle = useUiStore((s) => s.toggleCommandPalette)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  // The project the search is scoped to (Arc-style chip), or null for everything.
  const [scopeId, setScopeId] = useState<number | null>(null)

  const projectsQuery = useVisibleProjects()
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])

  // Every visible project's repos, deduped — the universe the issue/PR search reads
  // from the store (no extra fetch when the dashboard already warmed it). Idle while
  // the palette is closed so it isn't fetching app-wide in the background.
  const allRepos = useMemo(() => {
    const seen = new Set<string>()
    const repos: { owner: string; name: string }[] = []
    for (const project of projects) {
      for (const repo of project.repos) {
        const key = repoKey(repo)
        if (seen.has(key)) continue
        seen.add(key)
        repos.push({ owner: repo.owner, name: repo.name })
      }
    }
    return repos
  }, [projects])
  const { issues } = useRepoIssues(open ? allRepos : NO_REPOS)
  const { pulls } = useRepoPulls(open ? allRepos : NO_REPOS)

  const projectById = useMemo(() => {
    const map = new Map<number, ProjectWithActions>()
    for (const project of projects) map.set(project.id, project)
    return map
  }, [projects])

  // Cmd/Ctrl+K opens the palette when the window is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  // Drop the scope if its project leaves the visible set (e.g. its tag is hidden).
  useEffect(() => {
    if (scopeId != null && !projectById.has(scopeId)) setScopeId(null)
  }, [scopeId, projectById])

  // Run a command, then close and reset so the next open starts fresh.
  const run = (action: () => void): void => {
    action()
    setOpen(false)
    setQuery('')
    setScopeId(null)
  }

  const scopedProject = scopeId != null ? projectById.get(scopeId) : undefined
  const scopeRepoKeys = useMemo(
    () => (scopedProject ? new Set(scopedProject.repos.map(repoKey)) : null),
    [scopedProject]
  )

  // Manual substring match — the palette filters its own items. Base UI only
  // filters when given an `items` prop (we don't), so this stays authoritative
  // while its Autocomplete still drives highlight + keyboard nav.
  const q = query.trim().toLowerCase()
  const matches = (text: string): boolean => q === '' || text.toLowerCase().includes(q)
  const matchRow = (row: IssueRow | PullRequestRow): boolean =>
    matches(row.title) || matches(`#${row.number}`) || matches(repoKey(row.repo))
  const inScope = (row: IssueRow | PullRequestRow): boolean =>
    !scopeRepoKeys || scopeRepoKeys.has(repoKey(row.repo))

  // Empty query → the few most recent; typing widens to all matches, capped.
  const limit = q === '' ? RECENT_COUNT : MAX_RESULTS
  const rank = (rows: (IssueRow | PullRequestRow)[]): typeof rows =>
    [...rows]
      .filter(inScope)
      .filter(matchRow)
      .sort((a, b) => recencyMs(b) - recencyMs(a))
      .slice(0, limit)
  const filteredIssues = rank(issues) as IssueRow[]
  const filteredPulls = rank(pulls) as PullRequestRow[]

  // Nav and projects only make sense unscoped — once you're inside a project the
  // search is about its issues/PRs.
  const navItems: { label: string; Icon: TablerIcon; go: () => void }[] = [
    { label: 'Dashboard', Icon: IconLayoutDashboard, go: () => navigate({ to: '/' }) },
    { label: 'Issues', Icon: IconCircleDot, go: () => navigate({ to: '/issues' }) },
    { label: 'Pull requests', Icon: IconGitPullRequest, go: () => navigate({ to: '/pulls' }) },
    { label: 'Settings', Icon: IconSettings, go: () => navigate({ to: '/settings' }) }
  ]
  const filteredNav = scopedProject ? [] : navItems.filter((item) => matches(item.label))
  const filteredProjects = scopedProject ? [] : projects.filter((project) => matches(project.name))

  const hasResults =
    filteredNav.length > 0 ||
    filteredProjects.length > 0 ||
    filteredIssues.length > 0 ||
    filteredPulls.length > 0

  // Tab scopes to the highlighted project; Backspace on an empty input lifts the
  // scope. Capture phase so we preempt the command's own key handling. We read the
  // active row straight off the DOM (`data-highlighted`, set by Base UI) rather than
  // tracking it in state — `onItemHighlighted` lags the auto-highlight by one key.
  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault()
      const active = document.querySelector('[data-slot="command-item"][data-highlighted]')
      const id = active?.getAttribute('data-project-id')
      if (id && projectById.has(Number(id))) {
        setScopeId(Number(id))
        setQuery('')
      }
      return
    }
    if (event.key === 'Backspace' && query === '' && scopeId != null) {
      event.preventDefault()
      setScopeId(null)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery('')
          setScopeId(null)
        }
      }}
    >
      <CommandDialogPopup>
        <Command value={query} onValueChange={(value) => setQuery(value)}>
          {/* Capture keydown here to intercept Tab/Backspace before the input handles them. */}
          <div
            className="flex items-center gap-2 border-border border-b px-3 py-1.5"
            onKeyDownCapture={onInputKeyDown}
          >
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            {scopedProject && (
              <span className="flex shrink-0 items-center gap-1 rounded-md bg-accent py-1 pr-2 pl-1.5 font-medium text-accent-foreground text-sm">
                <ProjectIcon
                  icon={scopedProject.icon}
                  color={scopedProject.color}
                  size={11}
                  className="size-4"
                />
                {scopedProject.name}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <AutocompleteInput
                autoFocus
                size="lg"
                placeholder={
                  scopedProject ? `Search ${scopedProject.name}…` : 'Type a command or search…'
                }
                className="border-transparent! bg-transparent! shadow-none before:hidden has-focus-visible:ring-0"
              />
            </div>
          </div>

          <CommandList>
            {!hasResults && (
              <div className="py-6 text-center text-muted-foreground text-sm">
                {scopedProject
                  ? `No issues or pull requests in ${scopedProject.name}.`
                  : 'No results found.'}
              </div>
            )}

            {filteredNav.length > 0 && (
              <CommandGroup>
                <CommandGroupLabel>Go to</CommandGroupLabel>
                {filteredNav.map((item) => (
                  <CommandItem
                    key={`nav:${item.label}`}
                    value={`nav:${item.label}`}
                    className="gap-2"
                    onClick={() => run(item.go)}
                  >
                    <item.Icon className="size-4 text-muted-foreground" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filteredProjects.length > 0 && (
              <CommandGroup>
                <CommandGroupLabel>Projects</CommandGroupLabel>
                {filteredProjects.map((project) => (
                  <CommandItem
                    key={`project:${project.id}`}
                    value={`project:${project.id}`}
                    data-project-id={project.id}
                    className="gap-2"
                    onClick={() =>
                      run(() =>
                        navigate({
                          to: '/projects/$projectId',
                          params: { projectId: String(project.id) }
                        })
                      )
                    }
                  >
                    <ProjectIcon
                      icon={project.icon}
                      color={project.color}
                      size={13}
                      className="size-5"
                    />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">Tab to search</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filteredIssues.length > 0 && (
              <CommandGroup>
                <CommandGroupLabel>Issues</CommandGroupLabel>
                {filteredIssues.map((issue) => (
                  <CommandItem
                    key={`issue:${issue.url}`}
                    value={`issue:${issue.url}`}
                    className="gap-2"
                    onClick={() => run(() => window.open(issue.url, '_blank'))}
                  >
                    <IconCircleDot className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {repoKey(issue.repo)} #{issue.number}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filteredPulls.length > 0 && (
              <CommandGroup>
                <CommandGroupLabel>Pull requests</CommandGroupLabel>
                {filteredPulls.map((pull) => (
                  <CommandItem
                    key={`pull:${pull.url}`}
                    value={`pull:${pull.url}`}
                    className="gap-2"
                    onClick={() => run(() => window.open(pull.url, '_blank'))}
                  >
                    <IconGitPullRequest className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{pull.title}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {repoKey(pull.repo)} #{pull.number}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
