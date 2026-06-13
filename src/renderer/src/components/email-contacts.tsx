import { IconMail, IconPlus, IconTrash, IconWorld } from '@tabler/icons-react'
import { type ReactElement, useMemo, useState } from 'react'
import { type ProjectOption, ProjectPicker } from '@/components/project-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EmailContactRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'

/** The add row: type an address or `@domain`, optionally pick a project, then
 *  Enter or Add. Owns its own create mutation so it can reset on success and show
 *  a validation/duplicate error inline (the pattern is normalized server-side). */
function AddContactRow({
  projects,
  onAdded
}: {
  projects: ProjectOption[]
  onAdded: () => void
}): ReactElement {
  const [pattern, setPattern] = useState('')
  const [projectId, setProjectId] = useState<number | null>(null)

  const create = trpc.emailContacts.create.useMutation({
    onSuccess: () => {
      setPattern('')
      setProjectId(null)
      onAdded()
    }
  })

  const canAdd = pattern.trim().length > 0
  const submit = (): void => {
    if (canAdd) create.mutate({ pattern: pattern.trim(), projectId })
  }

  return (
    <div className="border-border border-b">
      <div className="flex items-center gap-2 px-3 py-2">
        <IconPlus className="size-4 shrink-0 text-muted-foreground" />
        <Input
          unstyled
          size="sm"
          className="flex-1"
          placeholder="name@clientA.com or @clientA.com"
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
        <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
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

/** One allowed sender: a kind glyph, the pattern + a one-line hint, an inline
 *  project picker to (re)file or unlink it, and a delete button on hover. */
function ContactRow({
  contact,
  projects,
  pendingDelete,
  onSetProject,
  onDelete
}: {
  contact: EmailContactRow
  projects: ProjectOption[]
  pendingDelete: boolean
  onSetProject: (id: number, projectId: number | null) => void
  onDelete: (id: number) => void
}): ReactElement {
  const isWildcard = contact.pattern.startsWith('@')
  const Icon = isWildcard ? IconWorld : IconMail
  const hint = isWildcard ? `Any sender at ${contact.pattern.slice(1)}` : 'Single address'

  return (
    <li className="group flex items-center gap-3 border-border border-b px-3 py-2 last:border-b-0 hover:bg-accent/50">
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon size={14} stroke={1.75} />
      </span>
      <div className="grid min-w-0 flex-1">
        <span className="truncate font-medium text-sm">{contact.pattern}</span>
        <span className="truncate text-muted-foreground text-xs">{hint}</span>
      </div>
      <ProjectPicker
        projects={projects}
        value={contact.projectId}
        onChange={(projectId) => onSetProject(contact.id, projectId)}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${contact.pattern}`}
        title="Remove"
        loading={pendingDelete}
        className={cn(
          'shrink-0 text-destructive-foreground opacity-0 transition-opacity',
          'hover:bg-destructive/10 hover:text-destructive-foreground group-hover:opacity-100'
        )}
        onClick={() => onDelete(contact.id)}
      >
        <IconTrash />
      </Button>
    </li>
  )
}

/**
 * The email allowlist: the senders (full addresses or `@domain` wildcards) whose
 * mail Polaris ingests. Each entry can be filed under a project or left unlinked
 * (still surfaces on the dashboard). One global list — the source of truth for
 * what email ever enters the app.
 */
export function EmailContacts(): ReactElement {
  const utils = trpc.useUtils()
  const contactsQuery = trpc.emailContacts.list.useQuery()
  const contacts = contactsQuery.data ?? []

  // Every project (the tag filter is a dashboard-focus tool, not a scope on what
  // you can link here), mapped to the picker's minimal shape.
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = useMemo<ProjectOption[]>(
    () =>
      (projectsQuery.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        icon: project.icon,
        color: project.color
      })),
    [projectsQuery.data]
  )

  const invalidate = (): Promise<void> => utils.emailContacts.list.invalidate()
  const setProject = trpc.emailContacts.setProject.useMutation({ onSuccess: invalidate })
  const remove = trpc.emailContacts.delete.useMutation({ onSuccess: invalidate })
  const pendingDeleteId = remove.isPending ? remove.variables?.id : undefined

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <AddContactRow projects={projects} onAdded={invalidate} />
      {contactsQuery.isLoading ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm">Loading…</p>
      ) : contacts.length === 0 ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-sm">
          No senders yet. Add an address or a domain above.
        </p>
      ) : (
        <ul>
          {contacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              projects={projects}
              pendingDelete={pendingDeleteId === contact.id}
              onSetProject={(id, projectId) => setProject.mutate({ id, projectId })}
              onDelete={(id) => remove.mutate({ id })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
