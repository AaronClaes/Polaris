// Estimate GPU memory (VRAM) for textures — the cost the file-size stats hide.
// PNG/JPEG/WebP/AVIF all decode to raw RGBA8 (4 B/px) on the GPU, so on-disk size
// says nothing about VRAM. Only GPU-compressed (Basis/KTX2) textures stay small:
// ETC1S ≈ 0.5 B/px (BC1/ETC1 class), UASTC ≈ 1 B/px (BC7/ASTC class). A full mip
// chain adds ~1/3. These are estimates — the exact transcode target is
// device-dependent — but the 4–8× compressed-vs-RGBA8 gap holds everywhere.
//
// The bytes-per-pixel constants are mirrored in the main process (optimize/core.ts,
// which estimates the optimize before/after) so both surfaces report the same scale.

const BPP_RGBA8 = 4
const BPP_ETC1S = 0.5
const BPP_UASTC = 1
const MIP_FACTOR = 4 / 3

// three's GPU-compressed format constants are plain numbers; we only need to know
// whether the transcode target is a 4-bit (0.5 B/px) or 8-bit (1 B/px) block format.
// Kept here rather than importing every THREE.*_Format symbol just for a lookup.
const FOUR_BIT_FORMATS = new Set<number>([
  33776, // RGB_S3TC_DXT1_Format (BC1)
  33777, // RGBA_S3TC_DXT1_Format (BC1)
  36196, // RGB_ETC1_Format
  37492, // RGB_ETC2_Format
  35840, // RGB_PVRTC_4BPPV1_Format
  35842 // RGBA_PVRTC_4BPPV1_Format
])

/** Estimated VRAM bytes for a texture at a given size, storage cost, and mip state. */
export function estimateVramBytes(
  width: number | null,
  height: number | null,
  bytesPerPixel: number,
  hasMipmaps: boolean
): number {
  if (!width || !height) return 0
  return Math.round(width * height * bytesPerPixel * (hasMipmaps ? MIP_FACTOR : 1))
}

// Minimal shape of a live compressed texture we read for an accurate estimate.
interface MaybeCompressed {
  isCompressedTexture?: boolean
  format?: number
  mipmaps?: { length: number } | null
  generateMipmaps?: boolean
}

/** VRAM for one live texture, reading the true GPU format + mip state when the
 *  texture is GPU-compressed (KTX2 → CompressedTexture), else assuming RGBA8 with
 *  three's default runtime-generated mip chain. */
export function liveTextureVram(
  width: number | null,
  height: number | null,
  texture: MaybeCompressed | undefined
): number {
  if (texture?.isCompressedTexture) {
    const bpp = FOUR_BIT_FORMATS.has(texture.format ?? -1) ? BPP_ETC1S : BPP_UASTC
    return estimateVramBytes(width, height, bpp, (texture.mipmaps?.length ?? 1) > 1)
  }
  return estimateVramBytes(width, height, BPP_RGBA8, texture?.generateMipmaps ?? true)
}
