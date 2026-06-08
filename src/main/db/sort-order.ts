import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DB } from './client'
import { actionGroups, projectActions } from './schema'

/**
 * Highest `sortOrder` among a project's root entries — its action groups and its
 * loose (ungrouped) actions, which share one ordering sequence so the two can be
 * interleaved at the root level. Returns -1 when the project has neither, so
 * callers add 1 to append at the end. Group *members* number independently
 * within their group and are not considered here.
 */
export function maxRootSortOrder(db: DB, projectId: number): number {
  const groupMax =
    db
      .select({ max: sql<number | null>`max(${actionGroups.sortOrder})` })
      .from(actionGroups)
      .where(eq(actionGroups.projectId, projectId))
      .get()?.max ?? -1

  const looseMax =
    db
      .select({ max: sql<number | null>`max(${projectActions.sortOrder})` })
      .from(projectActions)
      .where(and(eq(projectActions.projectId, projectId), isNull(projectActions.groupId)))
      .get()?.max ?? -1

  return Math.max(groupMax, looseMax)
}
