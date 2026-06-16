import { IconBan, IconPlus, IconTrash, IconWorld } from '@tabler/icons-react'
import { type ReactElement, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EmailBlockRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** The add row: type an address or `@domain`, then Enter or Add. Owns its create
 *  mutation so it can reset on success and show a validation/duplicate error inline
 *  (the pattern is normalized server-side, shared with the contacts list). */
function AddBlockRow({ onAdded }: { onAdded: () => void }): ReactElement {
  const [pattern, setPattern] = useState('')

  const create = trpc.emailBlocklist.create.useMutation({
    onSuccess: () => {
      setPattern('')
      onAdded()
    }
  })

  const canAdd = pattern.trim().length > 0
  const submit = (): void => {
    if (canAdd) create.mutate({ pattern: pattern.trim() })
  }

  return (
    <div className="border-border border-b">
      <div className="flex items-center gap-2 px-3 py-2">
        <IconPlus className="size-4 shrink-0 text-muted-foreground" />
        <Input
          unstyled
          size="sm"
          className="flex-1"
          placeholder="noreply@news.com or @news.com"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={pattern}
          onChange={(event) => setPattern(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <Button size="sm" disabled={!canAdd} loading={create.isPending} onClick={submit}>
          Add
        </Button>
      </div>
      {create.error && (
        <p className="px-3 pb-2 text-destructive-foreground text-xs">{create.error.message}</p>
      )}
    </div>
  )
}

/** One blocked sender: a kind glyph, the pattern + a one-line hint, and a delete
 *  button on hover. No project picker — a block is global. */
function BlockRow({
  block,
  pendingDelete,
  onDelete
}: {
  block: EmailBlockRow
  pendingDelete: boolean
  onDelete: (id: number) => void
}): ReactElement {
  const isWildcard = block.pattern.startsWith('@')
  const Icon = isWildcard ? IconWorld : IconBan
  const hint = isWildcard ? `Any sender at ${block.pattern.slice(1)}` : 'Single address'

  return (
    <li className="group flex items-center gap-3 border-border border-b px-3 py-2 last:border-b-0 hover:bg-accent/50">
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon size={14} stroke={1.75} />
      </span>
      <div className="grid min-w-0 flex-1">
        <span className="truncate font-medium text-sm">{block.pattern}</span>
        <span className="truncate text-muted-foreground text-xs">{hint}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Unblock ${block.pattern}`}
        title="Unblock"
        loading={pendingDelete}
        className={cn(
          'shrink-0 text-destructive-foreground opacity-0 transition-opacity',
          'hover:bg-destructive/10 hover:text-destructive-foreground group-hover:opacity-100'
        )}
        onClick={() => onDelete(block.id)}
      >
        <IconTrash />
      </Button>
    </li>
  )
}

/**
 * The email blocklist: senders (full addresses or `@domain` wildcards) kept out of
 * the inbox feed. A block hides a sender unless the thread also involves a contact
 * (a known contact always matters), so a noisy domain can be blocked wholesale
 * while a single linked contact at that domain still shows.
 */
export function EmailBlocklist(): ReactElement {
  const utils = trpc.useUtils()
  const blocksQuery = trpc.emailBlocklist.list.useQuery()
  const blocks = blocksQuery.data ?? []

  const invalidate = (): Promise<void> => utils.emailBlocklist.list.invalidate()
  const remove = trpc.emailBlocklist.delete.useMutation({ onSuccess: invalidate })
  const pendingDeleteId = remove.isPending ? remove.variables?.id : undefined

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <AddBlockRow onAdded={invalidate} />
      {blocksQuery.isLoading ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm">Loading…</p>
      ) : blocks.length === 0 ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm">
          Nothing blocked. Add an address or a domain to hide its mail.
        </p>
      ) : (
        <ul>
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              pendingDelete={pendingDeleteId === block.id}
              onDelete={(id) => remove.mutate({ id })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
