import { KHR_DF_MODEL_UASTC, read as readKtx2Container } from 'ktx-parse'
import sharp from 'sharp'

// VRAM estimate shared by the model and image optimizers (and mirrored in the
// renderer's shared/vram.ts so every surface reports the same scale). Normal
// images decode to RGBA8 (4 B/px) on the GPU, so on-disk size says nothing about
// VRAM; only GPU-compressed KTX2 stays small — ETC1S ≈ 0.5, UASTC ≈ 1 B/px. A
// full mip chain adds ~1/3. The exact transcode target is device-dependent, so
// these are estimates, but the 4–8× compressed-vs-RGBA8 gap holds everywhere.
const BPP_RGBA8 = 4
const BPP_ETC1S = 0.5
const BPP_UASTC = 1
const MIP_FACTOR = 4 / 3

export function estimateVram(width: number, height: number, bpp: number, hasMips: boolean): number {
  if (!width || !height) return 0
  return Math.round(width * height * bpp * (hasMips ? MIP_FACTOR : 1))
}

// KTX2 file identifier: «KTX 20»\r\n\x1A\n — lets us classify without a mime hint.
const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]
export function isKtx2(bytes: Uint8Array): boolean {
  return bytes.length >= KTX2_MAGIC.length && KTX2_MAGIC.every((b, i) => bytes[i] === b)
}

/** Estimated GPU memory for one encoded image: KTX2 is read from its container
 *  (true size, ETC1S/UASTC, mip count); any other image decodes to RGBA8, sized
 *  via sharp. Returns 0 when the bytes can't be read. */
export async function imageVramBytes(bytes: Uint8Array, mime?: string): Promise<number> {
  try {
    if (mime === 'image/ktx2' || isKtx2(bytes)) {
      const container = readKtx2Container(bytes)
      const uastc = container.dataFormatDescriptor[0]?.colorModel === KHR_DF_MODEL_UASTC
      return estimateVram(
        container.pixelWidth,
        container.pixelHeight,
        uastc ? BPP_UASTC : BPP_ETC1S,
        container.levels.length > 1
      )
    }
    const meta = await sharp(Buffer.from(bytes)).metadata()
    return estimateVram(meta.width ?? 0, meta.height ?? 0, BPP_RGBA8, true)
  } catch {
    return 0
  }
}
