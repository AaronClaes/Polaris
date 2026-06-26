import type { Document } from '@gltf-transform/core'
import { WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import type { ModelSource, TextureOverride } from './load-model'

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

/** Base64-encode in chunks so a large GLB doesn't blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

// One shared IO instance. ALL_EXTENSIONS + the meshopt decoder/encoder let us read
// meshopt-compressed inputs and *preserve* their compression on write: gltf-transform
// keeps the EXT_meshopt_compression extension on the doc and re-encodes it (no
// recompress / re-quantize step — re-running meshopt() on already-quantized data
// drifts badly, but read→write is byte-for-byte faithful). Draco isn't registered —
// its browser encoder is a separate effort — so Draco inputs are gated out upstream.
let ioPromise: Promise<WebIO> | null = null
export function getIO(): Promise<WebIO> {
  ioPromise ??= (async (): Promise<WebIO> => {
    await MeshoptDecoder.ready
    await MeshoptEncoder.ready
    return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder
    })
  })()
  return ioPromise
}

/** Read a self-contained glTF/GLB File into a gltf-transform Document. */
export async function readDocument(io: WebIO, source: ModelSource): Promise<Document> {
  if (source.kind === 'glb') {
    return io.readBinary(new Uint8Array(await source.file.arrayBuffer()))
  }
  return io.readJSON({ json: JSON.parse(await source.file.text()), resources: {} })
}

/**
 * Swap any replaced textures into a Document via `Texture.setImage` (the canonical
 * API) — every material that referenced the texture picks up the new image.
 * Overrides are keyed by `img-<index>` (the glTF image index), which lines up with
 * gltf-transform's texture order: each `Texture` maps to one glTF image.
 */
export async function applyTextureOverrides(
  doc: Document,
  overrides: Record<string, TextureOverride>
): Promise<void> {
  const textures = doc.getRoot().listTextures()
  for (const [id, override] of Object.entries(overrides)) {
    const index = Number.parseInt(id.replace('img-', ''), 10)
    const texture = textures[index]
    if (!texture) continue
    texture.setImage(new Uint8Array(await override.blob.arrayBuffer()))
    texture.setMimeType(override.blob.type || mimeFromName(override.filename))
  }
}

/**
 * Export the model as a GLB with any replaced textures baked in. The original file
 * is reparsed and only the swapped textures' image bytes are replaced; everything
 * else is written through untouched, and meshopt compression is preserved as-is.
 * Self-contained glTF/GLB only; Draco-compressed input is gated out upstream.
 */
export async function exportModel(
  source: ModelSource,
  overrides: Record<string, TextureOverride>
): Promise<Uint8Array> {
  const io = await getIO()
  const doc = await readDocument(io, source)
  await applyTextureOverrides(doc, overrides)
  return io.writeBinary(doc)
}
