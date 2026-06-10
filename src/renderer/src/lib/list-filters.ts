import type { IssueRow, PullRequestRow } from '@/lib/project-types'

/**
 * A generic, client-side filter model for the issue/PR lists. A "field" (Type,
 * Author, …) derives its selectable options from the loaded rows and knows how
 * to test a row against a chosen set of values. Within one field the selected
 * values are OR'd; across fields the active filters are AND'd (see
 * {@link rowMatchesFilters}).
 */

/** Sentinel for the "no value set" option (No type / No label / No assignee …). */
export const NONE_VALUE = '__none__'

/** How an option renders its leading adornment in the value list. */
export type FilterOptionKind = 'user' | 'color' | 'project' | 'plain'

export interface FilterOption {
  value: string
  label: string
  kind: FilterOptionKind
  /** kind 'user': the avatar to show (absent/empty falls back to initials). */
  avatarUrl?: string | null
  /** kind 'color': a CSS color for the leading dot (labels, …). */
  color?: string
  /** kind 'project': the project's icon + color, for a {@link ProjectIcon}. */
  project?: { icon: string; color: string }
}

export interface FilterField<T> {
  id: string
  label: string
  /** Distinct, sorted options present in the rows (plus a None option when some
   *  row has the empty case). */
  buildOptions: (rows: T[]) => FilterOption[]
  /** Whether a row matches the chosen value set (OR within the set). */
  matches: (row: T, selected: ReadonlySet<string>) => boolean
}

/** One active filter: a field and the values selected for it. */
export interface ActiveFilter {
  fieldId: string
  values: string[]
}

type NamedUser = { login: string; avatarUrl: string | null }

/** Distinct users across the rows (by login), as user options, plus a trailing
 *  None option when some row has no user. `getUsers` normalizes the single vs.
 *  list shape (author → 0/1 users; assignees/reviewers → many). */
function userOptions<T>(
  rows: T[],
  getUsers: (row: T) => NamedUser[],
  noneLabel: string
): FilterOption[] {
  const byLogin = new Map<string, string | null>()
  let hasNone = false
  for (const row of rows) {
    const users = getUsers(row)
    if (users.length === 0) hasNone = true
    for (const user of users) if (!byLogin.has(user.login)) byLogin.set(user.login, user.avatarUrl)
  }
  const options: FilterOption[] = [...byLogin]
    .map(([login, avatarUrl]) => ({ value: login, label: login, kind: 'user' as const, avatarUrl }))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (hasNone) options.push({ value: NONE_VALUE, label: noneLabel, kind: 'plain' })
  return options
}

/** Match helper for a user field: empty → None selected; else any login in set. */
function userMatches(users: NamedUser[], selected: ReadonlySet<string>): boolean {
  if (users.length === 0) return selected.has(NONE_VALUE)
  return users.some((user) => selected.has(user.login))
}

const issueAuthor = (issue: IssueRow): NamedUser[] => (issue.author ? [issue.author] : [])
const pullAuthor = (pull: PullRequestRow): NamedUser[] => (pull.author ? [pull.author] : [])

export const ISSUE_FILTER_FIELDS: FilterField<IssueRow>[] = [
  {
    id: 'type',
    label: 'Type',
    buildOptions: (rows) => {
      const names = new Set<string>()
      let hasNone = false
      for (const issue of rows) {
        if (issue.type) names.add(issue.type.name)
        else hasNone = true
      }
      const options: FilterOption[] = [...names]
        .map((name) => ({ value: name, label: name, kind: 'plain' as const }))
        .sort((a, b) => a.label.localeCompare(b.label))
      if (hasNone) options.push({ value: NONE_VALUE, label: 'No type', kind: 'plain' })
      return options
    },
    matches: (issue, selected) =>
      issue.type ? selected.has(issue.type.name) : selected.has(NONE_VALUE)
  },
  {
    id: 'labels',
    label: 'Labels',
    buildOptions: (rows) => {
      const byName = new Map<string, string>()
      let hasNone = false
      for (const issue of rows) {
        if (issue.labels.length === 0) hasNone = true
        for (const label of issue.labels)
          if (!byName.has(label.name)) byName.set(label.name, label.color)
      }
      const options: FilterOption[] = [...byName]
        .map(([name, color]) => ({
          value: name,
          label: name,
          kind: 'color' as const,
          color: `#${color}`
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
      if (hasNone) options.push({ value: NONE_VALUE, label: 'No label', kind: 'plain' })
      return options
    },
    matches: (issue, selected) =>
      issue.labels.length === 0
        ? selected.has(NONE_VALUE)
        : issue.labels.some((label) => selected.has(label.name))
  },
  {
    id: 'author',
    label: 'Author',
    buildOptions: (rows) => userOptions(rows, issueAuthor, 'No author'),
    matches: (issue, selected) => userMatches(issueAuthor(issue), selected)
  },
  {
    id: 'assignees',
    label: 'Assignees',
    buildOptions: (rows) => userOptions(rows, (issue) => issue.assignees, 'No assignee'),
    matches: (issue, selected) => userMatches(issue.assignees, selected)
  }
]

export const PULL_FILTER_FIELDS: FilterField<PullRequestRow>[] = [
  {
    id: 'conflict',
    label: 'Conflict',
    buildOptions: () => [
      { value: 'yes', label: 'Yes', kind: 'plain' },
      { value: 'no', label: 'No', kind: 'plain' }
    ],
    matches: (pull, selected) => selected.has(pull.mergeable === 'CONFLICTING' ? 'yes' : 'no')
  },
  {
    id: 'author',
    label: 'Author',
    buildOptions: (rows) => userOptions(rows, pullAuthor, 'No author'),
    matches: (pull, selected) => userMatches(pullAuthor(pull), selected)
  },
  {
    id: 'assignees',
    label: 'Assignees',
    buildOptions: (rows) => userOptions(rows, (pull) => pull.assignees, 'No assignee'),
    matches: (pull, selected) => userMatches(pull.assignees, selected)
  },
  {
    id: 'reviewers',
    label: 'Reviewers',
    buildOptions: (rows) => userOptions(rows, (pull) => pull.reviewers, 'No reviewer'),
    matches: (pull, selected) => userMatches(pull.reviewers, selected)
  }
]

/** Resolve active filters to their fields + value sets, dropping unknown/empty
 *  ones, so the per-row test (run for every row) does no map/array work. */
export function compileFilters<T>(
  active: ActiveFilter[],
  fields: FilterField<T>[]
): { field: FilterField<T>; set: Set<string> }[] {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const compiled: { field: FilterField<T>; set: Set<string> }[] = []
  for (const filter of active) {
    const field = byId.get(filter.fieldId)
    if (field && filter.values.length > 0) compiled.push({ field, set: new Set(filter.values) })
  }
  return compiled
}

/** A row passes when it matches every active filter (AND across fields). */
export function rowMatchesFilters<T>(
  row: T,
  compiled: { field: FilterField<T>; set: Set<string> }[]
): boolean {
  return compiled.every((entry) => entry.field.matches(row, entry.set))
}
