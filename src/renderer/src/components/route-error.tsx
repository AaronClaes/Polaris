import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconRefresh,
  IconTrash
} from '@tabler/icons-react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { type ReactElement, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { persister, queryClient } from '@/lib/query-client'
import { cn } from '@/lib/utils'

/** Whatever was thrown, reduced to a one-line headline + the full detail to show
 * when expanded. A real Error keeps its stack (which already starts with the
 * message); anything else is stringified so nothing is silently swallowed. */
function describe(error: unknown): { headline: string; detail: string } {
  if (error instanceof Error) {
    const headline = error.message || error.name
    return { headline, detail: error.stack || headline }
  }
  return {
    headline: 'Unknown error',
    detail: typeof error === 'string' ? error : JSON.stringify(error, null, 2)
  }
}

/**
 * The router's `defaultErrorComponent`: a calm, full-area fallback for any render
 * error in a route. "Try again" re-renders the boundary — enough for a transient
 * throw; "Clear cached data & reload" wipes the persisted query cache and
 * restarts, which is the real fix when an out-of-date cached shape is what
 * crashed us (see CACHE_BUSTER in main.tsx). The raw error sits behind a toggle
 * so the default view stays clean.
 */
export function RouteError({ error, reset }: ErrorComponentProps): ReactElement {
  const [clearing, setClearing] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const { headline, detail } = describe(error)

  async function clearCacheAndReload(): Promise<void> {
    setClearing(true)
    // Drop the persisted snapshot and the in-memory cache, then restart the
    // renderer so every query refetches from scratch.
    await persister.removeClient()
    queryClient.clear()
    window.location.reload()
  }

  function copyError(): void {
    navigator.clipboard.writeText(detail).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Empty className="min-h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive-foreground">
          <IconAlertTriangle />
        </EmptyMedia>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>
          An unexpected error stopped this view from loading. Try again, or clear the cached data
          and reload if it keeps happening.
        </EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>
            <IconRefresh />
            Try again
          </Button>
          <Button variant="outline" loading={clearing} onClick={clearCacheAndReload}>
            <IconTrash />
            Clear cached data & reload
          </Button>
        </div>

        <Collapsible open={showDetails} onOpenChange={setShowDetails} className="w-full">
          <CollapsibleTrigger className="mx-auto flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <IconChevronRight
              className={cn('size-3.5 transition-transform', showDetails && 'rotate-90')}
            />
            {showDetails ? 'Hide details' : 'Show details'}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 flex items-start justify-between gap-2">
              <p className="wrap-break-word text-left font-medium text-destructive-foreground text-xs">
                {headline}
              </p>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Copy error"
                title={copied ? 'Copied' : 'Copy error'}
                onClick={copyError}
                className="shrink-0 text-muted-foreground"
              >
                {copied ? <IconCheck /> : <IconCopy />}
              </Button>
            </div>
            <pre className="mt-1.5 max-h-64 w-full overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-left font-mono text-[11px] text-muted-foreground leading-relaxed">
              {detail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </EmptyContent>
    </Empty>
  )
}
