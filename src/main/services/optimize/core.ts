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
import { KHR_DF_MODEL_UASTC, read as readKtx2Container } from 'ktx-parse'
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

// VRAM estimate, mirrored from the renderer (model-viewer/vram.ts) so both surfaces
// report the same scale. Normal images decode to RGBA8 (4 B/px) on the GPU; KTX2
// stays GPU-compressed — ETC1S ≈ 0.5, UASTC ≈ 1 B/px. A full mip chain adds ~1/3.
// The exact transcode target is device-dependent, so this is an estimate.
const VRAM_BPP_RGBA8 = 4
const VRAM_BPP_ETC1S = 0.5
const VRAM_BPP_UASTC = 1
const VRAM_MIP_FACTOR = 4 / 3

function estimateVram(width: number, height: number, bpp: number, hasMips: boolean): number {
  if (!width || !height) return 0
  return Math.round(width * height * bpp * (hasMips ? VRAM_MIP_FACTOR : 1))
}

/** Estimated GPU memory for one texture: KTX2 is read from its container (true
 *  size, ETC1S/UASTC, mip count); other images decode to RGBA8, sized via sharp. */
async function textureVram(texture: Texture): Promise<number> {
  const image = texture.getImage()
  if (!image) return 0
  try {
    if (texture.getMimeType() === 'image/ktx2') {
      const container = readKtx2Container(image)
      const uastc = container.dataFormatDescriptor[0]?.colorModel === KHR_DF_MODEL_UASTC
      return estimateVram(
        container.pixelWidth,
        container.pixelHeight,
        uastc ? VRAM_BPP_UASTC : VRAM_BPP_ETC1S,
        container.levels.length > 1
      )
    }
    const meta = await sharp(Buffer.from(image)).metadata()
    return estimateVram(meta.width ?? 0, meta.height ?? 0, VRAM_BPP_RGBA8, true)
  } catch {
    return 0
  }
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

/** Decode any sharp-readable image to raw RGBA — the decoder the Basis encoder
 *  needs in Node (it has no browser ImageBitmap). */
async function decodeRgba(
  buffer: Uint8Array
): Promise<{ width: number; height: number; data: Uint8Array }> {
  const { data, info } = await sharp(Buffer.from(buffer))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/**
 * Compress textures to KTX2 (KHR_texture_basisu) — GPU-compressed, so they stay
 * compressed in VRAM, unlike WebP/AVIF which decode to raw RGBA on the GPU. Color
 * maps use ETC1S (sRGB) at the chosen quality; data maps use UASTC (linear,
 * normal-mode, Zstd-supercompressed) to keep normal/AO/metal-rough precision —
 * mirroring the color-vs-data split of the other formats. Mipmaps are generated.
 *
 * The Basis encoder is the external `ktx2-encoder` WASM (self-hosting its own wasm),
 * loaded via dynamic import so it stays a runtime dependency, not bundled. Only
 * jpeg/png/webp sources are supported by the encoder; anything else (incl. already
 * KTX2) is left as-is. sharp resizes first since the encoder can't.
 */
async function compressTexturesKtx2(
  doc: Document,
  options: OptimizeOptions,
  resize: [number, number] | undefined
): Promise<void> {
  if (resize) await doc.transform(textureCompress({ encoder: sharp, resize }))

  const { encodeToKTX2 } = await import('ktx2-encoder')
  const quality = Math.max(1, Math.min(255, Math.round(options.textureQuality * 255)))
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

    const bytes = isData
      ? await encodeToKTX2(image, {
          imageDecoder: decodeRgba,
          isKTX2File: true,
          isUASTC: true,
          uastcLDRQualityLevel: 2,
          enableRDO: true,
          needSupercompression: true,
          isNormalMap: true,
          isPerceptual: false,
          isSetKTX2SRGBTransferFunc: false,
          generateMipmap: true
        })
      : await encodeToKTX2(image, {
          imageDecoder: decodeRgba,
          isKTX2File: true,
          isUASTC: false,
          qualityLevel: quality,
          isPerceptual: true,
          isSetKTX2SRGBTransferFunc: true,
          generateMipmap: true
        })
    texture.setImage(new Uint8Array(bytes)).setMimeType('image/ktx2')
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
