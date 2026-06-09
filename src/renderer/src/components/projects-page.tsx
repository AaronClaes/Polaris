import { IconPlanet, IconPlus, IconSearch } from '@tabler/icons-react'
import { type ReactElement, useId, useMemo, useState } from 'react'
import { CreateProjectDialog } from '@/components/create-project-dialog'
import { ProjectCard } from '@/components/project-card'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { trpc } from '@/lib/trpc'

/** The full project launcher: searchable grid of project cards with a create entry. */
export function ProjectsPage(): ReactElement {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((project) => {
      const haystack = `${project.name} ${project.description ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [projects, query])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Projects</h1>
          <p className="mt-0.5 text-muted-foreground text-sm">
            Open a project or launch one of its actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InputGroup className="w-56">
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
            <InputGroupInput
              id={searchId}
              type="search"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          <CreateProjectDialog
            trigger={
              <Button>
                <IconPlus />
                New project
              </Button>
            }
          />
        </div>
      </header>

      {projects.length === 0 ? (
        <Empty className="rounded-2xl border border-border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconPlanet />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              Create your first project to start launching things.
            </EmptyDescription>
          </EmptyHeader>
          <CreateProjectDialog
            trigger={
              <Button>
                <IconPlus />
                Create a project
              </Button>
            }
          />
        </Empty>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-border border-dashed px-4 py-12 text-center text-muted-foreground text-sm">
          No projects match “{query}”.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}
