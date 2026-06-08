import { IconChevronDown, IconPlus } from '@tabler/icons-react'
import { Fragment, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger
} from '@/components/ui/menu'

export type CreateKind = 'issue' | 'pull'

/** A repo to create against — just the path bits needed to build the URL. */
export interface RepoTarget {
  owner: string
  name: string
}

/** A labeled set of repos. The project tabs pass a single unlabeled group; the
 * global views pass one labeled group per project. */
export interface RepoGroup {
  key: string
  label?: string
  repos: RepoTarget[]
}

const KIND = {
  issue: { label: 'New issue', path: 'issues/new' },
  pull: { label: 'New pull request', path: 'compare' }
} as const

function openCreate(repo: RepoTarget, kind: CreateKind): void {
  // The main process routes window.open to the OS browser. GitHub normalizes
  // owner/name casing, so building from the stored repo identity is enough.
  window.open(`https://github.com/${repo.owner}/${repo.name}/${KIND[kind].path}`, '_blank')
}

/**
 * Primary "New issue" / "New pull request" action for an issues/PRs toolbar.
 * With a single linked repo it opens GitHub's create page directly; with several
 * it drops down a repo picker. Labeled groups render as sections (the global
 * views group by project); one group renders flat. Renders nothing with no repos.
 */
export function CreateOnGitHubButton({
  kind,
  groups
}: {
  kind: CreateKind
  groups: RepoGroup[]
}): ReactElement | null {
  const nonEmpty = groups.filter((group) => group.repos.length > 0)
  const all = nonEmpty.flatMap((group) => group.repos)
  if (all.length === 0) return null

  const { label } = KIND[kind]

  if (all.length === 1) {
    return (
      <Button size="sm" onClick={() => openCreate(all[0], kind)}>
        <IconPlus />
        {label}
      </Button>
    )
  }

  // Section the picker only when there's more than one labeled group to tell
  // apart (the global multi-project case); otherwise a flat list is cleaner.
  const grouped = nonEmpty.length > 1

  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" />}>
        <IconPlus />
        {label}
        <IconChevronDown />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-56">
        {grouped
          ? nonEmpty.map((group, index) => (
              <Fragment key={group.key}>
                {index > 0 && <MenuSeparator />}
                <MenuGroup>
                  {group.label && <MenuGroupLabel>{group.label}</MenuGroupLabel>}
                  {group.repos.map((repo) => (
                    <MenuItem
                      key={`${repo.owner}/${repo.name}`}
                      onClick={() => openCreate(repo, kind)}
                    >
                      {repo.owner}/{repo.name}
                    </MenuItem>
                  ))}
                </MenuGroup>
              </Fragment>
            ))
          : all.map((repo) => (
              <MenuItem key={`${repo.owner}/${repo.name}`} onClick={() => openCreate(repo, kind)}>
                {repo.owner}/{repo.name}
              </MenuItem>
            ))}
      </MenuPopup>
    </Menu>
  )
}
