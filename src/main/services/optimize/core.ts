import { stat } from 'node:fs/promises'
import { type Document, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  dedup,
  draco,
  flatten,
  join,
  meshopt,
  prune,
  textureCompress,
  weld
} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import type { ModelSource, OptimizeOptions, OptimizeStats, TextureOverrideInput } from './types'

// Slot patterns for textureCompress. Color maps are sRGB (lossy WebP is fine);
// data maps are linear and must stay lossless or normals/AO/roughness corrupt.
const COLOR_SLOTS = /baseColor|emissive/i
const DATA_SLOTS = /normal|occlusion|metallicRoughness/i

// One shared IO with ALL_EXTENSIONS + the nodejs meshopt/Draco encoders/decoders —
// so meshopt- and Draco-compressed inputs read, round-trip, and can be switched
// between schemes. Unlike the old renderer path, the nodejs Draco build locates its
// own wasm via fs, so there's no wasmBinary plumbing.
let ioPromise: Promise<NodeIO> | null = null
function getIO(): Promise<NodeIO> {
  ioPromise ??= (async (): Promise<NodeIO> => {
    await MeshoptDecoder.ready
    await MeshoptEncoder.ready
    const [dracoDecoder, dracoEncoder] = await Promise.all([
      draco3d.createDecoderModule(),
      draco3d.createEncoderModule()
    ])
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
      'draco3d.decoder': dracoDecoder,
      'draco3d.encoder': dracoEncoder
    })
  })()
  return ioPromise
}

async function readDocument(io: NodeIO, source: ModelSource): Promise<Document> {
  if (source.path) return io.read(source.path)
  if (source.base64) return io.readBinary(new Uint8Array(Buffer.from(source.base64, 'base64')))
  throw new Error('Model source needs a path or base64 bytes.')
}

/** Size attributed to the input model — the main file's bytes, matching the
 *  renderer's old before-stat (sidecars aren't counted). */
async function inputSize(source: ModelSource): Promise<number> {
  if (source.path) return (await stat(source.path)).size
  if (source.base64) return Buffer.byteLength(source.base64, 'base64')
  return 0
}

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

/** Swap replaced textures in by glTF image index (lines up with listTextures). */
async function applyTextureOverrides(
  doc: Document,
  overrides: TextureOverrideInput[]
): Promise<void> {
  const textures = doc.getRoot().listTextures()
  for (const override of overrides) {
    const texture = textures[override.index]
    if (!texture) continue
    texture.setImage(new Uint8Array(Buffer.from(override.base64, 'base64')))
    texture.setMimeType(override.mime)
  }
}

/**
 * Drop any existing geometry compression so the chosen scheme is authoritative —
 * the IO decodes geometry to plain accessors on read but keeps the extension
 * attached (it would re-encode on write), so disposing it lets us write
 * uncompressed or switch schemes without ending up with both. No-op when clean.
 */
function clearGeometryCompression(doc: Document): void {
  for (const extension of doc.getRoot().listExtensionsUsed()) {
    const name = extension.extensionName
    if (name === 'EXT_meshopt_compression' || name === 'KHR_draco_mesh_compression') {
      extension.dispose()
    }
  }
}

/**
 * Re-encode / downscale textures with sharp via gltf-transform's textureCompress.
 * The chosen format applies to color maps — lossy at the given quality, except PNG
 * which is inherently lossless. Data maps (normal/occlusion/metal-rough) are always
 * re-encoded as lossless WebP regardless of the color format: it preserves their
 * precision and avoids the very slow lossless-AVIF / huge lossless-PNG encodes.
 * 'keep' only resizes.
 */
async function compressTextures(doc: Document, options: OptimizeOptions): Promise<void> {
  const cap = options.maxTextureSize
  const resize: [number, number] | undefined = cap > 0 ? [cap, cap] : undefined
  const format = options.textureFormat

  if (format === 'keep') {
    if (resize) await doc.transform(textureCompress({ encoder: sharp, resize }))
    return
  }

  // Color maps → chosen format (PNG ignores quality; WebP/AVIF/JPEG are lossy).
  const quality = Math.round(options.textureQuality * 100)
  await doc.transform(
    format === 'png'
      ? textureCompress({ encoder: sharp, targetFormat: 'png', resize, slots: COLOR_SLOTS })
      : textureCompress({
          encoder: sharp,
          targetFormat: format,
          quality,
          resize,
          slots: COLOR_SLOTS
        })
  )

  // Data maps → always lossless WebP, whatever the color format.
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      lossless: true,
      resize,
      slots: DATA_SLOTS
    })
  )
}

export interface OptimizeOutput {
  bytes: Uint8Array
  before: OptimizeStats
  after: OptimizeStats
}

/** Optimize a model: cleanup pass, texture re-encode/resize, then the chosen
 *  geometry compression. Any replaced textures are baked in. */
export async function optimizeModel(
  source: ModelSource,
  overrides: TextureOverrideInput[],
  options: OptimizeOptions
): Promise<OptimizeOutput> {
  const io = await getIO()
  const doc = await readDocument(io, source)
  const before = docStats(doc, await inputSize(source))

  await applyTextureOverrides(doc, overrides)
  await doc.transform(dedup(), flatten(), join(), weld(), prune())
  await compressTextures(doc, options)

  clearGeometryCompression(doc)
  if (options.geometry === 'meshopt') {
    await doc.transform(meshopt({ encoder: MeshoptEncoder }))
  } else if (options.geometry === 'draco') {
    await doc.transform(
      draco({
        quantizePosition: options.draco.quantizePosition,
        quantizeNormal: options.draco.quantizeNormal,
        quantizeTexcoord: options.draco.quantizeTexcoord
      })
    )
  }

  const bytes = await io.writeBinary(doc)
  return { bytes, before, after: docStats(doc, bytes.byteLength) }
}

/** Export a GLB with replaced textures baked in; existing compression preserved. */
export async function exportModel(
  source: ModelSource,
  overrides: TextureOverrideInput[]
): Promise<OptimizeOutput> {
  const io = await getIO()
  const doc = await readDocument(io, source)
  const before = docStats(doc, await inputSize(source))
  await applyTextureOverrides(doc, overrides)
  const bytes = await io.writeBinary(doc)
  return { bytes, before, after: docStats(doc, bytes.byteLength) }
}
