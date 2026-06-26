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
import { bytesToBase64, exportModel, glbName } from './export-model'
import {
  applyTextureReplacement,
  type LoadedModel,
  loadModel,
  type ModelSource,
  revertTextureReplacement,
  type TextureInfo,
  type TextureOverride
} from './load-model'
import { type EntryStatus, type ModelEntry, ModelRail } from './model-rail'
import { type OptimizeOptions, optimizeModel } from './optimize-model'
import { type BulkItemResult, OptimizePanel } from './optimize-panel'
import { LIGHTING_PRESETS, type LightingPreset, ViewerScene } from './scene'
import { TexturePanel } from './texture-panel'

const ACCEPT = '.glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.hdr'
const MAIN_EXTENSIONS = ['glb', 'gltf', 'obj']

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function formatBadge(ext: string): string {
  return ext === 'glb' ? 'GLB' : ext === 'gltf' ? 'glTF' : 'OBJ'
}

/** Split a dropped/opened file set into one entry per model file; non-model files
 *  (.bin / textures / .mtl) ride along as sidecars (GLB needs none). */
function groupEntries(files: File[]): ModelEntry[] {
  const mains = files.filter((file) => MAIN_EXTENSIONS.includes(fileExt(file.name)))
  const sidecars = files.filter((file) => !MAIN_EXTENSIONS.includes(fileExt(file.name)))
  return mains.map((main) => {
    const ext = fileExt(main.name)
    const entryFiles = ext === 'glb' ? [main] : [main, ...sidecars]
    return {
      id: crypto.randomUUID(),
      name: main.name,
      format: formatBadge(ext),
      kind: ext as ModelEntry['kind'],
      bytes: entryFiles.reduce((sum, file) => sum + file.size, 0),
      files: entryFiles
    }
  })
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

function disabledReason(model: LoadedModel | null, verb: string): string | null {
  if (!model) return null
  if (!model.source) return `${verb} is available for glTF/GLB models.`
  if (model.compression === 'draco') {
    return 'Draco-compressed models aren’t supported yet (Meshopt and uncompressed are).'
  }
  return null
}

/**
 * The 3D model viewer. Drop in one or many glTF/GLB/OBJ files: a collapsible left
 * rail lists them (macOS-Preview style) and the right pane renders the active one.
 * Only the active model is GPU-resident; cycling loads on demand. Export and
 * Optimize work individually (active model) or in bulk over the whole list, writing
 * into a chosen folder. Files load to in-memory blob URLs (no disk access).
 */
export function ModelViewer(): ReactElement {
  const [entries, setEntries] = useState<ModelEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [model, setModel] = useState<LoadedModel | null>(null)
  const [loading, setLoading] = useState(false)
  // Debounced loading flag: only true once a load has run long enough to be worth
  // a spinner, so quick model switches don't flash an overlay over the chrome.
  const [showSpinner, setShowSpinner] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [railCollapsed, setRailCollapsed] = useState(true)
  const [bulkStatus, setBulkStatus] = useState<Record<string, EntryStatus>>({})
  const [bulkRunning, setBulkRunning] = useState(false)
  const [savedSummary, setSavedSummary] = useState<string | null>(null)

  const [lighting, setLighting] = useState<LightingPreset>('studio')
  const [grid, setGrid] = useState(true)
  const [shadows, setShadows] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [fitNonce, setFitNonce] = useState(0)
  const [texturesOpen, setTexturesOpen] = useState(false)
  const [optimizeMode, setOptimizeMode] = useState<'single' | 'bulk' | null>(null)
  // Per-texture replacement overrides (keyed by texture id): the new display
  // fields shown in the panel while the live texture is swapped in the scene.
  const [overrides, setOverrides] = useState<Record<string, TextureOverride>>({})

  const inputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<LoadedModel | null>(null)
  // Previewed bulk-optimize output, held in memory until the user loads or saves it.
  const bulkResultsRef = useRef<
    Map<string, { bytes: Uint8Array; name: string; before: number; after: number }>
  >(new Map())
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides

  const pickDirectory = trpc.dialog.pickDirectory.useMutation()
  const writeModelFile = trpc.dialog.writeModelFile.useMutation()

  // Free the live model's GPU resources and replacement previews on unmount.
  useEffect(
    () => () => {
      modelRef.current?.dispose()
      revokeOverrides(overridesRef.current)
    },
    []
  )

  // Show the spinner only if a load outlasts a short grace period — switching
  // between small models is near-instant and shouldn't flash anything.
  useEffect(() => {
    if (!loading) {
      setShowSpinner(false)
      return
    }
    const timer = setTimeout(() => setShowSpinner(true), 150)
    return () => clearTimeout(timer)
  }, [loading])

  // Load a file set into the viewer, disposing the previous live model and
  // resetting per-model UI. View settings (toggles/lighting) persist; auto-fits.
  const loadIntoViewer = async (files: File[]): Promise<void> => {
    setLoading(true)
    setError(null)
    setTexturesOpen(false)
    setOptimizeMode(null)
    try {
      const next = await loadModel(files)
      modelRef.current?.dispose()
      modelRef.current = next
      setModel(next)
      setFitNonce((n) => n + 1)
      setOverrides((prev) => {
        revokeOverrides(prev)
        return {}
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the model.')
      modelRef.current?.dispose()
      modelRef.current = null
      setModel(null)
    } finally {
      setLoading(false)
    }
  }

  // Select an entry to view (only the active model is GPU-resident).
  const selectEntry = async (entry: ModelEntry): Promise<void> => {
    if (entry.id === activeIdRef.current) return
    setActiveId(entry.id)
    await loadIntoViewer(entry.files)
  }

  const addFiles = (files: File[]): void => {
    const next = groupEntries(files)
    if (next.length === 0) {
      setError('No .glb, .gltf, or .obj file found.')
      return
    }
    setSavedSummary(null)
    setEntries((prev) => {
      const merged = [...prev, ...next]
      if (merged.length > 1) setRailCollapsed(false)
      return merged
    })
    if (!activeIdRef.current) void selectEntry(next[0])
  }

  const cycle = (delta: 1 | -1): void => {
    const index = entries.findIndex((entry) => entry.id === activeId)
    const next = entries[index + delta]
    if (next) void selectEntry(next)
  }

  // Empty the list and reset to the drop state. Only forgets the loaded files —
  // nothing on disk is touched.
  const clearAll = (): void => {
    modelRef.current?.dispose()
    modelRef.current = null
    bulkResultsRef.current = new Map()
    setEntries([])
    setActiveId(null)
    setModel(null)
    setBulkStatus({})
    setSavedSummary(null)
    setTexturesOpen(false)
    setOptimizeMode(null)
    setError(null)
    setRailCollapsed(true)
    setOverrides((prev) => {
      revokeOverrides(prev)
      return {}
    })
  }

  const removeEntry = (id: string): void => {
    const index = entries.findIndex((entry) => entry.id === id)
    if (index === -1) return
    const rest = entries.filter((entry) => entry.id !== id)
    setEntries(rest)
    setBulkStatus((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (id !== activeId) return
    const neighbor = rest[index] ?? rest[index - 1] ?? null
    if (neighbor) {
      void selectEntry(neighbor)
    } else {
      modelRef.current?.dispose()
      modelRef.current = null
      setModel(null)
      setActiveId(null)
      setOverrides((prev) => {
        revokeOverrides(prev)
        return {}
      })
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

  // Write one model into the chosen folder's polaris-optimized subfolder. Returns
  // false if the user cancelled the folder picker.
  const writeToFolder = async (dir: string, name: string, bytes: Uint8Array): Promise<void> => {
    await writeModelFile.mutateAsync({ dir, name: glbName(name), base64: bytesToBase64(bytes) })
  }

  // Individual export of the active model (bakes in any texture replacements).
  const exportActive = async (): Promise<void> => {
    if (!model?.source) return
    const dir = await pickDirectory.mutateAsync(undefined)
    if (!dir) return
    setExporting(true)
    setError(null)
    try {
      const bytes = await exportModel(model.source, overrides)
      await writeToFolder(dir, model.source.file.name, bytes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export the model.')
    } finally {
      setExporting(false)
    }
  }

  // Save an optimized result (from the single-model Optimize panel) to a folder.
  const saveOptimized = async (bytes: Uint8Array): Promise<void> => {
    if (!model?.source) return
    const dir = await pickDirectory.mutateAsync(undefined)
    if (!dir) return
    await writeToFolder(dir, model.source.file.name, bytes)
  }

  // Single Load into viewer: swap the live preview for the optimized GLB
  // (transient; cycling away reloads the entry's stored files).
  const loadOptimized = (bytes: Uint8Array): void => {
    const file = new File([bytes as BlobPart], glbName(model?.source?.file.name ?? 'model'), {
      type: 'model/gltf-binary'
    })
    void loadIntoViewer([file])
  }

  // Export all: faithful re-export written straight to a chosen folder (nothing to
  // preview). Per-row status shows in the rail; OBJ/Draco are skipped.
  const exportAll = async (): Promise<void> => {
    const dir = await pickDirectory.mutateAsync(undefined)
    if (!dir) return
    setBulkRunning(true)
    setError(null)
    setBulkStatus({})
    setSavedSummary(null)
    for (const entry of entries) {
      if (entry.kind === 'obj') {
        setBulkStatus((s) => ({
          ...s,
          [entry.id]: { state: 'skipped', detail: 'OBJ not supported' }
        }))
        continue
      }
      setBulkStatus((s) => ({ ...s, [entry.id]: { state: 'running' } }))
      try {
        const source: ModelSource = {
          file: entry.files[0],
          kind: entry.kind as ModelSource['kind']
        }
        const bytes = await exportModel(source, {})
        await writeToFolder(dir, entry.name, bytes)
        setBulkStatus((s) => ({ ...s, [entry.id]: { state: 'done' } }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const draco = /draco/i.test(message)
        setBulkStatus((s) => ({
          ...s,
          [entry.id]: {
            state: draco ? 'skipped' : 'error',
            detail: draco ? 'Draco not supported' : message
          }
        }))
      }
    }
    setBulkRunning(false)
  }

  // Optimize all: run in memory and return a per-model preview (shown in the
  // panel, like the single flow). Output bytes are held for Load into / Download.
  const optimizeAllPreview = async (options: OptimizeOptions): Promise<BulkItemResult[]> => {
    setBulkRunning(true)
    setError(null)
    setBulkStatus({})
    setSavedSummary(null)
    bulkResultsRef.current = new Map()
    const results: BulkItemResult[] = []
    for (const entry of entries) {
      if (entry.kind === 'obj') {
        results.push({
          id: entry.id,
          name: entry.name,
          status: 'skipped',
          detail: 'OBJ not supported'
        })
        continue
      }
      try {
        const source: ModelSource = {
          file: entry.files[0],
          kind: entry.kind as ModelSource['kind']
        }
        const result = await optimizeModel(source, {}, options)
        bulkResultsRef.current.set(entry.id, {
          bytes: result.bytes,
          name: entry.name,
          before: result.before.fileBytes,
          after: result.after.fileBytes
        })
        results.push({
          id: entry.id,
          name: entry.name,
          status: 'done',
          before: result.before,
          after: result.after
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const draco = /draco/i.test(message)
        results.push({
          id: entry.id,
          name: entry.name,
          status: draco ? 'skipped' : 'error',
          detail: draco ? 'Draco not supported' : message
        })
      }
    }
    setBulkRunning(false)
    return results
  }

  // Bulk Load into viewer: replace each optimized entry's files with its result,
  // then reload the active model from its optimized bytes.
  const loadAllOptimized = (): void => {
    const results = bulkResultsRef.current
    if (results.size === 0) return
    setEntries((prev) =>
      prev.map((entry) => {
        const result = results.get(entry.id)
        if (!result) return entry
        const name = glbName(entry.name)
        return {
          ...entry,
          name,
          format: 'GLB',
          kind: 'glb',
          bytes: result.bytes.length,
          files: [new File([result.bytes as BlobPart], name, { type: 'model/gltf-binary' })]
        }
      })
    )
    setBulkStatus({})
    const active = activeIdRef.current ? results.get(activeIdRef.current) : undefined
    if (active) {
      void loadIntoViewer([
        new File([active.bytes as BlobPart], glbName(active.name), { type: 'model/gltf-binary' })
      ])
    }
  }

  // Bulk Download all: write the previewed output to a chosen folder.
  const saveAll = async (): Promise<void> => {
    const dir = await pickDirectory.mutateAsync(undefined)
    if (!dir) return
    let saved = 0
    try {
      for (const result of bulkResultsRef.current.values()) {
        await writeToFolder(dir, result.name, result.bytes)
        saved += result.before - result.after
      }
      setSavedSummary(saved > 0 ? `Saved ${formatBytes(saved)}` : 'Saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the models.')
    }
  }

  const exportReason = disabledReason(model, 'Export')
  const optimizeReason = disabledReason(model, 'Optimize')

  return (
    <div className="flex h-full w-full">
      {entries.length > 0 && (
        <ModelRail
          entries={entries}
          activeId={activeId}
          status={bulkStatus}
          collapsed={railCollapsed}
          busy={bulkRunning}
          savedSummary={savedSummary}
          onSelect={(id) => {
            const entry = entries.find((e) => e.id === id)
            if (entry) void selectEntry(entry)
          }}
          onCycle={cycle}
          onRemove={removeEntry}
          onAdd={() => inputRef.current?.click()}
          onClear={clearAll}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onExportAll={() => void exportAll()}
          onOptimizeAll={() => setOptimizeMode('bulk')}
        />
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target, not a control */}
      <div
        className="relative min-w-0 flex-1 overflow-hidden bg-muted"
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(Array.from(e.dataTransfer.files))
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
              onClick={() => setOptimizeMode('single')}
              disabled={optimizeReason != null}
              title={optimizeReason ?? 'Optimize (compress textures & geometry)'}
            >
              <IconSparkles />
              Optimize
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80 backdrop-blur"
              onClick={() => void exportActive()}
              disabled={exportReason != null || exporting}
              loading={exporting}
              title={
                exportReason ??
                (Object.keys(overrides).length > 0
                  ? 'Export as GLB (with replaced textures)'
                  : 'Export as GLB')
              }
            >
              <IconDownload />
              Export
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
                <p className="font-medium text-sm">Drop 3D models here</p>
                <p className="mt-1 text-muted-foreground text-xs">
                  glTF / GLB or OBJ — drag files (plus their textures) in, or open them.
                </p>
              </div>
              <Button size="sm" onClick={() => inputRef.current?.click()}>
                <IconFolderOpen />
                Open files
              </Button>
            </div>
          </div>
        )}

        {model && dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <p className="rounded-lg border-2 border-ring border-dashed px-6 py-4 font-medium text-sm">
              Drop to add
            </p>
          </div>
        )}

        {showSpinner && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-background/80 p-3 text-muted-foreground shadow-sm backdrop-blur">
              <Spinner />
            </div>
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

        {model?.source && optimizeMode === 'single' && (
          <OptimizePanel
            mode="single"
            source={model.source}
            overrides={overrides}
            onLoadResult={loadOptimized}
            onSave={saveOptimized}
            onClose={() => setOptimizeMode(null)}
          />
        )}

        {optimizeMode === 'bulk' && (
          <OptimizePanel
            mode="bulk"
            count={entries.filter((entry) => entry.kind !== 'obj').length}
            onOptimizeAll={optimizeAllPreview}
            onLoadAll={loadAllOptimized}
            onSaveAll={saveAll}
            onClose={() => setOptimizeMode(null)}
          />
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
