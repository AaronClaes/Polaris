import { z } from 'zod'

// Shared types + zod schemas for the optimize/export service. The router validates
// inputs with these; the renderer infers the option/stat shapes through tRPC, so
// there's no separate renderer-side copy to keep in sync.

export const textureFormatSchema = z.enum(['keep', 'webp', 'avif', 'png', 'jpeg', 'ktx2'])
export const geometryCompressionSchema = z.enum(['none', 'meshopt', 'draco'])

export const dracoOptionsSchema = z.object({
  quantizePosition: z.number().int().min(1).max(16),
  quantizeNormal: z.number().int().min(1).max(16),
  quantizeTexcoord: z.number().int().min(1).max(16)
})

export const optimizeOptionsSchema = z.object({
  textureFormat: textureFormatSchema,
  /** Lossy quality 0–1 for color maps. Ignored for 'keep' and 'png' (lossless). */
  textureQuality: z.number().min(0).max(1),
  /** Max width/height in px; larger textures are downscaled. 0 = no cap. */
  maxTextureSize: z.number().int().min(0),
  geometry: geometryCompressionSchema,
  draco: dracoOptionsSchema
})

/** Where the worker reads a model from: a path on disk (preferred — NodeIO resolves
 *  glTF sidecars from the same directory) or base64 bytes (for path-less in-memory
 *  sources, e.g. re-optimizing a model already loaded into the viewer; GLB only). */
export const modelSourceSchema = z
  .object({
    kind: z.enum(['glb', 'gltf']),
    path: z.string().optional(),
    base64: z.string().optional()
  })
  .refine((s) => s.path != null || s.base64 != null, {
    message: 'Model source needs a path or base64 bytes.'
  })

/** A replaced texture to bake in on export/optimize, keyed by glTF image index. */
export const textureOverrideSchema = z.object({
  index: z.number().int().min(0),
  base64: z.string(),
  mime: z.string()
})

export type TextureFormat = z.infer<typeof textureFormatSchema>
export type GeometryCompression = z.infer<typeof geometryCompressionSchema>
export type DracoOptions = z.infer<typeof dracoOptionsSchema>
export type OptimizeOptions = z.infer<typeof optimizeOptionsSchema>
export type ModelSource = z.infer<typeof modelSourceSchema>
export type TextureOverrideInput = z.infer<typeof textureOverrideSchema>

export interface OptimizeStats {
  fileBytes: number
  triangles: number
  textures: number
  /** Sum of encoded texture image bytes — the main texture-size signal. */
  textureBytes: number
}

export const DRACO_DEFAULTS: DracoOptions = {
  quantizePosition: 14,
  quantizeNormal: 10,
  quantizeTexcoord: 12
}
