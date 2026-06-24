import { IconKey, type TablerIcon } from '@tabler/icons-react'
import type { ComponentType } from 'react'
import { SecretsGenerator } from '@/components/tools/secrets-generator'

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
    id: 'secrets-generator',
    name: 'Secrets generator',
    description: 'Generate random keys at 32 to 512 bits in hex, base64, or alphanumeric.',
    Icon: IconKey,
    Component: SecretsGenerator,
    window: { width: 580, height: 680 }
  }
]

const byId = new Map(TOOLS.map((tool) => [tool.id, tool]))

/** Resolve a registered tool by its slug, or `undefined` for an unknown id. */
export function toolById(id: string): ToolDef | undefined {
  return byId.get(id)
}
