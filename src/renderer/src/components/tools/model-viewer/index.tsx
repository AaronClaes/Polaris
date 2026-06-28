import { Canvas } from '@react-three/fiber'
import {
  IconChevronRight,
  IconCircleCheck,
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
import type { ModelInput, OptimizeOptions, OptimizeStats } from '@/lib/optimize'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { type AssetEntry, AssetRail, type EntryStatus } from '../shared/asset-rail'
import { base64ToBytes, bytesToBase64 } from '../shared/bytes'
import { formatBytes } from '../shared/format'
import { mimeFromName } from '../shared/image-format'
import {
  applyTextureReplacement,
  type LoadedModel,
  loadModel,
  revertTextureReplacement,
  type TextureInfo,
  type TextureOverride
} from './load-model'
import { glbName } from './model-files'
import { OptimizePanel, type OptimizeRow } from './optimize-panel'
import { LIGHTING_PRESETS, type LightingPreset, ViewerScene } from './scene'
import { TexturePanel } from './texture-panel'

/** One model in the rail: the files needed to load it plus display meta. */
interface ModelEntry extends AssetEntry {
  kind: 'glb' | 'gltf' | 'obj'
  /** Main file first, then sidecars (.bin / textures / .mtl). */
  files: File[]
}

const ACCEPT = '.glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.ktx2,.hdr'
const MAIN_EXTENSIONS = ['glb', 'gltf', 'obj']

/** The latest optimize preview for an entry: the main temp result id (the bytes
 *  live there, not in the renderer) plus its before/after stats. */
interface OptimizeResultRecord {
  resultId: string
  before: OptimizeStats
  after: OptimizeStats
}

function fileExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function formatBadge(ext: string): string {
  return ext === 'glb' ? 'GLB' : ext === 'gltf' ? 'glTF' : 'OBJ'
}

/** Return a copy of `record` without the given keys, or `record` unchanged when
 *  none of them are present (so callers don't trigger needless re-renders). */
function omit<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (!keys.some((key) => key in record)) return record
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
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
  return null
}

