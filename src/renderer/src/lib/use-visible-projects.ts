import { useMemo } from 'react'
import { trpc } from '@/lib/trpc'
import { useTagFilterStore } from '@/stores/tag-filter-store'

/**
 * The project list filtered to the currently-shown tags. Wraps `projects.list`
 * and drops any project whose assigned tag is turned off in the header. This is
 * the single chokepoint that hides a tagged project everywhere: every data
 * surface (dashboard, global Issues/PRs/Todos, sidebar, command palette) derives
 * its repos and todos from this list, so filtering here removes the project and
 * all its data at once. Untagged projects are always shown.
 *
 * Returns the underlying query object with its `data` already filtered, so a
 * caller swaps in this hook and keeps reading `.data` / `.isLoading` unchanged.
 */
export function useVisibleProjects() {
  const query = trpc.projects.list.useQuery()
  const disabledTagIds = useTagFilterStore((state) => state.disabledTagIds)
  const data = useMemo(
    () =>
      query.data?.filter(
        (project) => project.tagId == null || !disabledTagIds.includes(project.tagId)
      ),
    [query.data, disabledTagIds]
  )
  return { ...query, data }
}

/**
 * The ids of the projects currently visible under the tag filter. The one-liner
 * for filtering any per-project data that DOESN'T already flow through the
 * project list (issues/PRs do, via their repos; todos don't). Reach for this
 * before hand-rolling a `new Set(projects.map(...))` in a new component.
 */
export function useVisibleProjectIds(): Set<number> {
  const { data } = useVisibleProjects()
  return useMemo(() => new Set((data ?? []).map((project) => project.id)), [data])
}

/**
 * Every todo (`todos.listAll`), filtered to the visible projects — the
 * cross-project counterpart of {@link useVisibleProjects}. Use this instead of
 * `todos.listAll` directly anywhere todos are shown across projects, so a hidden
 * project's todos never leak. Unlinked todos (null `projectId`) carry no tag, so
 * they always show — the same rule untagged projects follow. Same shape as the
 * raw query, with `data` filtered.
 */
export function useVisibleTodos() {
  const query = trpc.todos.listAll.useQuery()
  const visibleIds = useVisibleProjectIds()
  const data = useMemo(
    () => query.data?.filter((todo) => todo.projectId == null || visibleIds.has(todo.projectId)),
    [query.data, visibleIds]
  )
  return { ...query, data }
}

/**
 * Every note (`notes.listAll`), filtered to the visible projects — the notes
 * counterpart of {@link useVisibleTodos}. Use this instead of `notes.listAll`
 * directly anywhere notes are shown across projects, so a hidden project's notes
 * never leak. Unlinked notes (null `projectId`) carry no tag, so they always
 * show — the same rule untagged projects follow. Same shape as the raw query,
 * with `data` filtered.
 */
export function useVisibleNotes() {
  const query = trpc.notes.listAll.useQuery()
  const visibleIds = useVisibleProjectIds()
  const data = useMemo(
    () => query.data?.filter((note) => note.projectId == null || visibleIds.has(note.projectId)),
    [query.data, visibleIds]
  )
  return { ...query, data }
}
