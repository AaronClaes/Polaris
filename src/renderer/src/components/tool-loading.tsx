import type { ReactElement } from 'react'
import { Spinner } from '@/components/ui/spinner'

/** Suspense fallback for a lazily-loaded tool body (and any inner asset load). */
export function ToolLoading(): ReactElement {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground">
      <Spinner />
    </div>
  )
}
