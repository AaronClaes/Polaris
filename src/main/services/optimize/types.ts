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
  /** Estimated texture GPU memory (VRAM). Unlike textureBytes, this is what the
   *  textures cost once uploaded — the number KTX2 actually reduces (normal images
   *  decode to RGBA8 regardless of disk size; KTX2 stays GPU-compressed). */
  textureVramBytes: number
}

export const DRACO_DEFAULTS: DracoOptions = {
  quantizePosition: 14,
  quantizeNormal: 10,
  quantizeTexcoord: 12
}

// --- Standalone image (texture) optimize ---------------------------------------
// The texture viewer reuses the optimize utilityProcess/result-cache, but operates
// on a single image rather than a glTF Document. Same format set as the model
// optimizer's texture compression, minus the per-slot color/data auto-detection —
// a lone image has no slot, so KTX2 exposes an explicit normal-map toggle instead.

export const imageFormatSchema = z.enum(['keep', 'webp', 'avif', 'png', 'jpeg', 'ktx2'])

export const imageOptimizeOptionsSchema = z.object({
  format: imageFormatSchema,
  /** Lossy quality 0–1. Ignored for 'keep' and 'png' (lossless). */
  quality: z.number().min(0).max(1),
  /** Max width/height in px; larger images are downscaled (aspect kept). 0 = no cap. */
  maxSize: z.number().int().min(0),
  /** KTX2 only: encode as a normal/linear map (UASTC) rather than color (ETC1S). */
  ktx2Normal: z.boolean().default(false)
})

/** Where the worker reads an image from: a disk path (preferred — no byte transfer)
 *  or base64 bytes. `mime` helps classify KTX2, which sharp can't read. */
export const imageSourceSchema = z
  .object({
    path: z.string().optional(),
    base64: z.string().optional(),
    mime: z.string().optional()
  })
  .refine((s) => s.path != null || s.base64 != null, {
    message: 'Image source needs a path or base64 bytes.'
  })

export type ImageFormat = z.infer<typeof imageFormatSchema>
export type ImageOptimizeOptions = z.infer<typeof imageOptimizeOptionsSchema>
export type ImageSource = z.infer<typeof imageSourceSchema>

export interface ImageStats {
  /** Human label: PNG / JPEG / WebP / AVIF / KTX2 / … */
  format: string
  fileBytes: number
  width: number
  height: number
  /** Estimated GPU memory once uploaded — RGBA8 for raster images, far less for
   *  KTX2 (it stays GPU-compressed). The number disk size hides. */
  vramBytes: number
}
