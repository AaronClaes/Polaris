import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
// Type-only import of the main router — erased at build (no main code is bundled).
import type { AppRouter } from '../../../main/trpc/router'

// The optimize option/stat shapes flow from the main tRPC router, so there's a
// single source of truth: the renderer infers them rather than redeclaring.
type Inputs = inferRouterInputs<AppRouter>
type Outputs = inferRouterOutputs<AppRouter>

export type OptimizeOptions = Inputs['optimize']['run']['options']
export type TextureFormat = OptimizeOptions['textureFormat']
export type GeometryCompression = OptimizeOptions['geometry']
/** What the worker reads from: a disk path (preferred) or base64 bytes (fallback). */
export type ModelInput = Inputs['optimize']['run']['source']
export type OptimizeStats = Outputs['optimize']['run']['before']
/** A completed optimize/export: a result id (bytes live in main) plus stats. */
export type OptimizeResult = Outputs['optimize']['run']

export const DRACO_DEFAULTS: OptimizeOptions['draco'] = {
  quantizePosition: 14,
  quantizeNormal: 10,
  quantizeTexcoord: 12
}
