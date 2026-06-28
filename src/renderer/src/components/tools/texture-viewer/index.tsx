import {
  IconCircleCheck,
  IconDownload,
  IconFolderOpen,
  IconGridDots,
  IconPhoto,
  IconSparkles
} from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import type { ImageInput, ImageOptimizeOptions, ImageStats } from '@/lib/optimize'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { type AssetEntry, AssetRail, type EntryStatus } from '../shared/asset-rail'
import { base64ToBytes, bytesToBase64 } from '../shared/bytes'
import { formatBytes } from '../shared/format'
import { imageFormatLabel, mimeFromName } from '../shared/image-format'
import { type LoadedTexture, loadTexture } from './load-texture'
import { extForFormat, IMAGE_ACCEPT, isImageFile, mimeForExt, outputName } from './texture-files'
import { TextureOptimizePanel, type TextureOptimizeRow } from './texture-optimize-panel'
import { ALL_CHANNELS, type Channels, isAllChannels, TexturePreview } from './texture-preview'

const MAX_REPEAT = 8

/** One texture in the rail: the file to load plus display meta. */
interface TextureEntry extends AssetEntry {
  kind: 'raster' | 'ktx2'
  file: File
}

/** The latest optimize preview for an entry: the main temp result id plus stats
 *  and the output extension (so save/load name the file correctly). */
interface OptimizeResultRecord {
  resultId: string
  before: ImageStats
  after: ImageStats
  ext: string
}

function fileExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

/** Tidy aspect ratio: a clean w:h when the reduced terms are small, else decimal. */
function aspectRatio(width: number, height: number): string {
  if (!width || !height) return '—'
  const divisor = gcd(width, height)
  const w = width / divisor
  const h = height / divisor
  if (w <= 64 && h <= 64) return `${w}:${h}`
  return `${(width / height).toFixed(2)}:1`
}

/** Return a copy of `record` without the given keys, or `record` unchanged when
 *  none of them are present (so callers don't trigger needless re-renders). */
function omit<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (!keys.some((key) => key in record)) return record
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
}

function groupEntries(files: File[]): TextureEntry[] {
  return files.filter(isImageFile).map((file) => {
    const ext = fileExt(file.name)
    return {
      id: crypto.randomUUID(),
      name: file.name,
      format: imageFormatLabel(file.type || mimeFromName(file.name), file.name),
      kind: ext === 'ktx2' ? 'ktx2' : 'raster',
      bytes: file.size,
      file
    }
  })
}

function ToggleButton({
  active,
  disabled,
  onClick,
  title,
  children
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <Button
      size="icon-sm"
      variant={active ? 'default' : 'ghost'}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {children}
    </Button>
  )
}

