import { createRoute } from '@tanstack/react-router'
import { FolderOpen, Plus } from 'lucide-react'
import { type FormEvent, type ReactElement, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { trpc } from '@/lib/trpc'
import { rootRoute } from './__root'

const EMPTY_FORM = {
  name: '',
  repoOwner: '',
  repoName: '',
  localPath: '',
  stagingUrl: '',
  productionUrl: '',
  hostingUrl: '',
  notes: ''
}

type ProjectForm = typeof EMPTY_FORM

function LabeledInput({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Input>): ReactElement {
  const id = useId()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
    </div>
  )
}

function ProjectsPage(): ReactElement {
  const utils = trpc.useUtils()
  const projectsQuery = trpc.projects.list.useQuery()
  const createProject = trpc.projects.create.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      setForm(EMPTY_FORM)
    }
  })
  const [openError, setOpenError] = useState<string | null>(null)
  const openInEditor = trpc.system.openInEditor.useMutation({
    onSuccess: (result) =>
      setOpenError(result.ok ? null : (result.error ?? 'Failed to open editor'))
  })

  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM)
  const update =
    (key: keyof ProjectForm) =>
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!form.name.trim()) return
    createProject.mutate(form)
  }

  const projects = projectsQuery.data ?? []

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Polaris</h1>
          <p className="text-muted-foreground text-sm">
            Your dev project command center.{' '}
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">⌘⇧P</kbd> for the
            command palette.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
          <CardDescription>
            Track a repo, its environments, and where it lives locally.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="add-project" className="grid gap-4" onSubmit={handleSubmit}>
            <LabeledInput
              label="Name"
              placeholder="Polaris"
              value={form.name}
              onChange={update('name')}
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <LabeledInput
                label="Repo owner"
                placeholder="aaronclaes"
                value={form.repoOwner}
                onChange={update('repoOwner')}
              />
              <LabeledInput
                label="Repo name"
                placeholder="polaris"
                value={form.repoName}
                onChange={update('repoName')}
              />
            </div>
            <LabeledInput
              label="Local path"
              placeholder="/Users/aaronclaes/projects/personal/polaris"
              value={form.localPath}
              onChange={update('localPath')}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <LabeledInput
                label="Staging URL"
                placeholder="https://staging…"
                value={form.stagingUrl}
                onChange={update('stagingUrl')}
              />
              <LabeledInput
                label="Production URL"
                placeholder="https://…"
                value={form.productionUrl}
                onChange={update('productionUrl')}
              />
              <LabeledInput
                label="Hosting URL"
                placeholder="https://vercel…"
                value={form.hostingUrl}
                onChange={update('hostingUrl')}
              />
            </div>
            <LabeledInput
              label="Notes"
              placeholder="Anything worth remembering"
              value={form.notes}
              onChange={update('notes')}
            />
          </form>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          <Button
            type="submit"
            form="add-project"
            loading={createProject.isPending}
            disabled={!form.name.trim()}
          >
            <Plus />
            Add project
          </Button>
        </CardFooter>
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">Projects</h2>
          <span className="text-muted-foreground text-xs">{projects.length} total</span>
        </div>

        {openError && (
          <p className="rounded-lg border border-destructive/36 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
            {openError}
          </p>
        )}

        {projectsQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No projects yet. Add your first one above.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardHeader>
                  <CardTitle className="text-base">{project.name}</CardTitle>
                  {(project.repoOwner || project.repoName) && (
                    <CardDescription>
                      {project.repoOwner}
                      {project.repoOwner && project.repoName ? '/' : ''}
                      {project.repoName}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  {project.localPath && (
                    <p
                      className="truncate font-mono text-muted-foreground text-xs"
                      title={project.localPath}
                    >
                      {project.localPath}
                    </p>
                  )}
                  {project.notes && <p className="text-muted-foreground">{project.notes}</p>}
                  <p className="text-muted-foreground text-xs">
                    Added {project.createdAt.toLocaleString()}
                  </p>
                </CardContent>
                <CardFooter className="border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!project.localPath}
                    loading={
                      openInEditor.isPending && openInEditor.variables?.path === project.localPath
                    }
                    onClick={() =>
                      project.localPath && openInEditor.mutate({ path: project.localPath })
                    }
                  >
                    <FolderOpen />
                    Open in editor
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProjectsPage
})
