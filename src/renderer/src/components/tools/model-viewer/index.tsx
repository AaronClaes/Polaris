import { Canvas } from '@react-three/fiber'
import {
  IconChevronRight,
  IconCube,
  IconDownload,
  IconFocusCentered,
  IconFolderOpen,
  IconGridDots,
  IconShadow,
  IconSparkles,
  IconVectorTriangle
} from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { bytesToBase64, exportModel } from './export-model'
import {
  applyTextureReplacement,
  type LoadedModel,
  loadModel,
  revertTextureReplacement,
  type TextureInfo,
  type TextureOverride
} from './load-model'
import { OptimizePanel } from './optimize-panel'
import { LIGHTING_PRESETS, type LightingPreset, ViewerScene } from './scene'
import { TexturePanel } from './texture-panel'

const ACCEPT = '.glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.hdr'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ToggleButton({
  active,
  onClick,
  title,
  children
}: {
  active: boolean
  onClick: () => void
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <Button
      size="icon-sm"
      variant={active ? 'default' : 'ghost'}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </Button>
  )
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </>
  )
}

function revokeOverrides(record: Record<string, TextureOverride>): void {
  for (const override of Object.values(record)) {
    if (override.previewUrl) URL.revokeObjectURL(override.previewUrl)
  }
}

/**
 * The 3D model viewer: drag in (or open) a glTF/GLB or OBJ, then orbit and
 * inspect it. Files load to in-memory blob URLs (no disk access); the model is
 * loaded imperatively and handed to {@link ViewerScene} as a plain three object,
 * so there's no R3F asset-suspense here. Fills its container — the framework gives
 * it a window edge-to-edge or a tall framed canvas in-app.
 */
