import { IconSparkles, type TablerIcon } from '@tabler/icons-react'
import type { ComponentType } from 'react'
import { PlaceholderTool } from '@/components/tools/placeholder-tool'

/**
 * A tool is a built-in mini app, not user data — so the registry is plain code,
 * not a DB table. Adding a tool is a one-line entry here plus its component under
 * `components/tools/`. Each tool renders only its own body; the framework
 * supplies the chrome for both launch modes (in-app via {@link ToolLayout},
 * windowed via {@link ToolWindowLayout}).
 */
export interface ToolDef {
  /** URL slug — the `$toolId` route param for both the in-app and window routes. */
  id: string
  name: string
  description: string
  Icon: TablerIcon
  Component: ComponentType
  /** Opening size of the standalone window launch (the in-app launch ignores it). */
  window: { width: number; height: number }
}

export const TOOLS: ToolDef[] = [
  {
    id: 'placeholder',
    name: 'Placeholder tool',
    description: 'A starter tool wired into the framework. Replace it with the real thing.',
    Icon: IconSparkles,
    Component: PlaceholderTool,
    window: { width: 760, height: 580 }
  }
]

const byId = new Map(TOOLS.map((tool) => [tool.id, tool]))

/** Resolve a registered tool by its slug, or `undefined` for an unknown id. */
export function toolById(id: string): ToolDef | undefined {
  return byId.get(id)
}
