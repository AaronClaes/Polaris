import { IconPlanet, IconPlus } from '@tabler/icons-react'
import { createRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { CreateProjectDialog } from '@/components/create-project-dialog'
import { Button } from '@/components/ui/button'
import { rootRoute } from './__root'

function EmptyState(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <IconPlanet size={30} stroke={1.5} />
      </div>
      <div className="space-y-1">
        <h2 className="font-medium text-lg">No project selected</h2>
        <p className="text-muted-foreground text-sm">
          Pick a project from the sidebar, or create a new one.
        </p>
      </div>
      <CreateProjectDialog
        trigger={
          <Button>
            <IconPlus />
            Create a project
          </Button>
        }
      />
    </div>
  )
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: EmptyState
})
