import { IconCube, IconKey, type TablerIcon } from '@tabler/icons-react'
import { type ComponentType, type LazyExoticComponent, lazy } from 'react'
import { SecretsGenerator } from '@/components/tools/secrets-generator'

// Heavy tools are code-split so three.js/drei (~1MB) only load when the viewer
// opens, not at app startup. The layouts wrap every tool body in a Suspense
// boundary, so a lazy Component just works.
const ModelViewer = lazy(() =>
  import('@/components/tools/model-viewer').then((m) => ({ default: m.ModelViewer }))
)

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
  Component: ComponentType | LazyExoticComponent<ComponentType>
  /** Opening size of the standalone window launch (the in-app launch ignores it). */
  window: { width: number; height: number }
  /**
   * Fill the available area edge-to-edge (window) / a tall framed canvas (in-app)
   * instead of flowing as a padded page column. For immersive tools like the 3D
   * viewer.
   */
  fullBleed?: boolean
}

export const TOOLS: ToolDef[] = [
  {
    id: 'secrets-generator',
    name: 'Secrets generator',
    description: 'Generate random keys at 32 to 512 bits in hex, base64, or alphanumeric.',
    Icon: IconKey,
    Component: SecretsGenerator,
    window: { width: 580, height: 680 }
  },
  {
    id: 'model-viewer',
    name: '3D model viewer',
    description: 'Drag in a glTF/GLB or OBJ model to orbit, inspect, and light it.',
    Icon: IconCube,
    Component: ModelViewer,
    window: { width: 1000, height: 760 },
    fullBleed: true
  }
]

const byId = new Map(TOOLS.map((tool) => [tool.id, tool]))

/** Resolve a registered tool by its slug, or `undefined` for an unknown id. */
export function toolById(id: string): ToolDef | undefined {
  return byId.get(id)
}
