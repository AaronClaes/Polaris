import * as THREE from 'three'
import { imageFormatLabel } from '../shared/image-format'
import { getKtx2Loader } from '../shared/ktx2-loader'
import { isKtx2File } from '../shared/ktx2-transcode'
import { sourceImageVram } from '../shared/vram'
import { extOf } from './texture-files'

// Raster textures are uploaded to the GPU at full quality up to this cap on the
// long edge. Anything larger is downscaled off-thread (createImageBitmap's resize)
// before upload — a 2D tiling/channel preview never needs more, and it keeps VRAM
// modest (≤~64 MB + mips at 4096² RGBA8) and uploads fast. KTX2 is exempt: it stays
// GPU-compressed (~16–32 MB even at 8K) and already ships a mip chain. Stats still
// report the texture's true resolution.
const UPLOAD_CAP = 4096

export interface TextureStats {
  /** Human label: PNG / JPEG / WebP / AVIF / KTX2 / … */
  format: string
  width: number
  height: number
  fileBytes: number
  /** Estimated GPU memory once uploaded — RGBA8 for raster, far less for KTX2. */
  vramBytes: number
}

export interface LoadedTexture {
  /** The GPU texture the preview samples (raster THREE.Texture or KTX2
   *  CompressedTexture). Null when the file can't be decoded in the browser (e.g.
   *  TGA) — it can still be optimized in the main process. */
  texture: THREE.Texture | null
  stats: TextureStats
  /** Raster images can be optimized; KTX2 can be viewed but not re-encoded. */
  optimizable: boolean
  dispose: () => void
}

/** Sampler/upload settings shared by every raster texture in the preview: raw
 *  (no color-space decode, so the channel view reads the stored bytes), top-down
 *  (row 0 = image top, matching KTX2), tiled, and mipmapped for clean minification. */
function configureRaster(texture: THREE.Texture): void {
  texture.flipY = false
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
}

/** Decode a raster file off-thread (createImageBitmap), downscaling to the upload
 *  cap when needed, and wrap the bitmap in a GPU texture. The full-resolution
 *  dimensions are reported separately for stats. */
async function rasterTexture(
  file: File
): Promise<{ texture: THREE.Texture; width: number; height: number; dispose: () => void }> {
  const full = await createImageBitmap(file)
  const width = full.width
  const height = full.height
  const scale = Math.min(1, UPLOAD_CAP / Math.max(width, height))
  let bitmap = full
  if (scale < 1) {
    bitmap = await createImageBitmap(full, {
      resizeWidth: Math.max(1, Math.round(width * scale)),
      resizeHeight: Math.max(1, Math.round(height * scale)),
      resizeQuality: 'high'
    })
    full.close()
  }
  const texture = new THREE.Texture(bitmap)
  configureRaster(texture)
  return {
    texture,
    width,
    height,
    dispose: () => {
      texture.dispose()
      bitmap.close()
    }
  }
}

/** Transcode a KTX2 file via the shared KTX2Loader (worker pool → GPU-compressed),
 *  off the main thread. Returns a CompressedTexture, tiled like the raster path. */
async function ktx2Texture(
  file: File
): Promise<{ texture: THREE.Texture; width: number; height: number; dispose: () => void }> {
  const url = URL.createObjectURL(file)
  try {
    const texture = await getKtx2Loader().loadAsync(url)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.needsUpdate = true
    return {
      texture,
      width: texture.image?.width ?? 0,
      height: texture.image?.height ?? 0,
      dispose: () => texture.dispose()
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Load an image file into a GPU texture for the viewer. KTX2 goes through the
 * worker-based KTX2Loader; everything else decodes off-thread via createImageBitmap.
 * No full-resolution pixel work touches the main thread, so loading and switching
 * stay responsive at any source size. Stats are measured at true resolution.
 */
export async function loadTexture(file: File): Promise<LoadedTexture> {
  if (isKtx2File(file)) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { texture, width, height, dispose } = await ktx2Texture(file)
    return {
      texture,
      stats: {
        format: 'KTX2',
        width,
        height,
        fileBytes: file.size,
        vramBytes: sourceImageVram({ bytes, mime: 'image/ktx2', width, height })
      },
      optimizable: false,
      dispose
    }
  }

  const mime = file.type || `image/${extOf(file.name)}`
  const format = imageFormatLabel(mime, file.name)
  try {
    const { texture, width, height, dispose } = await rasterTexture(file)
    return {
      texture,
      stats: {
        format,
        width,
        height,
        fileBytes: file.size,
        vramBytes: sourceImageVram({ mime, width, height })
      },
      optimizable: true,
      dispose
    }
  } catch {
    // Undecodable in the browser (e.g. TGA) — no preview; still optimizable in main.
    return {
      texture: null,
      stats: { format, width: 0, height: 0, fileBytes: file.size, vramBytes: 0 },
      optimizable: true,
      dispose: () => {}
    }
  }
}
