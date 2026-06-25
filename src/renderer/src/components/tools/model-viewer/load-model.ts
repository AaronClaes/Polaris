import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

export interface ModelStats {
  triangles: number
  vertices: number
  meshes: number
  materials: number
  size: { x: number; y: number; z: number }
  fileBytes: number
}

/** One extractable texture: its original encoded bytes plus display metadata. */
export interface TextureInfo {
  id: string
  name: string
  /** Material usage (Base color / Normal / …), or null when unknown (e.g. OBJ). */
  slot: string | null
  /** Human label: PNG / JPEG / WebP / KTX2 / … */
  format: string
  width: number | null
  height: number | null
  byteSize: number
  /** True when the browser can't decode it for preview (KTX2/Basis, TGA, …). */
  compressed: boolean
  /** Object URL for an <img> preview, or null when not previewable. */
  previewUrl: string | null
  /** Original encoded bytes, for a faithful download. */
  blob: Blob
  /** Suggested download filename, with extension. */
  filename: string
}

export interface LoadedModel {
  object: THREE.Object3D
  stats: ModelStats
  textures: TextureInfo[]
  /** Free GPU resources, revoke blob URLs (model + texture previews). */
  dispose: () => void
}

// Minimal shape of the glTF JSON we read for texture extraction.
interface GltfJson {
  images?: { uri?: string; mimeType?: string; bufferView?: number; name?: string }[]
  textures?: { source?: number; extensions?: { KHR_texture_basisu?: { source?: number } } }[]
  materials?: {
    pbrMetallicRoughness?: {
      baseColorTexture?: { index?: number }
      metallicRoughnessTexture?: { index?: number }
    }
    normalTexture?: { index?: number }
    occlusionTexture?: { index?: number }
    emissiveTexture?: { index?: number }
  }[]
}

// glTF/GLB first, then OBJ — the formats v1 supports.
const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tga', 'ktx2']

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function basename(url: string): string {
  return decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? '').toLowerCase()
}

/** The model file to open from a dropped set: prefer glTF/GLB, then OBJ. */
function pickMainFile(files: File[]): File | null {
  for (const ext of MODEL_EXTENSIONS) {
    const match = files.find((file) => extOf(file.name) === ext)
    if (match) return match
  }
  return null
}

// One shared Draco loader — the decoder is self-hosted (see public/draco), so it
// works offline. The path resolves against the document base so it's correct
// under both the dev server (http) and file:// in the packaged app.
let dracoLoader: DRACOLoader | null = null
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath(new URL('draco/', document.baseURI).href)
  }
  return dracoLoader
}

function loadGltf(url: string, manager: THREE.LoadingManager): Promise<GLTF> {
  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(getDracoLoader())
  loader.setMeshoptDecoder(MeshoptDecoder)
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, (error) =>
      reject(error instanceof Error ? error : new Error('Failed to load glTF.'))
    )
  })
}

function loadObj(
  url: string,
  manager: THREE.LoadingManager,
  urlMap: Map<string, string>,
  files: File[]
): Promise<THREE.Object3D> {
  const objLoader = new OBJLoader(manager)
  const loadObject = (): Promise<THREE.Object3D> =>
    new Promise((resolve, reject) => {
      objLoader.load(url, resolve, undefined, (error) =>
        reject(error instanceof Error ? error : new Error('Failed to load OBJ.'))
      )
    })

  // OBJLoader doesn't auto-load the .mtl referenced inside the file, so wire up
  // the dropped one (if any) before loading geometry.
  const mtlFile = files.find((file) => extOf(file.name) === 'mtl')
  if (!mtlFile) return loadObject()
  const mtlUrl = urlMap.get(mtlFile.name.toLowerCase()) as string

  return new Promise((resolve, reject) => {
    new MTLLoader(manager).load(
      mtlUrl,
      (materials) => {
        materials.preload()
        objLoader.setMaterials(materials)
        loadObject().then(resolve, reject)
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error('Failed to load OBJ materials.'))
    )
  })
}

