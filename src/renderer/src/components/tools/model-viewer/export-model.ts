import { WebIO } from '@gltf-transform/core'
import type { ModelSource, TextureOverride } from './load-model'

function mimeFromName(name: string): string {
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

/**
 * Export the model as a GLB with any replaced textures baked in. The original
 * file is reparsed with gltf-transform and only the swapped textures' image bytes
 * are replaced (via `Texture.setImage`, the canonical API) — every material that
 * referenced the texture picks up the new image, and everything else is written
 * through untouched. glTF/GLB only, self-contained input (no external `.bin` /
 * loose textures); compressed geometry (Draco/meshopt) is gated out upstream
 * because writing it back without the encoders would decompress and bloat it.
 *
 * Overrides are keyed by `img-<index>` (the glTF image index), which lines up
 * with gltf-transform's texture order — each `Texture` maps to one glTF image.
 */
export async function exportModel(
  source: ModelSource,
  overrides: Record<string, TextureOverride>
): Promise<Uint8Array> {
  const io = new WebIO()
  const doc =
    source.kind === 'glb'
      ? await io.readBinary(new Uint8Array(await source.file.arrayBuffer()))
      : await io.readJSON({ json: JSON.parse(await source.file.text()), resources: {} })

  const textures = doc.getRoot().listTextures()
  for (const [id, override] of Object.entries(overrides)) {
    const index = Number.parseInt(id.replace('img-', ''), 10)
    const texture = textures[index]
    if (!texture) continue
    texture.setImage(new Uint8Array(await override.blob.arrayBuffer()))
    texture.setMimeType(override.blob.type || mimeFromName(override.filename))
  }

  return io.writeBinary(doc)
}
