// Image format label / extension / mime helpers shared by the model and texture
// tools — so a texture's format reads the same wherever it's shown.

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

/** Human label (PNG / JPEG / WebP / …) from a mime type, falling back to the
 *  filename's extension. */
export function imageFormatLabel(mime: string, filename = ''): string {
  const m = mime.toLowerCase()
  if (m.includes('png')) return 'PNG'
  if (m.includes('jpeg') || m.includes('jpg')) return 'JPEG'
  if (m.includes('webp')) return 'WebP'
  if (m.includes('ktx2')) return 'KTX2'
  if (m.includes('avif')) return 'AVIF'
  if (m.includes('gif')) return 'GIF'
  if (m.includes('bmp')) return 'BMP'
  if (m.includes('tga')) return 'TGA'
  return extOf(filename).toUpperCase() || 'Image'
}

/** File extension for a mime type, for naming an extracted/downloaded image. */
export function extFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('ktx2')) return 'ktx2'
  if (m.includes('avif')) return 'avif'
  if (m.includes('gif')) return 'gif'
  if (m.includes('bmp')) return 'bmp'
  return 'bin'
}

/** Best-effort image mime from a filename, for files without a type. */
export function mimeFromName(name: string): string {
  const ext = extOf(name)
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'ktx2') return 'image/ktx2'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}
