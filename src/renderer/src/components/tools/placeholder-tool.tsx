import type { ReactElement } from 'react'

/**
 * A minimal example tool. It exists so the Tools grid and both launch modes
 * (in-app and window) render end-to-end before any real tool is built — delete
 * it once a real tool is registered. The framework renders the identity header
 * and the surrounding chrome, so a tool component only renders its own body.
 */
export function PlaceholderTool(): ReactElement {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        This is a placeholder tool. The framework around it — the registry, the grid, and the in-app
        and windowed launches — is in place.
      </p>
      <p className="text-muted-foreground">
        Register a real tool in{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">lib/tools.ts</code> and drop its
        component in <code className="rounded bg-muted px-1 py-0.5 text-xs">components/tools/</code>
        .
      </p>
    </div>
  )
}