export function ModelViewer(): ReactElement {
  const [model, setModel] = useState<LoadedModel | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [exporting, setExporting] = useState(false)
  const saveFile = trpc.dialog.saveFile.useMutation()

  const [lighting, setLighting] = useState<LightingPreset>('studio')
  const [grid, setGrid] = useState(true)
  const [shadows, setShadows] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [fitNonce, setFitNonce] = useState(0)
  const [texturesOpen, setTexturesOpen] = useState(false)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  // Per-texture replacement overrides (keyed by texture id): the new display
  // fields shown in the panel while the live texture is swapped in the scene.
  const [overrides, setOverrides] = useState<Record<string, TextureOverride>>({})

  const inputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<LoadedModel | null>(null)
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides

  // Free the live model's GPU resources and replacement previews on unmount.
  useEffect(
    () => () => {
      modelRef.current?.dispose()
      revokeOverrides(overridesRef.current)
    },
    []
  )

  const openFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const next = await loadModel(files)
      modelRef.current?.dispose()
      modelRef.current = next
      setModel(next)
      setFitNonce((n) => n + 1)
      setTexturesOpen(false)
      setOptimizeOpen(false)
      setOverrides((prev) => {
        revokeOverrides(prev)
        return {}
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the model.')
    } finally {
      setLoading(false)
    }
  }

  const replaceTexture = async (texture: TextureInfo, file: File): Promise<void> => {
    try {
      const override = await applyTextureReplacement(texture, file)
      setOverrides((prev) => {
        if (prev[texture.id]?.previewUrl) URL.revokeObjectURL(prev[texture.id].previewUrl as string)
        return { ...prev, [texture.id]: override }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace the texture.')
    }
  }

  const revertTexture = (texture: TextureInfo): void => {
    revertTextureReplacement(texture)
    setOverrides((prev) => {
      if (prev[texture.id]?.previewUrl) URL.revokeObjectURL(prev[texture.id].previewUrl as string)
      const next = { ...prev }
      delete next[texture.id]
      return next
    })
  }

  // Re-export the model as a GLB with any replaced textures baked in. Disabled
  // for OBJ (no glTF document) and Draco models (see exportDisabledReason).
  const exportGlb = async (): Promise<void> => {
    if (!model?.source) return
    setExporting(true)
    setError(null)
    try {
      const bytes = await exportModel(model.source, overrides)
      const filename = `${model.source.file.name.replace(/\.(glb|gltf)$/i, '')}.glb`
      await saveFile.mutateAsync({ filename, base64: bytesToBase64(bytes) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export the model.')
    } finally {
      setExporting(false)
    }
  }

  // Replace the current model with an optimized GLB (load it like a fresh file).
  const loadOptimized = (bytes: Uint8Array): void => {
    const name = `${model?.source?.file.name.replace(/\.(glb|gltf)$/i, '') ?? 'model'}-optimized.glb`
    const file = new File([bytes as BlobPart], name, { type: 'model/gltf-binary' })
    void openFiles([file])
  }

  const exportDisabledReason = !model
    ? null
    : !model.source
      ? 'Export is available for glTF/GLB models.'
      : model.compression === 'draco'
        ? 'Draco-compressed models aren’t supported yet (Meshopt and uncompressed are).'
        : null

  const optimizeDisabledReason = !model
    ? null
    : !model.source
      ? 'Optimize is available for glTF/GLB models.'
      : model.compression === 'draco'
        ? 'Draco-compressed models aren’t supported yet (Meshopt and uncompressed are).'
        : null

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target, not a control
    <div
      className="relative h-full w-full bg-muted"
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void openFiles(Array.from(e.dataTransfer.files))
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [3, 2, 4], fov: 50 }}
      >
        {model && (
          <ViewerScene
            object={model.object}
            lighting={lighting}
            grid={grid}
            shadows={shadows}
            wireframe={wireframe}
            fitNonce={fitNonce}
          />
        )}
      </Canvas>

      {model && (
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background/80 p-1 backdrop-blur">
            <ToggleButton active={grid} onClick={() => setGrid((v) => !v)} title="Grid">
              <IconGridDots />
            </ToggleButton>
            <ToggleButton active={shadows} onClick={() => setShadows((v) => !v)} title="Shadows">
              <IconShadow />
            </ToggleButton>
            <ToggleButton
              active={wireframe}
              onClick={() => setWireframe((v) => !v)}
              title="Wireframe"
            >
              <IconVectorTriangle />
            </ToggleButton>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setFitNonce((n) => n + 1)}
              title="Reset view"
              aria-label="Reset view"
            >
              <IconFocusCentered />
            </Button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background/80 p-1 backdrop-blur">
            {LIGHTING_PRESETS.map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant={lighting === preset ? 'default' : 'ghost'}
                className="capitalize"
                onClick={() => setLighting(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
        </div>
      )}

      {model && (
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="bg-background/80 backdrop-blur"
            onClick={() => setOptimizeOpen(true)}
            disabled={optimizeDisabledReason != null}
            title={optimizeDisabledReason ?? 'Optimize (compress textures & geometry)'}
          >
            <IconSparkles />
            Optimize
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-background/80 backdrop-blur"
            onClick={() => void exportGlb()}
            disabled={exportDisabledReason != null || exporting}
            loading={exporting}
            title={
              exportDisabledReason ??
              (Object.keys(overrides).length > 0
                ? 'Export as GLB (with replaced textures)'
                : 'Export as GLB')
            }
          >
            <IconDownload />
            Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-background/80 backdrop-blur"
            onClick={() => inputRef.current?.click()}
          >
            <IconFolderOpen />
            Open
          </Button>
        </div>
      )}

      {model && (
        <div className="absolute bottom-3 left-3 rounded-lg border border-border bg-background/80 px-3 py-2 text-xs backdrop-blur">
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
            <Stat label="Triangles" value={model.stats.triangles.toLocaleString()} />
            <Stat label="Vertices" value={model.stats.vertices.toLocaleString()} />
            <Stat label="Meshes" value={model.stats.meshes.toLocaleString()} />
            <Stat label="Materials" value={model.stats.materials.toLocaleString()} />
            {model.textures.length > 0 ? (
              <button
                type="button"
                onClick={() => setTexturesOpen(true)}
                className="group col-span-2 flex items-center justify-between gap-3 underline-offset-2"
              >
                <span className="text-muted-foreground group-hover:underline">Textures</span>
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground group-hover:underline">
                  {model.textures.length}
                  <IconChevronRight className="size-3" />
                </span>
              </button>
            ) : (
              <>
                <dt className="text-muted-foreground">Textures</dt>
                <dd className="text-right font-medium text-foreground">0</dd>
              </>
            )}
            <Stat
              label="Size"
              value={`${model.stats.size.x.toFixed(2)} × ${model.stats.size.y.toFixed(2)} × ${model.stats.size.z.toFixed(2)}`}
            />
            <Stat label="File" value={formatBytes(model.stats.fileBytes)} />
          </dl>
        </div>
      )}

      {!model && !loading && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div
            className={cn(
              'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-10 py-12 text-center transition-colors',
              dragging ? 'border-ring bg-accent/40' : 'border-border'
            )}
          >
            <IconCube className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">Drop a 3D model here</p>
              <p className="mt-1 text-muted-foreground text-xs">
                glTF / GLB or OBJ — drag the file (plus its textures) in, or open it.
              </p>
            </div>
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <IconFolderOpen />
              Open file
            </Button>
          </div>
        </div>
      )}

      {model && dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <p className="rounded-lg border-2 border-ring border-dashed px-6 py-4 font-medium text-sm">
            Drop to replace
          </p>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 text-muted-foreground">
          <Spinner />
        </div>
      )}

      {error && (
        <div className="absolute right-3 bottom-3 left-3 mx-auto w-fit max-w-md rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-destructive-foreground text-xs">
          {error}
        </div>
      )}

      {model && texturesOpen && model.textures.length > 0 && (
        <TexturePanel
          textures={model.textures}
          overrides={overrides}
          onReplace={(texture, file) => void replaceTexture(texture, file)}
          onRevert={revertTexture}
          onClose={() => setTexturesOpen(false)}
        />
      )}

      {model?.source && optimizeOpen && (
        <OptimizePanel
          source={model.source}
          overrides={overrides}
          onLoadResult={loadOptimized}
          onClose={() => setOptimizeOpen(false)}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          void openFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
}
