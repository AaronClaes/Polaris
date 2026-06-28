import sharp from 'sharp'

// Shared KTX2 (Basis) encoding for the model and image optimizers. KTX2 stays
// GPU-compressed in VRAM, unlike WebP/AVIF which decode to raw RGBA on upload.
// Color maps use ETC1S (sRGB) at the chosen quality; normal/linear "data" maps
// use UASTC (Zstd-supercompressed, normal-mode) to keep precision. Mipmaps are
// generated. The Basis encoder is the external `ktx2-encoder` WASM (self-hosting
// its own wasm), loaded via dynamic import so it stays a runtime dependency, not
// bundled. Only jpeg/png/webp byte inputs are supported by the encoder.

/** Decode any sharp-readable image to raw RGBA — the decoder the Basis encoder
 *  needs in Node (it has no browser ImageBitmap). */
export async function decodeRgba(
  buffer: Uint8Array
): Promise<{ width: number; height: number; data: Uint8Array }> {
  const { data, info } = await sharp(Buffer.from(buffer))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/** Encode image bytes (jpeg/png/webp) to a KTX2 container. `normal` selects the
 *  UASTC normal-map path; otherwise ETC1S color at `quality` (0–1). */
export async function encodeKtx2(
  image: Uint8Array,
  opts: { normal: boolean; quality: number }
): Promise<Uint8Array> {
  const { encodeToKTX2 } = await import('ktx2-encoder')
  const bytes = opts.normal
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
        qualityLevel: Math.max(1, Math.min(255, Math.round(opts.quality * 255))),
        isPerceptual: true,
        isSetKTX2SRGBTransferFunc: true,
        generateMipmap: true
      })
  return new Uint8Array(bytes)
}