function ChannelButton({
  label,
  active,
  disabled,
  onClick
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <Button
      size="icon-sm"
      variant={active ? 'default' : 'ghost'}
      disabled={disabled}
      onClick={onClick}
      title={`Toggle ${label} channel`}
      aria-label={`Toggle ${label} channel`}
      aria-pressed={active}
      className="font-mono text-xs"
    >
      {label}
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

/**
 * The texture viewer. Drop in one or many images (PNG/JPEG/WebP/AVIF/KTX2): a
 * collapsible left rail lists them and the right pane tiles the active one to test
 * seamlessness — adjustable repeat count, boundary grid lines, and per-channel
 * isolation. Optimize and Export mirror the model viewer's scoped-by-id flow
 * ("this texture" is the single-item case of "all textures"), running in the shared
 * main-process optimize service.
 */
export function TextureViewer(): ReactElement {
  const [entries, setEntries] = useState<TextureEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [texture, setTexture] = useState<LoadedTexture | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSpinner, setShowSpinner] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const [railCollapsed, setRailCollapsed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Record<string, EntryStatus>>({})
  const [results, setResults] = useState<Record<string, OptimizeResultRecord>>({})
  const [optimizeScope, setOptimizeScope] = useState<{ ids: string[] } | null>(null)

  // Viewer controls — persist across texture switches.
  const [repeat, setRepeat] = useState(3)
  const [grid, setGrid] = useState(true)
  const [channels, setChannels] = useState<Channels>(ALL_CHANNELS)

  const inputRef = useRef<HTMLInputElement>(null)
  // Loaded textures cached by entry id, so a texture is decoded/transcoded only the
  // first time it's viewed — switching back to one already seen is instant (no work
  // on the main thread). Entries are evicted (and their object URLs revoked) on
  // remove / clear / replace / unmount.
  const cacheRef = useRef(new Map<string, LoadedTexture>())
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId
  const resultsRef = useRef(results)
  resultsRef.current = results

  const evictCache = (ids: string[]): void => {
    for (const id of ids) {
      cacheRef.current.get(id)?.dispose()
      cacheRef.current.delete(id)
    }
  }

  const pickDirectory = trpc.dialog.pickDirectory.useMutation()
  const optimizeRunImage = trpc.optimize.runImage.useMutation()
  const optimizeRead = trpc.optimize.read.useMutation()
  const optimizeWrite = trpc.optimize.write.useMutation()
  const optimizeWriteFile = trpc.optimize.writeFile.useMutation()
  const optimizeDispose = trpc.optimize.dispose.useMutation()

  // Resolve a File to a main-readable source: prefer its on-disk path (no byte
  // transfer); fall back to base64 for path-less files (an optimized result).
  const toSource = async (file: File): Promise<ImageInput> => {
    const mime = file.type || mimeFromName(file.name)
    const path = window.api.getPathForFile(file)
    if (path) return { path, mime }
    return { base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())), mime }
  }

  const setEntryStatus = (id: string, state: EntryStatus): void =>
    setStatus((prev) => ({ ...prev, [id]: state }))

  const clearStatus = (ids: string[]): void => setStatus((prev) => omit(prev, ids))

  const disposeResults = async (ids: string[]): Promise<void> => {
    const present = ids.filter((id) => resultsRef.current[id])
    if (present.length === 0) return
    const resultIds = present.map((id) => resultsRef.current[id].resultId)
    setResults((prev) => omit(prev, present))
    await optimizeDispose.mutateAsync({ ids: resultIds }).catch(() => {})
  }

  useEffect(() => {
    const cache = cacheRef.current
    return () => {
      for (const loaded of cache.values()) loaded.dispose()
      cache.clear()
    }
  }, [])

  useEffect(() => {
    if (!loading) {
      setShowSpinner(false)
      return
    }
    const timer = setTimeout(() => setShowSpinner(true), 150)
    return () => clearTimeout(timer)
  }, [loading])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const loadIntoViewer = async (entryId: string, file: File): Promise<void> => {
    setError(null)
    setOptimizeScope(null)

    const cached = cacheRef.current.get(entryId)
    if (cached) {
      setTexture(cached)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await loadTexture(file)
      cacheRef.current.set(entryId, next)
      // The user may have switched away while this was decoding — keep the cached
      // result for later, but don't clobber the now-active texture.
      if (activeIdRef.current !== entryId) return
      setTexture(next)
    } catch (err) {
      if (activeIdRef.current === entryId) {
        setError(err instanceof Error ? err.message : 'Failed to load the texture.')
        setTexture(null)
      }
    } finally {
      if (activeIdRef.current === entryId) setLoading(false)
    }
  }

  const selectEntry = async (entry: TextureEntry): Promise<void> => {
    if (entry.id === activeIdRef.current) return
    setActiveId(entry.id)
    await loadIntoViewer(entry.id, entry.file)
  }

  const addFiles = (files: File[]): void => {
    const next = groupEntries(files)
    if (next.length === 0) {
      setError('No image files found.')
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

  const clearAll = (): void => {
    evictCache([...cacheRef.current.keys()])
    void disposeResults(Object.keys(resultsRef.current))
    setEntries([])
    setActiveId(null)
    setTexture(null)
    setStatus({})
    setNotice(null)
    setOptimizeScope(null)
    setError(null)
    setRailCollapsed(true)
  }

  const removeEntry = (id: string): void => {
    const index = entries.findIndex((entry) => entry.id === id)
    if (index === -1) return
    const rest = entries.filter((entry) => entry.id !== id)
    setEntries(rest)
    evictCache([id])
    void disposeResults([id])
    clearStatus([id])
    if (id !== activeId) return
    const neighbor = rest[index] ?? rest[index - 1] ?? null
    if (neighbor) {
      void selectEntry(neighbor)
    } else {
      setTexture(null)
      setActiveId(null)
    }
  }

  const allIds = (): string[] => entries.map((entry) => entry.id)

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

  const invalidateScope = (): void => {
    if (!optimizeScope) return
    void disposeResults(optimizeScope.ids)
    clearStatus(optimizeScope.ids)
  }

  // Optimize each entry in `ids`, storing a per-entry preview. KTX2 entries are
  // skipped (no main-side transcoder). Supersedes any prior previews.
  const optimize = async (ids: string[], options: ImageOptimizeOptions): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    await disposeResults(ids)
    clearStatus(ids)
    const list = entries
    for (const id of ids) {
      const entry = list.find((e) => e.id === id)
      if (!entry || entry.kind === 'ktx2') continue
      setEntryStatus(id, { state: 'running' })
      try {
        const source = await toSource(entry.file)
        const result = await optimizeRunImage.mutateAsync({ source, options })
        setResults((prev) => ({
          ...prev,
          [id]: {
            resultId: result.id,
            before: result.before,
            after: result.after,
            ext: extForFormat(options.format, entry.name)
          }
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

  // Export each entry's original bytes straight to a chosen folder (a batch "save
  // these textures"). Per-entry checkmarks in the rail.
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
      setEntryStatus(id, { state: 'running' })
      try {
        const base64 = bytesToBase64(new Uint8Array(await entry.file.arrayBuffer()))
        await optimizeWriteFile.mutateAsync({ dir, name: entry.name, base64 })
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
    if (saved > 0) setNotice(saved === 1 ? 'Exported texture' : `Exported ${saved} textures`)
  }

  // Save the optimize previews for `ids` into a chosen folder (copied from main
  // temp), named with the produced extension. A notice with the total bytes saved.
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
        await optimizeWrite.mutateAsync({
          id: result.resultId,
          dir,
          name: outputName(entry.name, result.ext)
        })
        setEntryStatus(id, { state: 'done' })
        saved += result.before.fileBytes - result.after.fileBytes
        count++
      }
      if (count > 0) setNotice(saved > 0 ? `Saved ${formatBytes(saved)}` : 'Saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the textures.')
    } finally {
      setBusy(false)
    }
  }

  // Load the optimize previews for `ids` into the viewer: read each result's bytes,
  // replace that entry's file (so the rail + a later export use the optimized
  // image), reload the active one, then free the temp results.
  const loadResults = async (ids: string[]): Promise<void> => {
    const list = entries
    const fileByEntry = new Map<
      string,
      { file: File; kind: TextureEntry['kind']; format: string }
    >()
    for (const id of ids) {
      const result = resultsRef.current[id]
      const entry = list.find((e) => e.id === id)
      if (!result || !entry) continue
      const { base64 } = await optimizeRead.mutateAsync({ id: result.resultId })
      const name = outputName(entry.name, result.ext)
      const mime = mimeForExt(result.ext)
      const file = new File([base64ToBytes(base64) as BlobPart], name, { type: mime })
      fileByEntry.set(id, {
        file,
        kind: result.ext === 'ktx2' ? 'ktx2' : 'raster',
        format: imageFormatLabel(mime, name)
      })
    }
    if (fileByEntry.size === 0) return
    setEntries((prev) =>
      prev.map((entry) => {
        const replacement = fileByEntry.get(entry.id)
        if (!replacement) return entry
        return {
          ...entry,
          name: replacement.file.name,
          format: replacement.format,
          kind: replacement.kind,
          bytes: replacement.file.size,
          file: replacement.file
        }
      })
    )
    await disposeResults(ids)
    clearStatus(ids)
    // The replaced entries now point at new files — drop their stale cached previews.
    evictCache([...fileByEntry.keys()])
    const activeId = activeIdRef.current
    const active = activeId ? fileByEntry.get(activeId) : undefined
    if (active && activeId) await loadIntoViewer(activeId, active.file)
  }

  const optimizeRows: TextureOptimizeRow[] = optimizeScope
    ? optimizeScope.ids.map((id) => {
        const entry = entries.find((e) => e.id === id)
        const result = results[id]
        const state = status[id]
        return {
          id,
          name: entry?.name ?? '',
          optimizable: entry ? entry.kind !== 'ktx2' : false,
          before: result?.before,
          after: result?.after,
          state:
            state?.state === 'running' ? 'running' : state?.state === 'error' ? 'error' : undefined,
          detail: state?.detail
        }
      })
    : []

  const activeEntry = entries.find((entry) => entry.id === activeId)
  const optimizeReason =
    activeEntry?.kind === 'ktx2' ? 'KTX2 can be viewed but not re-encoded.' : null
  const stats = texture?.stats

  const toggleChannel = (key: keyof Channels): void =>
    setChannels((prev) => ({ ...prev, [key]: !prev[key] }))

  return (
    <div className="flex h-full w-full">
      {entries.length > 0 && (
        <AssetRail
          noun="texture"
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
        {texture?.texture && (
          <TexturePreview
            texture={texture.texture}
            sourceWidth={texture.stats.width}
            sourceHeight={texture.stats.height}
            repeat={repeat}
            grid={grid}
            channels={channels}
          />
        )}

        {texture && !texture.texture && !loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            No preview available
          </div>
        )}

        {texture?.texture && (
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 p-1 pl-2.5 backdrop-blur">
              <span className="text-muted-foreground text-xs">Repeat</span>
              <Slider
                className="w-28"
                min={1}
                max={MAX_REPEAT}
                step={1}
                value={repeat}
                onValueChange={(next) => setRepeat(Array.isArray(next) ? next[0] : next)}
              />
              <span className="w-4 text-center text-muted-foreground text-xs tabular-nums">
                {repeat}
              </span>
              <ToggleButton active={grid} onClick={() => setGrid((v) => !v)} title="Grid lines">
                <IconGridDots />
              </ToggleButton>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background/80 p-1 backdrop-blur">
              <ChannelButton label="R" active={channels.r} onClick={() => toggleChannel('r')} />
              <ChannelButton label="G" active={channels.g} onClick={() => toggleChannel('g')} />
              <ChannelButton label="B" active={channels.b} onClick={() => toggleChannel('b')} />
              <ChannelButton label="A" active={channels.a} onClick={() => toggleChannel('a')} />
              {!isAllChannels(channels) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setChannels(ALL_CHANNELS)}
                  title="Show all channels"
                >
                  All
                </Button>
              )}
            </div>
          </div>
        )}

        {texture && (
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80 backdrop-blur"
              onClick={() => activeId && openOptimize([activeId])}
              disabled={optimizeReason != null || busy}
              title={optimizeReason ?? 'Optimize (re-encode, resize, KTX2)'}
            >
              <IconSparkles />
              Optimize
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background/80 backdrop-blur"
              onClick={() => activeId && void exportEntries([activeId])}
              disabled={busy}
              title="Export the original file to a folder"
            >
              <IconDownload />
              Export
            </Button>
          </div>
        )}

        {stats && (
          <div className="absolute bottom-3 left-3 rounded-lg border border-border bg-background/80 px-3 py-2 text-xs backdrop-blur">
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
              <Stat label="Format" value={stats.format} />
              <Stat
                label="Dimensions"
                value={stats.width && stats.height ? `${stats.width} × ${stats.height}` : '—'}
              />
              <Stat label="Aspect" value={aspectRatio(stats.width, stats.height)} />
              <Stat label="Size" value={formatBytes(stats.fileBytes)} />
              {stats.vramBytes > 0 && <Stat label="VRAM" value={formatBytes(stats.vramBytes)} />}
            </dl>
          </div>
        )}

        {!texture && !loading && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div
              className={cn(
                'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-10 py-12 text-center transition-colors',
                dragging ? 'border-ring bg-accent/40' : 'border-border'
              )}
            >
              <IconPhoto className="size-10 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Drop textures here</p>
                <p className="mt-1 text-muted-foreground text-xs">
                  PNG / JPEG / WebP / AVIF / KTX2 — drag images in, or open them.
                </p>
              </div>
              <Button size="sm" onClick={() => inputRef.current?.click()}>
                <IconFolderOpen />
                Open files
              </Button>
            </div>
          </div>
        )}

        {texture && dragging && (
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

        {optimizeScope && (
          <TextureOptimizePanel
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
          accept={IMAGE_ACCEPT}
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
