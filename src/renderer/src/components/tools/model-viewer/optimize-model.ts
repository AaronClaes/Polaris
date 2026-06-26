import type { Document } from '@gltf-transform/core'
import {
  dedup,
  flatten,
  getTextureColorSpace,
  join,
  meshopt,
  prune,
  weld
} from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { applyTextureOverrides, getIO, readDocument } from './export-model'
import type { ModelSource, TextureOverride } from './load-model'

export type TextureFormat = 'keep' | 'webp'
export type GeometryCompression = 'none' | 'meshopt'

export interface OptimizeOptions {
  textureFormat: TextureFormat
  /** WebP quality, 0–1. Ignored when textureFormat is 'keep'. */
  textureQuality: number
  /** Max width/height in px; textures above it are downscaled. 0 = no cap. */
  maxTextureSize: number
  geometry: GeometryCompression
}

export interface OptimizeStats {
  fileBytes: number
  triangles: number
  textures: number
  /** Sum of encoded texture image bytes — the main texture-size signal. */
  textureBytes: number
}

export interface OptimizeResult {
  bytes: Uint8Array
  before: OptimizeStats
  after: OptimizeStats
}

const CANVAS_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function docStats(doc: Document, fileBytes: number): OptimizeStats {
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      const position = prim.getAttribute('POSITION')
      if (indices) triangles += indices.getCount() / 3
      else if (position) triangles += position.getCount() / 3
    }
  }
  let textureBytes = 0
  for (const texture of doc.getRoot().listTextures()) {
    textureBytes += texture.getImage()?.byteLength ?? 0
  }
  return {
    fileBytes,
    triangles: Math.round(triangles),
    textures: doc.getRoot().listTextures().length,
    textureBytes
  }
}

/** Re-encode a single bitmap through an OffscreenCanvas. */
async function encodeBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mime: string,
  quality: number
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas context.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await canvas.convertToBlob(
    mime === 'image/webp' || mime === 'image/jpeg' ? { type: mime, quality } : { type: mime }
  )
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Re-encode / downscale textures in the browser via canvas (no native `sharp`).
 * Color maps (sRGB: base color, emissive) can go to lossy WebP; data maps
 * (normal / occlusion / metal-rough) are protected — only resized, and re-encoded
 * losslessly to PNG so compression artifacts don't corrupt their values.
 */
async function compressTextures(doc: Document, options: OptimizeOptions): Promise<void> {
  const wantWebp = options.textureFormat === 'webp'
  const cap = options.maxTextureSize
  if (!wantWebp && cap === 0) return

  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage()
    if (!image) continue
    const mime = texture.getMimeType()

    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: mime }))
    } catch {
      continue // undecodable (e.g. KTX2) — leave as-is
    }

    const { width, height } = bitmap
    const scale = cap > 0 ? Math.min(1, cap / Math.max(width, height)) : 1
    const needsResize = scale < 1
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))
    const isColor = getTextureColorSpace(texture) === 'srgb'

    // Decide output format, or skip when there's nothing to do.
    let outMime: string | null = null
    if (isColor && wantWebp) outMime = 'image/webp'
    else if (needsResize) outMime = isColor ? mime : 'image/png'
    if (!outMime) {
      bitmap.close()
      continue
    }
    if (!CANVAS_MIMES.has(outMime)) outMime = 'image/png'

    const encoded = await encodeBitmap(bitmap, targetW, targetH, outMime, options.textureQuality)
    bitmap.close()

    // If we didn't resize and the re-encode came out no smaller, keep the original.
    if (!needsResize && encoded.byteLength >= image.byteLength) continue
    texture.setImage(encoded).setMimeType(outMime)
  }
}

/**
 * Optimize a model and return the resulting GLB plus before/after stats. Runs
 * entirely in the renderer: a lossless cleanup pass (dedup / flatten / join /
 * weld / prune) always runs, then optional texture re-encode/resize and optional
 * Meshopt geometry compression. Any current texture replacements are baked in.
 */
export async function optimizeModel(
  source: ModelSource,
  overrides: Record<string, TextureOverride>,
  options: OptimizeOptions
): Promise<OptimizeResult> {
  const io = await getIO()
  const doc = await readDocument(io, source)
  const before = docStats(doc, source.file.size)

  await applyTextureOverrides(doc, overrides)
  await doc.transform(dedup(), flatten(), join(), weld(), prune())
  await compressTextures(doc, options)
  if (options.geometry === 'meshopt') {
    await doc.transform(meshopt({ encoder: MeshoptEncoder }))
  }

  const bytes = await io.writeBinary(doc)
  return { bytes, before, after: docStats(doc, bytes.byteLength) }
}
