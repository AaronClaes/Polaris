import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { encodeKtx2 } from './ktx2'
import type { ImageOptimizeOptions, ImageSource, ImageStats } from './types'
import { imageVramBytes, isKtx2 } from './vram'

// Standalone image optimize/export, run in the optimize utilityProcess. Re-encodes
// and/or downscales a single texture with sharp, or encodes to GPU-compressed KTX2
// (Basis) via the shared encoder. KTX2 sources can't be re-read by sharp, so they
// are passed through unchanged (the renderer marks them non-optimizable, like OBJ
// in the model tool); everything else flows through sharp.

const FORMAT_LABELS: Record<string, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  jpg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  ktx2: 'KTX2',
  gif: 'GIF',
  bmp: 'BMP',
  tiff: 'TIFF'
}

function labelFor(format: string | undefined): string {
  if (!format) return 'Image'
  return FORMAT_LABELS[format.toLowerCase()] ?? format.toUpperCase()
}

/** File extension for a format label / chosen format, for naming the result. */
function extFor(format: string): string {
  const f = format.toLowerCase()
  if (f === 'jpeg' || f === 'jpg') return 'jpg'
  if (f === 'image') return 'bin'
  return f
}

function mimeForExt(ext: string): string {
  if (ext === 'jpg') return 'image/jpeg'
  if (ext === 'ktx2') return 'image/ktx2'
  return `image/${ext}`
}

async function readSource(source: ImageSource): Promise<{ bytes: Uint8Array; mime?: string }> {
  if (source.base64) {
    return { bytes: new Uint8Array(Buffer.from(source.base64, 'base64')), mime: source.mime }
  }
  if (source.path) return { bytes: new Uint8Array(await readFile(source.path)), mime: source.mime }
  throw new Error('Image source needs a path or base64 bytes.')
}

/** Display stats for encoded image bytes: KTX2 dims come from its container, all
 *  other formats from sharp. VRAM is the shared estimate. */
export async function imageStats(bytes: Uint8Array, mime?: string): Promise<ImageStats> {
  const fileBytes = bytes.byteLength
  const vramBytes = await imageVramBytes(bytes, mime)
  if (mime === 'image/ktx2' || isKtx2(bytes)) {
    try {
      const { read } = await import('ktx-parse')
      const container = read(bytes)
      return {
        format: 'KTX2',
        fileBytes,
        width: container.pixelWidth,
        height: container.pixelHeight,
        vramBytes
      }
    } catch {
      return { format: 'KTX2', fileBytes, width: 0, height: 0, vramBytes }
    }
  }
  try {
    const meta = await sharp(Buffer.from(bytes)).metadata()
    return {
      format: labelFor(meta.format),
      fileBytes,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      vramBytes
    }
  } catch {
    return { format: 'Image', fileBytes, width: 0, height: 0, vramBytes }
  }
}

export interface ImageOptimizeOutput {
  bytes: Uint8Array
  before: ImageStats
  after: ImageStats
}

/** Build the sharp pipeline once, with the optional downscale cap applied (fit
 *  inside the box, aspect preserved, never upscaled). */
function pipeline(bytes: Uint8Array, maxSize: number): sharp.Sharp {
  // `failOn: 'none'` keeps slightly malformed but viewable images from throwing.
  const p = sharp(Buffer.from(bytes), { failOn: 'none' })
  if (maxSize > 0) p.resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
  return p
}

async function encode(
  bytes: Uint8Array,
  before: ImageStats,
  options: ImageOptimizeOptions
): Promise<{ bytes: Uint8Array; ext: string }> {
  // KTX2 input can't be re-read by sharp — leave it as-is.
  if (before.format === 'KTX2') return { bytes, ext: 'ktx2' }

  const { format, maxSize } = options
  const quality = Math.round(options.quality * 100)

  if (format === 'ktx2') {
    // Resize via sharp first (the Basis encoder can't), then encode the PNG.
    const png = new Uint8Array(await pipeline(bytes, maxSize).png().toBuffer())
    return {
      bytes: await encodeKtx2(png, { normal: options.ktx2Normal, quality: options.quality }),
      ext: 'ktx2'
    }
  }

  if (format === 'keep') {
    // No conversion; only resize when capped. Untouched bytes when there's nothing
    // to do, so before/after match exactly.
    if (maxSize <= 0) return { bytes, ext: extFor(before.format) }
    return {
      bytes: new Uint8Array(await pipeline(bytes, maxSize).toBuffer()),
      ext: extFor(before.format)
    }
  }

  const p = pipeline(bytes, maxSize)
  if (format === 'png') p.png()
  else if (format === 'jpeg') p.jpeg({ quality, mozjpeg: true })
  else if (format === 'webp') p.webp({ quality })
  else if (format === 'avif') p.avif({ quality })
  return { bytes: new Uint8Array(await p.toBuffer()), ext: extFor(format) }
}

/** Optimize a single image: re-encode/resize/KTX2-encode per options, returning
 *  the new bytes plus before/after stats (the same shape the model optimizer uses
 *  for its preview). */
export async function optimizeImage(
  source: ImageSource,
  options: ImageOptimizeOptions
): Promise<ImageOptimizeOutput> {
  const { bytes, mime } = await readSource(source)
  const before = await imageStats(bytes, mime)
  const { bytes: out, ext } = await encode(bytes, before, options)
  const after = await imageStats(out, mimeForExt(ext))
  return { bytes: out, before, after }
}
