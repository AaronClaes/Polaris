import { IconArrowUpRight, IconCircleDot, IconGitPullRequest } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type ReactElement, useMemo, useState } from 'react'
import { GroupLauncher } from '@/components/group-launcher'
import { ProjectIcon } from '@/components/project-icon'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useRepoCounts } from '@/lib/github-queries'
import { getIcon } from '@/lib/icons'
import type { ProjectActionRow, ProjectWithActions } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** A launch tile: project identity, an open button, its groups and actions. */
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
    <Card className="gap-0 p-4">
      <div className="flex items-start gap-3">
        <ProjectIcon icon={project.icon} color={project.color} size={22} className="size-11" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-sm leading-tight">{project.name}</h3>
          {project.description && (
            <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{project.description}</p>
          )}
          {showCounts && (
            <div className="mt-2 flex items-center gap-3 text-muted-foreground text-xs">
              <span
                className="inline-flex items-center gap-1"
                title={`${counts.issues} open issues`}
              >
                <IconCircleDot className="size-3.5" />
                {counts.issues}
              </span>
              <span
                className="inline-flex items-center gap-1"
                title={`${counts.pulls} open pull requests`}
              >
                <IconGitPullRequest className="size-3.5" />
                {counts.pulls}
              </span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-1 shrink-0"
          aria-label={`Open ${project.name}`}
          title={`Open ${project.name}`}
          render={<Link to="/projects/$projectId" params={{ projectId: String(project.id) }} />}
        >
          <IconArrowUpRight />
        </Button>
      </div>

      {hasLaunchers && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {visibleGroups.map(({ group, visibleMembers }) => (
            <GroupLauncher
              key={group.id}
              group={group}
              actions={visibleMembers}
              onError={setRunError}
            />
          ))}
          {looseActions.map((action) => {
            const Icon = getIcon(action.icon).Icon
            return (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                loading={runAction.isPending && runAction.variables?.id === action.id}
                onClick={() => runAction.mutate({ id: action.id })}
              >
                <Icon />
                {action.label}
              </Button>
            )
          })}
        </div>
      )}

      {runError && (
        <p className="mt-3 rounded-md border border-destructive/36 bg-destructive/8 px-2.5 py-1.5 text-destructive-foreground text-xs">
          {runError}
        </p>
      )}
    </Card>
  )
}
