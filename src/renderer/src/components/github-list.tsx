import { IconChevronDown, IconExternalLink, IconRefresh, IconSearch } from '@tabler/icons-react'
import {
  flexRender,
  getCoreRowModel,
  type RowData,
  type TableOptions,
  useReactTable
} from '@tanstack/react-table'
import { memo, type ReactElement, type ReactNode } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAbsolute, formatRelative } from '@/lib/relative-time'

declare module '@tanstack/react-table' {
  // Per-column CSS width for the fixed table layout. Omit to let the column
  // flex and absorb the remaining width (used by the title column).
  interface ColumnMeta<TData extends RowData, TValue> {
    width?: string
  }
}

type GitHubUser = { login: string; avatarUrl: string | null }

/** A single avatar that reveals the user's login on hover. Memoized so a search
 * re-render skips rows whose user object is unchanged. */
export const UserAvatar = memo(function UserAvatar({ user }: { user: GitHubUser }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Avatar className="size-6 ring-2 ring-background">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.login} />}
            <AvatarFallback>{user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        }
      />
      <TooltipPopup>{user.login}</TooltipPopup>
    </Tooltip>
  )
})

/** Stacked avatars for a set of GitHub users (assignees, reviewers, …). */
export const UserAvatars = memo(function UserAvatars({
  users
}: {
  users: GitHubUser[]
}): ReactElement | null {
  if (users.length === 0) return null
  const shown = users.slice(0, 3)
  const extra = users.length - shown.length
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((user) => (
        <UserAvatar key={user.login} user={user} />
      ))}
      {extra > 0 && <span className="pl-2.5 text-muted-foreground text-xs">+{extra}</span>}
    </div>
  )
})

/** The title cell shared by issues and PRs: title + number, repo underneath.
 * `leading` renders a status icon to the left (e.g. PR CI status); `trailing`
 * renders just after the number (e.g. a merge-conflict marker). */
export function TitleCell({
  title,
  number,
  owner,
  name,
  leading,
  trailing
}: {
  title: string
  number: number
  owner: string
  name: string
  leading?: ReactNode
  trailing?: ReactNode
}): ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      {leading}
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={<span className="min-w-0 truncate font-medium">{title}</span>}
            />
            <TooltipPopup>{title}</TooltipPopup>
          </Tooltip>
          <span className="shrink-0 text-muted-foreground text-xs">#{number}</span>
          {trailing}
        </div>
        <span className="truncate text-muted-foreground text-xs">
          {owner}/{name}
        </span>
      </div>
    </div>
  )
}

/** "opened … / updated …" as relative times, each with an absolute-time tooltip. */
export function Timestamps({
  createdAt,
  updatedAt
}: {
  createdAt: string
  updatedAt: string
}): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 whitespace-nowrap text-muted-foreground text-xs">
      <span title={formatAbsolute(createdAt)}>opened {formatRelative(createdAt)}</span>
      <span title={formatAbsolute(updatedAt)}>updated {formatRelative(updatedAt)}</span>
    </div>
  )
}

/** The trailing "open on GitHub" action button. */
export function OpenButton({ url }: { url: string }): ReactElement {
  return (
    <div className="flex justify-end">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open on GitHub"
        title="Open on GitHub"
        onClick={() => window.open(url, '_blank')}
      >
        <IconExternalLink />
      </Button>
    </div>
  )
}

/** A table over `rows` with a labelled header row. `columns` is typed via
 * TanStack's own option type so a single generic table serves every list
 * without an explicit `any`. */
export function DataTable<T>({
  rows,
  columns
}: {
  rows: T[]
  columns: TableOptions<T>['columns']
}): ReactElement {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  })
  return (
    <Table className="table-fixed">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                className="text-xs"
                style={{ width: header.column.columnDef.meta?.width }}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** A titled, collapsible box built on the vendored Collapsible. `keepMounted`
 * keeps the body in the DOM while collapsed, so toggling is a show/hide rather
 * than a table remount; the section starts open, so its rows mount once up front. */
export function CollapsibleSection({
  title,
  count,
  children
}: {
  title: string
  count: number
  children: ReactNode
}): ReactElement {
  return (
    <Collapsible
      defaultOpen
      render={<section className="overflow-hidden rounded-xl border border-border" />}
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50 data-panel-open:border-border data-panel-open:border-b">
        <IconChevronDown className="-rotate-90 size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-0" />
        <span className="font-medium text-sm">{title}</span>
        <span className="text-muted-foreground text-xs">{count}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel keepMounted>{children}</CollapsiblePanel>
    </Collapsible>
  )
}

/** Centered empty hint shown inside a section with no rows. */
export function EmptyHint({ children }: { children: ReactNode }): ReactElement {
  return <p className="px-3 py-4 text-center text-muted-foreground text-xs">{children}</p>
}

/** Toolbar: a client-side search box on the left, a manual refresh button on
 * the right. The search filters the already-loaded rows (no requery). `filter`
 * is an optional control rendered beside the search box (e.g. the global views'
 * project filter); `action` is an optional control to the right of Refresh
 * (e.g. the "New issue" / "New pull request" button). */
export function ListToolbar({
  isFetching,
  onRefresh,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filter,
  action
}: {
  isFetching: boolean
  onRefresh: () => void
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filter?: ReactNode
  action?: ReactNode
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <InputGroup className="w-64">
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            size="sm"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </InputGroup>
        {filter}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" loading={isFetching} onClick={onRefresh}>
          <IconRefresh />
          Refresh
        </Button>
        {action}
      </div>
    </div>
  )
}

/** Per-repo load failures, surfaced without failing the whole view. */
export function FailuresBanner({
  failures
}: {
  failures: { repo: string; message: string }[]
}): ReactElement | null {
  if (failures.length === 0) return null
  return (
    <div className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-xs">
      {failures.map((failure) => (
        <p key={failure.repo}>
          <span className="font-medium">{failure.repo}</span>: {failure.message}
        </p>
      ))}
    </div>
  )
}

/** Renders a loading spinner or error message, else the loaded children. */
export function QueryBoundary({
  isLoading,
  isError,
  errorMessage,
  loadingLabel,
  children
}: {
  isLoading: boolean
  isError: boolean
  errorMessage?: string
  loadingLabel: string
  children: ReactNode
}): ReactElement {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
        <Spinner className="size-4" />
        {loadingLabel}
      </div>
    )
  }
  if (isError) {
    return (
      <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
        Couldn't load. {errorMessage}
      </p>
    )
  }
  return <>{children}</>
}
