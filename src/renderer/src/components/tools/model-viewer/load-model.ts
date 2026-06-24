import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
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

export interface LoadedModel {
  object: THREE.Object3D
  stats: ModelStats
  /** Free the model's GPU resources and revoke its blob URLs. Call on replace/unmount. */
  dispose: () => void
}

// glTF/GLB first, then OBJ — the formats v1 supports.
const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj']

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

function loadGltf(url: string, manager: THREE.LoadingManager): Promise<THREE.Object3D> {
  const loader = new GLTFLoader(manager)
  loader.setDRACOLoader(getDracoLoader())
  loader.setMeshoptDecoder(MeshoptDecoder)
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error instanceof Error ? error : new Error('Failed to load glTF.'))
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
 * handled. The model is recentered on the ground at the origin.
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
  try {
    object =
      ext === 'obj'
        ? await loadObj(mainUrl, manager, urlMap, files)
        : await loadGltf(mainUrl, manager)
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
    for (const url of objectUrls) URL.revokeObjectURL(url)
  }
  return { object, stats, dispose }
}
