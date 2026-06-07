import { IconCircleDot, IconGitPullRequest } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type ReactElement, useMemo, useState } from 'react'
import { ACTION_ICON_CLASS, ActionIcon } from '@/components/action-icon'
import { GroupLauncher } from '@/components/group-launcher'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useRepoCounts } from '@/lib/github-queries'
import type { ProjectActionRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** A launch tile: the whole card opens the project; the counts deep-link to the
 *  Issues/Pull requests tabs, and the groups/actions launch in place. */
export function ProjectCard({ project }: { project: ProjectWithActions }): ReactElement {
  const [runError, setRunError] = useState<string | null>(null)

  // Linked repos drive the issue/PR counts — read from the shared per-repo cache
  // (warm from the persisted snapshot on launch), so this adds no extra fetch.
  const repos = useMemo(
    () => project.repos.map((repo) => ({ owner: repo.owner, name: repo.name })),
    [project.repos]
  )
  const counts = useRepoCounts(repos)
  const showCounts = repos.length > 0 && counts.issuesLoaded && counts.pullsLoaded

  // Only non-hidden items appear on the dashboard.
  const looseActions = useMemo(
    () => project.actions.filter((a) => a.groupId == null && !a.hidden),
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
  // A group shows when it isn't hidden and isn't empty; its launcher lists only
  // visible members (Run all still launches the whole group).
  const visibleGroups = useMemo(
    () =>
      project.groups
        .filter((g) => !g.hidden && (membersByGroup.get(g.id)?.length ?? 0) > 0)
        .map((g) => ({
          group: g,
          visibleMembers: (membersByGroup.get(g.id) ?? []).filter((m) => !m.hidden)
        })),
    [project.groups, membersByGroup]
  )

  const runAction = trpc.actions.run.useMutation({
    onSuccess: (result) => setRunError(result.ok ? null : (result.error ?? 'Action failed')),
    onError: (error) => setRunError(error.message)
  })

  const hasLaunchers = visibleGroups.length > 0 || looseActions.length > 0

  return (
    <Card className="relative gap-0 p-4 transition-colors hover:border-ring/60">
      {/* Stretched link: the whole card opens the project. It sits beneath the
          interactive bits (count links, launchers), which are lifted with z-10. */}
      <Link
        to="/projects/$projectId"
        params={{ projectId: String(project.id) }}
        aria-label={`Open ${project.name}`}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-start gap-3">
        <ProjectIcon icon={project.icon} color={project.color} size={22} className="size-11" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-sm leading-tight">{project.name}</h3>
          {project.description && (
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{project.description}</p>
          )}
          {showCounts && (
            <div className="relative z-10 mt-2 flex w-fit items-center gap-3 text-muted-foreground text-xs">
              <Link
                to="/projects/$projectId"
                params={{ projectId: String(project.id) }}
                search={{ tab: 'issues' }}
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                title={`${counts.issues} open issues`}
              >
                <IconCircleDot className="size-3.5" />
                {counts.issues}
              </Link>
              <Link
                to="/projects/$projectId"
                params={{ projectId: String(project.id) }}
                search={{ tab: 'pulls' }}
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                title={`${counts.pulls} open pull requests`}
              >
                <IconGitPullRequest className="size-3.5" />
                {counts.pulls}
              </Link>
            </div>
          )}
        </div>
      </div>

      {hasLaunchers && (
        <div className="relative z-10 mt-4 flex flex-wrap gap-1.5">
          {visibleGroups.map(({ group, visibleMembers }) => (
            <GroupLauncher
              key={group.id}
              group={group}
              actions={visibleMembers}
              onError={setRunError}
            />
          ))}
          {looseActions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              loading={runAction.isPending && runAction.variables?.id === action.id}
              onClick={() => runAction.mutate({ id: action.id })}
            >
              <ActionIcon action={action} className={ACTION_ICON_CLASS} />
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {runError && (
        <p className="relative z-10 mt-3 rounded-md border border-destructive/36 bg-destructive/8 px-2.5 py-1.5 text-destructive-foreground text-xs">
          {runError}
        </p>
      )}
    </Card>
  )
}