function formatLabel(mime: string, filename: string): string {
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

function extFromMime(mime: string): string {
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

/** Build a TextureInfo from a blob — decoding it for dimensions + preview, and
 *  flagging it as compressed (no preview) when the browser can't decode it. */
async function buildTextureInfo(args: {
  id: string
  name: string
  slot: string | null
  mime: string
  filename: string
  blob: Blob
}): Promise<TextureInfo> {
  let width: number | null = null
  let height: number | null = null
  let compressed = false
  let previewUrl: string | null = null
  try {
    const bitmap = await createImageBitmap(args.blob)
    width = bitmap.width
    height = bitmap.height
    bitmap.close()
    previewUrl = URL.createObjectURL(args.blob)
  } catch {
    compressed = true
  }
  return {
    id: args.id,
    name: args.name,
    slot: args.slot,
    format: formatLabel(args.mime, args.filename),
    width,
    height,
    byteSize: args.blob.size,
    compressed,
    previewUrl,
    blob: args.blob,
    filename: args.filename
  }
}

/** Map each glTF image index to the material slots that reference it. */
function buildUsageMap(json: GltfJson): Map<number, Set<string>> {
  const textures = json.textures ?? []
  const map = new Map<number, Set<string>>()
  const sourceOf = (texIndex?: number): number | undefined => {
    if (texIndex == null) return undefined
    const texture = textures[texIndex]
    return texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source
  }
  const add = (texIndex: number | undefined, label: string): void => {
    const source = sourceOf(texIndex)
    if (source == null) return
    if (!map.has(source)) map.set(source, new Set())
    map.get(source)?.add(label)
  }
  for (const material of json.materials ?? []) {
    add(material.pbrMetallicRoughness?.baseColorTexture?.index, 'Base color')
    add(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index, 'Metallic-roughness')
    add(material.normalTexture?.index, 'Normal')
    add(material.occlusionTexture?.index, 'Occlusion')
    add(material.emissiveTexture?.index, 'Emissive')
  }
  return map
}

/** Extract original texture bytes from a loaded glTF/GLB: embedded images come
 *  from their bufferView, external ones from the dropped files, data URIs are
 *  decoded. */
async function extractGltfTextures(gltf: GLTF, files: File[]): Promise<TextureInfo[]> {
  const json = gltf.parser.json as unknown as GltfJson
  const images = json.images ?? []
  if (images.length === 0) return []
  const usage = buildUsageMap(json)
  const out: TextureInfo[] = []

  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    try {
      let blob: Blob
      let mime: string
      let filename: string
      if (image.bufferView != null) {
        const bytes = (await gltf.parser.getDependency(
          'bufferView',
          image.bufferView
        )) as ArrayBuffer
        mime = image.mimeType ?? 'application/octet-stream'
        filename = `${image.name ?? `texture_${i}`}.${extFromMime(mime)}`
        blob = new Blob([bytes], { type: mime })
      } else if (image.uri?.startsWith('data:')) {
        blob = await (await fetch(image.uri)).blob()
        mime = blob.type || image.mimeType || 'application/octet-stream'
        filename = `${image.name ?? `texture_${i}`}.${extFromMime(mime)}`
      } else if (image.uri) {
        const file = files.find((f) => f.name.toLowerCase() === basename(image.uri as string))
        if (!file) continue
        blob = file
        mime = file.type || `image/${extOf(file.name)}`
        filename = file.name
      } else {
        continue
      }
      const slotSet = usage.get(i)
      out.push(
        await buildTextureInfo({
          id: `img-${i}`,
          name: image.name || filename,
          slot: slotSet && slotSet.size > 0 ? [...slotSet].join(', ') : null,
          mime,
          filename,
          blob
        })
      )
    } catch {
      // An image that can't be extracted just doesn't appear in the list.
    }
  }
  return out
}

/** OBJ has no embedded textures — list the dropped image files alongside it. */
async function extractObjTextures(files: File[]): Promise<TextureInfo[]> {
  const out: TextureInfo[] = []
  let i = 0
  for (const file of files) {
    if (!IMAGE_EXTENSIONS.includes(extOf(file.name))) continue
    try {
      out.push(
        await buildTextureInfo({
          id: `file-${i++}`,
          name: file.name,
          slot: null,
          mime: file.type || `image/${extOf(file.name)}`,
          filename: file.name,
          blob: file
        })
      )
    } catch {
      // Skip an image that can't be read.
    }
  }
  return out
}

function computeStats(object: THREE.Object3D, files: File[]): ModelStats {
  let triangles = 0
  let vertices = 0
  let meshes = 0
  const materials = new Set<THREE.Material>()

  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    meshes++
    const position = mesh.geometry.getAttribute('position')
    if (position) vertices += position.count
    if (mesh.geometry.index) triangles += mesh.geometry.index.count / 3
    else if (position) triangles += position.count / 3
    if (Array.isArray(mesh.material)) for (const m of mesh.material) materials.add(m)
    else if (mesh.material) materials.add(mesh.material)
  })

  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  return {
    triangles: Math.round(triangles),
    vertices,
    meshes,
    materials: materials.size,
    size: { x: size.x, y: size.y, z: size.z },
    fileBytes: files.reduce((sum, file) => sum + file.size, 0)
  }
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!material) continue
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}

