import type { ImageFormat } from '@/lib/optimize'

// Naming + type helpers for the texture viewer. Generic format/mime helpers live
// in ../shared/image-format; these are the texture-tool-specific bits.

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tga', 'ktx2']
export const IMAGE_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.tga,.ktx2,image/png,image/jpeg,image/webp,image/avif,image/gif,image/bmp,image/ktx2'

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extOf(file.name))
}

/** File extension produced by optimizing to `format` ('keep' preserves the
 *  source's extension). */
export function extForFormat(format: ImageFormat, sourceName: string): string {
  if (format === 'keep') return extOf(sourceName) || 'bin'
  if (format === 'jpeg') return 'jpg'
  return format
}

/** Output filename after optimizing: original basename with the new extension. */
export function outputName(sourceName: string, ext: string): string {
  return `${sourceName.replace(/\.[^./\\]+$/, '')}.${ext}`
}

/** Mime for a produced extension, for wrapping optimized bytes as a File. */
export function mimeForExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'ktx2') return 'image/ktx2'
  if (e === 'tga') return 'image/x-tga'
  return `image/${e}`
}