/**
 * The 3D model viewer. Drop in one or many glTF/GLB/OBJ files: a collapsible left
 * rail lists them (macOS-Preview style) and the right pane renders the active one.
 * Only the active model is GPU-resident; cycling loads on demand.
 *
 * Optimize and Export are one flow scoped by an entry-id list — "this model" is the
 * single-item case of "all models". The `entries` list is the single source of
 * truth: a result loaded into the viewer rewrites its entry, so the rail, the live
 * model, and a later export all agree. Files load to in-memory blob URLs.
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
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const [railCollapsed, setRailCollapsed] = useState(true)
  // One operation at a time: disables the rail and the top-bar actions while an
  // optimize/export/save is in flight (single or bulk — same flag).
  const [busy, setBusy] = useState(false)
  // Per-entry status for the rail badge: a running spinner during an op, a checkmark
  // after a successful export/save, an error/skipped marker otherwise.
  const [status, setStatus] = useState<Record<string, EntryStatus>>({})
  // Per-entry optimize preview (keyed by entry id). The bytes live in main temp
  // files; we hold only the result id + stats, freed on supersede/close/load.
  const [results, setResults] = useState<Record<string, OptimizeResultRecord>>({})
  // The optimize panel's scope: which entries it operates on (null = closed).
  const [optimizeScope, setOptimizeScope] = useState<{ ids: string[] } | null>(null)

  const [lighting, setLighting] = useState<LightingPreset>('studio')
  const [grid, setGrid] = useState(true)
  const [shadows, setShadows] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [fitNonce, setFitNonce] = useState(0)
  const [texturesOpen, setTexturesOpen] = useState(false)
  // Per-texture replacement overrides (keyed by texture id): the new display
  // fields shown in the panel while the live texture is swapped in the scene.
  const [overrides, setOverrides] = useState<Record<string, TextureOverride>>({})

  const inputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<LoadedModel | null>(null)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const overridesRef = useRef(overrides)
  overridesRef.current = overrides
  // Mirror of `results` for async handlers (dispose/load/save read the current ids
  // without depending on a stale render closure).
  const resultsRef = useRef(results)
  resultsRef.current = results

  const pickDirectory = trpc.dialog.pickDirectory.useMutation()
  const optimizeRun = trpc.optimize.run.useMutation()
  const optimizeExport = trpc.optimize.export.useMutation()
  const optimizeRead = trpc.optimize.read.useMutation()
  const optimizeWrite = trpc.optimize.write.useMutation()
  const optimizeDispose = trpc.optimize.dispose.useMutation()

  // Resolve a File to a main-readable source: prefer its on-disk path (the worker
  // reads it directly via NodeIO — no byte transfer); fall back to base64 for
  // path-less files (e.g. an optimized result already loaded into the viewer).
  const toSource = async (file: File, kind: 'glb' | 'gltf'): Promise<ModelInput> => {
    const path = window.api.getPathForFile(file)
    if (path) return { kind, path }
    return { kind, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) }
  }

  // Texture replacements → service overrides (glTF image slots only, keyed img-<i>).
  const toOverrideInputs = async (
    record: Record<string, TextureOverride>
  ): Promise<{ index: number; base64: string; mime: string }[]> => {
    const out: { index: number; base64: string; mime: string }[] = []
    for (const [id, override] of Object.entries(record)) {
      if (!id.startsWith('img-')) continue
      const index = Number.parseInt(id.slice(4), 10)
      if (Number.isNaN(index)) continue
      out.push({
        index,
        base64: bytesToBase64(new Uint8Array(await override.blob.arrayBuffer())),
        mime: override.blob.type || mimeFromName(override.filename)
      })
    }
    return out
  }

  // Texture replacements apply to the active model only; other entries get none.
  const overridesForEntry = (
    entry: ModelEntry
  ): Promise<{ index: number; base64: string; mime: string }[]> =>
    entry.id === activeIdRef.current ? toOverrideInputs(overridesRef.current) : Promise.resolve([])

  const setEntryStatus = (id: string, state: EntryStatus): void =>
    setStatus((prev) => ({ ...prev, [id]: state }))

  const clearStatus = (ids: string[]): void => setStatus((prev) => omit(prev, ids))

  // Free the main temp results for these entries and forget them.
  const disposeResults = async (ids: string[]): Promise<void> => {
    const present = ids.filter((id) => resultsRef.current[id])
    if (present.length === 0) return
    const resultIds = present.map((id) => resultsRef.current[id].resultId)
    setResults((prev) => omit(prev, present))
    await optimizeDispose.mutateAsync({ ids: resultIds }).catch(() => {})
  }

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

  // Auto-dismiss the success notice.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // Load a file set into the viewer, disposing the previous live model and
  // resetting per-model UI. View settings (toggles/lighting) persist; auto-fits.
  const loadIntoViewer = async (files: File[]): Promise<void> => {
    setLoading(true)
    setError(null)
    setTexturesOpen(false)
    setOptimizeScope(null)
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
    setNotice(null)
    setStatus({})
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
    void disposeResults(Object.keys(resultsRef.current))
    setEntries([])
    setActiveId(null)
    setModel(null)
    setStatus({})
    setNotice(null)
    setTexturesOpen(false)
    setOptimizeScope(null)
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
    void disposeResults([id])
    clearStatus([id])
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

  // The entries an optimize/export targets: a single id, or every model in the list
  // (OBJ included so the panel/rail can mark it skipped).
  const allIds = (): string[] => entries.map((entry) => entry.id)

  // Open the optimize panel scoped to the given entries (clears any stale preview).
  const openOptimize = (ids: string[]): void => {
    void disposeResults(ids)
    clearStatus(ids)
    setNotice(null)
    setOptimizeScope({ ids })
  }

  const closeOptimize = (): void => {
    const ids = optimizeScope?.ids ?? []
    setOptimizeScope(null)
    void disposeResults(ids)
    clearStatus(ids)
  }

  // An option changed: drop the stale previews for the open scope.
  const invalidateScope = (): void => {
    if (!optimizeScope) return
    void disposeResults(optimizeScope.ids)
    clearStatus(optimizeScope.ids)
  }

  // Optimize each entry in `ids`, storing a per-entry preview. Single = [activeId];
  // all = every entry id (OBJ is marked skipped). Supersedes any prior previews.
  const optimize = async (ids: string[], options: OptimizeOptions): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    await disposeResults(ids)
    clearStatus(ids)
    const list = entries
    for (const id of ids) {
      const entry = list.find((e) => e.id === id)
      if (!entry) continue
      if (entry.kind === 'obj') continue
      setEntryStatus(id, { state: 'running' })
      try {
        const source = await toSource(entry.files[0], entry.kind as 'glb' | 'gltf')
        const overrideInputs = await overridesForEntry(entry)
        const result = await optimizeRun.mutateAsync({ source, overrides: overrideInputs, options })
        setResults((prev) => ({
          ...prev,
          [id]: { resultId: result.id, before: result.before, after: result.after }
        }))
        clearStatus([id])
      } catch (err) {
        setEntryStatus(id, {
          state: 'error',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }
    setBusy(false)
  }

  // Export each entry in `ids` straight to a chosen folder (faithful GLB, texture
  // replacements baked in for the active model). Per-entry checkmarks in the rail.
  const exportEntries = async (ids: string[]): Promise<void> => {
    const dir = await pickDirectory.mutateAsync(undefined)
    if (!dir) return
    setBusy(true)
    setError(null)
    setNotice(null)
    clearStatus(ids)
    const list = entries
    let saved = 0
    for (const id of ids) {
      const entry = list.find((e) => e.id === id)
      if (!entry) continue
      if (entry.kind === 'obj') {
        setEntryStatus(id, { state: 'skipped', detail: 'OBJ not supported' })
        continue
      }
      setEntryStatus(id, { state: 'running' })
      try {
        const source = await toSource(entry.files[0], entry.kind as 'glb' | 'gltf')
        const overrideInputs = await overridesForEntry(entry)
        const { id: resultId } = await optimizeExport.mutateAsync({
          source,
          overrides: overrideInputs
        })
        await optimizeWrite.mutateAsync({ id: resultId, dir, name: glbName(entry.name) })
        await optimizeDispose.mutateAsync({ ids: [resultId] }).catch(() => {})
        setEntryStatus(id, { state: 'done' })
        saved++
      } catch (err) {
        setEntryStatus(id, {
          state: 'error',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }
    setBusy(false)
    if (saved > 0) setNotice(saved === 1 ? 'Exported model' : `Exported ${saved} models`)
  }

  // Save the optimize previews for `ids` into a chosen folder (copied from main
  // temp). Checkmarks in the rail plus a notice with the total saved.
  const saveResults = async (ids: string[]): Promise<void> => {
    const dir = await pickDirectory.mutateAsync(undefined)
    if (!dir) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const list = entries
    let saved = 0
    let count = 0
    try {
      for (const id of ids) {
        const result = resultsRef.current[id]
        const entry = list.find((e) => e.id === id)
        if (!result || !entry) continue
        await optimizeWrite.mutateAsync({ id: result.resultId, dir, name: glbName(entry.name) })
        setEntryStatus(id, { state: 'done' })
        saved += result.before.fileBytes - result.after.fileBytes
        count++
      }
      if (count > 0) setNotice(saved > 0 ? `Saved ${formatBytes(saved)}` : 'Saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the models.')
    } finally {
      setBusy(false)
    }
  }

  // Load the optimize previews for `ids` into the viewer: read each result's bytes,
  // replace that entry's files (so the rail size + a later export use the optimized
  // GLB), reload the active model, then free the temp results.
  const loadResults = async (ids: string[]): Promise<void> => {
    const list = entries
    const filesByEntry = new Map<string, File>()
    for (const id of ids) {
      const result = resultsRef.current[id]
      const entry = list.find((e) => e.id === id)
      if (!result || !entry) continue
      const { base64 } = await optimizeRead.mutateAsync({ id: result.resultId })
      const name = glbName(entry.name)
      filesByEntry.set(
        id,
        new File([base64ToBytes(base64) as BlobPart], name, { type: 'model/gltf-binary' })
      )
    }
    if (filesByEntry.size === 0) return
    setEntries((prev) =>
      prev.map((entry) => {
        const file = filesByEntry.get(entry.id)
        if (!file) return entry
        return {
          ...entry,
          name: file.name,
          format: 'GLB',
          kind: 'glb',
          bytes: file.size,
          files: [file]
        }
      })
    )
    await disposeResults(ids)
    clearStatus(ids)
    const activeFile = activeIdRef.current ? filesByEntry.get(activeIdRef.current) : undefined
    if (activeFile) await loadIntoViewer([activeFile])
  }

  const exportReason = disabledReason(model, 'Export')
  const optimizeReason = disabledReason(model, 'Optimize')

  const optimizeRows: OptimizeRow[] = optimizeScope
    ? optimizeScope.ids.map((id) => {
        const entry = entries.find((e) => e.id === id)
        const result = results[id]
        const state = status[id]
        return {
          id,
          name: entry?.name ?? '',
          optimizable: entry ? entry.kind !== 'obj' : false,
          before: result?.before,
          after: result?.after,
          state:
            state?.state === 'running' ? 'running' : state?.state === 'error' ? 'error' : undefined,
          detail: state?.detail
        }
      })
    : []

  return (
    <div className="flex h-full w-full">
      {entries.length > 0 && (
        <AssetRail
          noun="model"
          entries={entries}
          activeId={activeId}
          status={status}
          collapsed={railCollapsed}
          busy={busy}
          onSelect={(id) => {
            const entry = entries.find((e) => e.id === id)
            if (entry) void selectEntry(entry)
          }}
          onCycle={cycle}
          onRemove={removeEntry}
          onAdd={() => inputRef.current?.click()}
          onClear={clearAll}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onExportAll={() => void exportEntries(allIds())}
          onOptimizeAll={() => openOptimize(allIds())}
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
              onClick={() => activeId && openOptimize([activeId])}
              disabled={optimizeReason != null || busy}
              title={optimizeReason ?? 'Optimize (compress textures & geometry)'}
            >
              <IconSparkles />
              Optimize
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80 backdrop-blur"
              onClick={() => activeId && void exportEntries([activeId])}
              disabled={exportReason != null || busy}
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
              {model.stats.textureVramBytes > 0 && (
                <Stat label="Texture VRAM" value={formatBytes(model.stats.textureVramBytes)} />
              )}
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

        {(error || notice) && (
          <div className="absolute right-3 bottom-3 left-3 mx-auto flex w-fit max-w-md flex-col items-center gap-2">
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-destructive-foreground text-xs">
                {error}
              </div>
            )}
            {notice && (
              <div className="flex items-center gap-1.5 rounded-lg border border-green-600/40 bg-green-600/10 px-3 py-2 text-center text-green-700 text-xs dark:text-green-500">
                <IconCircleCheck className="size-3.5" />
                {notice}
              </div>
            )}
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

        {optimizeScope && (
          <OptimizePanel
            rows={optimizeRows}
            busy={busy}
            onOptimize={(options) => optimize(optimizeScope.ids, options)}
            onInvalidate={invalidateScope}
            onLoad={() => void loadResults(optimizeScope.ids)}
            onSave={() => saveResults(optimizeScope.ids)}
            onClose={closeOptimize}
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
