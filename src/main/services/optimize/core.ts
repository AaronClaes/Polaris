import { stat } from 'node:fs/promises'
import { type Document, NodeIO, type Texture } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import {
  dedup,
  draco,
  flatten,
  join,
  listTextureSlots,
  meshopt,
  prune,
  textureCompress,
  weld
} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { encodeKtx2 } from './ktx2'
import type { ModelSource, OptimizeOptions, OptimizeStats, TextureOverrideInput } from './types'
import { imageVramBytes } from './vram'

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

/** Estimated GPU memory for one texture, via the shared image-VRAM estimator
 *  (KTX2 read from its container, other images sized as RGBA8 by sharp). */
async function textureVram(texture: Texture): Promise<number> {
  const image = texture.getImage()
  if (!image) return 0
  return imageVramBytes(image, texture.getMimeType())
}

async function docStats(doc: Document, fileBytes: number): Promise<OptimizeStats> {
  let triangles = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      const position = prim.getAttribute('POSITION')
      if (indices) triangles += indices.getCount() / 3
      else if (position) triangles += position.getCount() / 3
    }
  }
  const textures = doc.getRoot().listTextures()
  let textureBytes = 0
  let textureVramBytes = 0
  for (const texture of textures) {
    textureBytes += texture.getImage()?.byteLength ?? 0
    textureVramBytes += await textureVram(texture)
  }
  return {
    fileBytes,
    triangles: Math.round(triangles),
    textures: textures.length,
    textureBytes,
    textureVramBytes
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

  if (format === 'ktx2') {
    await compressTexturesKtx2(doc, options, resize)
    return
  }

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

/**
 * Compress textures to KTX2 (KHR_texture_basisu) — GPU-compressed, so they stay
 * compressed in VRAM, unlike WebP/AVIF which decode to raw RGBA on the GPU. Color
 * maps use ETC1S (sRGB) at the chosen quality; data maps use UASTC (linear,
 * normal-mode) to keep normal/AO/metal-rough precision — mirroring the color-vs-data
 * split of the other formats (see {@link encodeKtx2}). Only jpeg/png/webp sources
 * are supported by the encoder; anything else (incl. already KTX2) is left as-is.
 * sharp resizes first since the encoder can't.
 */
async function compressTexturesKtx2(
  doc: Document,
  options: OptimizeOptions,
  resize: [number, number] | undefined
): Promise<void> {
  if (resize) await doc.transform(textureCompress({ encoder: sharp, resize }))

  const encodable = new Set(['image/jpeg', 'image/png', 'image/webp'])
  let converted = false

  for (const texture of doc.getRoot().listTextures()) {
    if (!encodable.has(texture.getMimeType())) continue
    const image = texture.getImage()
    if (!image) continue
    const slots = listTextureSlots(texture).join(' ')
    const isData = DATA_SLOTS.test(slots)
    const isColor = COLOR_SLOTS.test(slots)
    if (!isData && !isColor) continue

    const bytes = await encodeKtx2(image, { normal: isData, quality: options.textureQuality })
    texture.setImage(bytes).setMimeType('image/ktx2')
    converted = true
  }

  if (converted) doc.createExtension(KHRTextureBasisu).setRequired(true)
}

/** Ensure KHR_texture_basisu is registered whenever any texture ended up as KTX2
 *  (a swapped-in .ktx2 override, or KTX2 compression) so the GLB writes validly —
 *  belt-and-suspenders in case a cleanup pass dropped the extension. */
function ensureBasisuExtension(doc: Document): void {
  const hasKtx2 = doc
    .getRoot()
    .listTextures()
    .some((texture) => texture.getMimeType() === 'image/ktx2')
  const registered = doc
    .getRoot()
    .listExtensionsUsed()
    .some((extension) => extension.extensionName === 'KHR_texture_basisu')
  if (hasKtx2 && !registered) doc.createExtension(KHRTextureBasisu).setRequired(true)
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
  const before = await docStats(doc, await inputSize(source))

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

  ensureBasisuExtension(doc)
  const bytes = await io.writeBinary(doc)
  return { bytes, before, after: await docStats(doc, bytes.byteLength) }
}

/** Export a GLB with replaced textures baked in; existing compression preserved. */
export async function exportModel(
  source: ModelSource,
  overrides: TextureOverrideInput[]
): Promise<OptimizeOutput> {
  const io = await getIO()
  const doc = await readDocument(io, source)
  const before = await docStats(doc, await inputSize(source))
  await applyTextureOverrides(doc, overrides)
  ensureBasisuExtension(doc)
  const bytes = await io.writeBinary(doc)
  return { bytes, before, after: await docStats(doc, bytes.byteLength) }
}
