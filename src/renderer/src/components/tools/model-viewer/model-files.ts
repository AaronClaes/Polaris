// Small, dependency-free helpers for naming and base64 — the renderer-side bits
// that survived moving the optimize/export pipeline to the main process.

/** Output filename for a model: original basename with a `.glb` extension. */
export function glbName(name: string): string {
  return `${name.replace(/\.(glb|gltf|obj)$/i, '')}.glb`
}

/** Best-effort image mime from a filename, for texture overrides without a type. */
export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'ktx2') return 'image/ktx2'
  return 'image/png'
}

/** Base64-encode in chunks so a large buffer doesn't blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Decode base64 (an optimized GLB coming back from main) into bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
