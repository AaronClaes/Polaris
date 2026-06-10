/**
 * Client-side sort for the issue/PR lists. The four sortable fields are common
 * to both row shapes, so one model serves every list. The sort runs within each
 * assignment section (the lists are bucketed first), not across the whole view.
 */

export type SortFieldId = 'updatedAt' | 'createdAt' | 'number' | 'title'
export type SortDirection = 'asc' | 'desc'

export interface SortState {
  field: SortFieldId
  direction: SortDirection
}

export interface SortFieldDef {
  id: SortFieldId
  label: string
}

export const SORT_FIELDS: SortFieldDef[] = [
  { id: 'updatedAt', label: 'Last updated' },
  { id: 'createdAt', label: 'Created' },
  { id: 'number', label: 'Number' },
  { id: 'title', label: 'Title' }
]

/** Default: most recently updated first — matches the order GitHub returns. */
export const DEFAULT_SORT: SortState = { field: 'updatedAt', direction: 'desc' }

/** The fields any sortable row must expose (both IssueRow and PullRequestRow do). */
type Sortable = { updatedAt: string; createdAt: string; number: number; title: string }

/** Compare two rows on a field in its natural (ascending) order: oldest /
 *  lowest number / A→Z first. ISO 8601 timestamps compare correctly as strings. */
function compare(a: Sortable, b: Sortable, field: SortFieldId): number {
  switch (field) {
    case 'title':
      return a.title.localeCompare(b.title)
    case 'number':
      return a.number - b.number
    case 'createdAt':
      return a.createdAt.localeCompare(b.createdAt)
    default:
      return a.updatedAt.localeCompare(b.updatedAt)
  }
}

/** A new copy of `rows` in the requested order; `desc` reverses the natural one.
 *  Array.sort is stable, so rows equal on the field keep their incoming order. */
export function sortRows<T extends Sortable>(rows: T[], sort: SortState): T[] {
  const dir = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => compare(a, b, sort.field) * dir)
}
