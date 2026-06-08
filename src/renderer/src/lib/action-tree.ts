import type { ActionGroupRow, ProjectActionRow } from '@/lib/project-types'

/**
 * A root-level entry in a project's action list — either an action group or a
 * loose (ungrouped) action. Groups and loose actions share one `sortOrder`
 * sequence so they can be freely interleaved.
 */
export type RootEntry =
  | { kind: 'group'; sortOrder: number; group: ActionGroupRow }
  | { kind: 'action'; sortOrder: number; action: ProjectActionRow }

/**
 * Merge a project's groups and its loose actions into one list ordered by their
 * shared root `sortOrder`. `looseActions` is expected to already be filtered to
 * ungrouped actions (and to whatever visibility the caller wants); group members
 * are not represented here — they live within their group.
 */
export function buildRootEntries(
  groups: ActionGroupRow[],
  looseActions: ProjectActionRow[]
): RootEntry[] {
  const entries: RootEntry[] = [
    ...groups.map((group) => ({
      kind: 'group' as const,
      sortOrder: group.sortOrder,
      group
    })),
    ...looseActions.map((action) => ({
      kind: 'action' as const,
      sortOrder: action.sortOrder,
      action
    }))
  ]
  return entries.sort((a, b) => a.sortOrder - b.sortOrder)
}
