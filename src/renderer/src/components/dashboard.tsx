import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ProjectCard } from '@/components/project-card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { trpc } from '@/lib/trpc'

// The dashboard greets by name; there's no user profile yet, so this is fixed.
const USER_NAME = 'Aaron'

/** A time-of-day greeting: morning 5–12, afternoon 12–17, evening 17–22, else night. */
function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 22) return 'Good evening'
  return 'Good night'
}

/**
 * The home dashboard: a time-of-day greeting over a preview of pinned projects.
 * Built to grow — more sections will join the projects one over time. The full,
 * searchable project list lives on the Projects page (the "View all" link).
 */
export function Dashboard(): ReactElement {
  const projectsQuery = trpc.projects.list.useQuery()
  const projects = projectsQuery.data ?? []
  const pinned = projects.filter((project) => project.pinned)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-8 py-10">
      <div className="flex flex-col gap-6">
        <h1 className="font-heading font-semibold text-4xl tracking-tight">
          {greeting(new Date().getHours())}, {USER_NAME}
        </h1>
        <Separator />
      </div>

      {pinned.length > 0 && (
        <section className="flex flex-col gap-4">
          <header className="flex items-center justify-between gap-3">
            <h2 className="font-heading font-semibold text-lg tracking-tight">Projects</h2>
            <Button variant="ghost" size="sm" render={<Link to="/projects" />}>
              View all
              <IconChevronRight />
            </Button>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {pinned.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