/**
 * Load a model from a set of dropped/selected files. The first glTF/GLB/OBJ is
 * the model; the rest (`.bin`, textures, `.mtl`) are exposed to three's loaders
 * by basename through a blob-URL map + a LoadingManager URL modifier, so external
 * references resolve without any disk access. Draco + meshopt compression are
 * handled. The model is recentered on the ground at the origin, and its textures
 * are extracted (original bytes kept for faithful download).
 */
export async function loadModel(files: File[]): Promise<LoadedModel> {
  const main = pickMainFile(files)
  if (!main) throw new Error('No .glb, .gltf, or .obj file found.')

  const urlMap = new Map<string, string>()
  const objectUrls: string[] = []
  for (const file of files) {
    const url = URL.createObjectURL(file)
    objectUrls.push(url)
    urlMap.set(file.name.toLowerCase(), url)
  }

  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (url.startsWith('data:')) return url
    const name = basename(url)
    return name && urlMap.has(name) ? (urlMap.get(name) as string) : url
  })

  const mainUrl = urlMap.get(main.name.toLowerCase()) as string
  const ext = extOf(main.name)

  let object: THREE.Object3D
  let textures: TextureInfo[]
  try {
    if (ext === 'obj') {
      object = await loadObj(mainUrl, manager, urlMap, files)
      textures = await extractObjTextures(files).catch((): TextureInfo[] => [])
    } else {
      const gltf = await loadGltf(mainUrl, manager)
      object = gltf.scene
      textures = await extractGltfTextures(gltf, files).catch((): TextureInfo[] => [])
    }
  } catch (error) {
    for (const url of objectUrls) URL.revokeObjectURL(url)
    throw error instanceof Error ? error : new Error(String(error))
  }

  // Recenter on the origin, resting on y=0, so the grid and contact shadows sit
  // under any model regardless of its authored pivot.
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  object.position.x -= center.x
  object.position.z -= center.z
  object.position.y -= box.min.y
  object.updateMatrixWorld(true)

  const stats = computeStats(object, files)
  const dispose = (): void => {
    disposeObject(object)
    for (const texture of textures) {
      if (texture.previewUrl) URL.revokeObjectURL(texture.previewUrl)
    }
    for (const url of objectUrls) URL.revokeObjectURL(url)
  }
  return { object, stats, textures, dispose }
}
