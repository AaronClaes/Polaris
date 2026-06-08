import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import { db } from './client'

/**
 * Apply pending migrations from the generated `drizzle/` folder, then run any
 * one-time data backfills. Called once on app startup. In dev the folder lives
 * at the project root; when packaged it is shipped via electron-builder
 * `extraResources` into `process.resourcesPath`.
 */
export function runMigrations(): void {
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(process.cwd(), 'drizzle')

  migrate(db, { migrationsFolder })
  unifyRootActionOrder()
}

/**
 * One-time backfill: action groups and a project's loose (ungrouped) actions now
 * share a single root ordering sequence so they can interleave. Legacy rows
 * numbered the two independently (both from zero), so a group and a loose action
 * in the same project could share a `sort_order`. Renumber each affected
 * project's root entries into one 0-based sequence — groups first, then loose
 * actions — preserving the previous group-then-ungrouped appearance.
 *
 * Self-guarding rather than version-gated: once unified, every root entry's
 * `sort_order` is unique within its project, so a group/loose collision can only
 * exist in not-yet-unified data. That makes this safe to run on every startup
 * (it no-ops once there's nothing to fix) and, because it only touches colliding
 * data, it never disturbs an order the user has since rearranged. Group members
 * are left untouched.
 */
function unifyRootActionOrder(): void {
  const collision = db.get(sql`
    SELECT 1
    FROM action_groups g
    JOIN project_actions a
      ON a.project_id = g.project_id
     AND a.group_id IS NULL
     AND a.sort_order = g.sort_order
    LIMIT 1
  `)
  if (!collision) return

  db.transaction((tx) => {
    tx.run(sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY sort_order, id) - 1 AS rn
        FROM action_groups
      )
      UPDATE action_groups
      SET sort_order = (SELECT rn FROM ranked WHERE ranked.id = action_groups.id)
    `)
    tx.run(sql`
      WITH group_counts AS (
        SELECT project_id, COUNT(*) AS n FROM action_groups GROUP BY project_id
      ),
      ranked AS (
        SELECT id, project_id,
          ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY sort_order, id) - 1 AS rn
        FROM project_actions
        WHERE group_id IS NULL
      )
      UPDATE project_actions
      SET sort_order = (
        SELECT ranked.rn + COALESCE(
          (SELECT n FROM group_counts WHERE group_counts.project_id = ranked.project_id),
          0
        )
        FROM ranked
        WHERE ranked.id = project_actions.id
      )
      WHERE group_id IS NULL
    `)
  })
}
