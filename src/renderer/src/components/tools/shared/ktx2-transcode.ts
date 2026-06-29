// Decode KTX2 (Basis ETC1S/UASTC) textures to plain RGBA in the renderer, so the
// model inspector can show a 2D thumbnail of a compressed texture. Rendering and
// texture swaps instead go through KTX2Loader (see shared/ktx2-loader), which
// transcodes off-thread to a GPU-compressed format that can't be read back as
// pixels — so for a thumbnail we run the self-hosted Basis transcoder directly
// (public/basis, the same files KTX2Loader uses) and transcode to RGBA32.
//
// The transcoder is three's Emscripten build, a UMD script (not an ES module), so
// it's fetched and evaluated in a CommonJS shim to get its factory — exactly the
// path verified in the KTX2 spike. The Basis output is top-down (verified), so the
// RGBA maps straight into ImageData with no row flip. Needs CSP 'unsafe-eval'
// (already required by KTX2Loader's own transcoder worker).

// biome-ignore lint/suspicious/noExplicitAny: Emscripten module has no types
type BasisModule = any

const TF_RGBA32 = 13 // basis transcoder_texture_format cTFRGBA32

let modulePromise: Promise<BasisModule> | null = null

function loadBasis(): Promise<BasisModule> {
  modulePromise ??= (async (): Promise<BasisModule> => {
    const base = new URL('basis/', document.baseURI).href
    const [code, wasmBinary] = await Promise.all([
      fetch(`${base}basis_transcoder.js`).then((r) => r.text()),
      fetch(`${base}basis_transcoder.wasm`).then((r) => r.arrayBuffer())
    ])
    const shim = { exports: {} as (arg: { wasmBinary: ArrayBuffer }) => Promise<BasisModule> }
    // Evaluate three's UMD transcoder in a CommonJS shim to get its factory.
    new Function('module', 'exports', code)(shim, shim.exports)
    const Module = await shim.exports({ wasmBinary })
    Module.initializeBasis()
    return Module
  })()
  return modulePromise
}

export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

/** Transcode a KTX2 container's base level to RGBA32 (top-down, ready for ImageData). */
export async function transcodeKtx2(bytes: Uint8Array): Promise<Rgba> {
  const Module = await loadBasis()
  const file = new Module.KTX2File(bytes)
  try {
    if (!file.isValid()) throw new Error('Not a valid KTX2 file.')
    if (!file.startTranscoding()) throw new Error('KTX2 transcoding could not start.')
    const width = file.getWidth()
    const height = file.getHeight()
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, TF_RGBA32)
    const out = new Uint8Array(size)
    if (!file.transcodeImage(out, 0, 0, 0, TF_RGBA32, 0, -1, -1)) {
      throw new Error('KTX2 transcode failed.')
    }
    return { width, height, data: out }
  } finally {
    file.close()
    file.delete()
  }
}

export function toImageData(rgba: Rgba): ImageData {
  // Build with dimensions (allocates an ArrayBuffer-backed buffer) then copy the
  // transcoded bytes in — avoids the ArrayBufferLike/ArrayBuffer type mismatch.
  const image = new ImageData(rgba.width, rgba.height)
  image.data.set(rgba.data)
  return image
}

async function toPngUrl(rgba: Rgba): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = rgba.width
  canvas.height = rgba.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable.')
  ctx.putImageData(toImageData(rgba), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Failed to render KTX2 preview.')
  return URL.createObjectURL(blob)
}

/** A decodable preview of a KTX2 texture: a PNG object URL plus its dimensions. */
export async function ktx2PreviewUrl(
  bytes: Uint8Array
): Promise<{ url: string; width: number; height: number }> {
  const rgba = await transcodeKtx2(bytes)
  return { url: await toPngUrl(rgba), width: rgba.width, height: rgba.height }
}

export function isKtx2File(file: File): boolean {
  return file.type === 'image/ktx2' || /\.ktx2$/i.test(file.name)
}
