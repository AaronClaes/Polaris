import {
  CameraControls,
  ContactShadows,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Lightformer
} from '@react-three/drei'
import type CameraControlsImpl from 'camera-controls'
import { type ReactElement, useEffect, useRef } from 'react'
import * as THREE from 'three'

export type LightingPreset = 'studio' | 'warm' | 'cool'

export const LIGHTING_PRESETS: LightingPreset[] = ['studio', 'warm', 'cool']

// Lighting is fully procedural (Lightformers + lights) — no HDRI downloads, which
// the CSP would block anyway. Each preset just shifts ambient/key/env intensity
// and the key color.
const LIGHTING: Record<
  LightingPreset,
  { ambient: number; key: number; env: number; color: string }
> = {
  studio: { ambient: 0.6, key: 1.4, env: 0.6, color: '#ffffff' },
  warm: { ambient: 0.5, key: 1.5, env: 0.5, color: '#ffd8b0' },
  cool: { ambient: 0.6, key: 1.2, env: 0.7, color: '#cfe0ff' }
}

export interface ViewerSceneProps {
  object: THREE.Object3D
  lighting: LightingPreset
  grid: boolean
  shadows: boolean
  wireframe: boolean
  /** Bumping this re-frames the camera on the model (load + "reset view"). */
  fitNonce: number
}

export function ViewerScene({
  object,
  lighting,
  grid,
  shadows,
  wireframe,
  fitNonce
}: ViewerSceneProps): ReactElement {
  const controls = useRef<CameraControlsImpl>(null)
  const preset = LIGHTING[lighting]

  // Frame the model on load and whenever a re-fit is requested.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fitNonce is a re-fit trigger, not read here
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(object)
    controls.current?.fitToBox(box, true, {
      paddingTop: 0.3,
      paddingBottom: 0.3,
      paddingLeft: 0.3,
      paddingRight: 0.3
    })
  }, [object, fitNonce])

  // Toggle wireframe across every material in the model.
  useEffect(() => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if (material && 'wireframe' in material) {
          ;(material as THREE.MeshStandardMaterial).wireframe = wireframe
        }
      }
    })
  }, [object, wireframe])

  return (
    <>
      <CameraControls ref={controls} />
      <ambientLight intensity={preset.ambient} />
      <directionalLight position={[5, 8, 5]} intensity={preset.key} color={preset.color} />
      <Environment environmentIntensity={preset.env} resolution={256}>
        <Lightformer intensity={2} position={[0, 4, -6]} scale={[10, 10, 1]} color={preset.color} />
        <Lightformer intensity={1} position={[5, 2, 4]} scale={[5, 5, 1]} color="#ffffff" />
        <Lightformer intensity={1} position={[-5, 2, 4]} scale={[5, 5, 1]} color="#ffffff" />
      </Environment>

      <primitive object={object} />

      {grid && (
        <Grid
          position={[0, -0.001, 0]}
          infiniteGrid
          cellSize={0.5}
          cellThickness={0.6}
          sectionSize={2.5}
          sectionThickness={1}
          fadeDistance={30}
          fadeStrength={1.5}
          cellColor="#6b7280"
          sectionColor="#9ca3af"
        />
      )}
      {shadows && (
        <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={20} blur={2} far={10} />
      )}

      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport labelColor="white" />
      </GizmoHelper>
    </>
  )
}
