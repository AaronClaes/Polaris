import { IconSparkles, IconX } from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type { ModelSource, TextureOverride } from './load-model'
import {
  type GeometryCompression,
  type OptimizeOptions,
  type OptimizeResult,
  type OptimizeStats,
  optimizeModel,
  type TextureFormat
} from './optimize-model'

const SIZE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Original' },
  { value: 4096, label: '4096 px' },
  { value: 2048, label: '2048 px' },
  { value: 1024, label: '1024 px' },
  { value: 512, label: '512 px' }
]

/** One model's result in a bulk optimize preview. */
export interface BulkItemResult {
  id: string
  name: string
  status: 'done' | 'skipped' | 'error'
  before?: OptimizeStats
  after?: OptimizeStats
  detail?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function percent(before: number | undefined, after: number | undefined): number {
  if (before == null || after == null || before <= 0) return 0
  return Math.round(((after - before) / before) * 100)
}

function Section({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  )
}

function DeltaRow({
  label,
  before,
  after,
  format,
  showPercent
}: {
  label: string
  before: number
  after: number
  format: (n: number) => string
  showPercent?: boolean
}): ReactElement {
  const pct = percent(before, after)
  return (
    <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span>
        {format(before)} <span className="text-muted-foreground">→</span>{' '}
        <span className="font-medium text-foreground">{format(after)}</span>
        {showPercent && pct !== 0 && (
          <span
            className={cn(
              'ml-1',
              pct < 0 ? 'text-green-600 dark:text-green-500' : 'text-amber-600'
            )}
          >
            {pct > 0 ? '+' : ''}
            {pct}%
          </span>
        )}
      </span>
    </div>
  )
}

/** The full before/after stat block for one optimized model (File size / Texture
 *  data / Triangles / Textures) — the same four rows the single panel shows. */
function StatBlock({
  before,
  after
}: {
  before: OptimizeStats
  after: OptimizeStats
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <DeltaRow
        label="File size"
        before={before.fileBytes}
        after={after.fileBytes}
        format={formatBytes}
        showPercent
      />
      <DeltaRow
        label="Texture data"
        before={before.textureBytes}
        after={after.textureBytes}
        format={formatBytes}
        showPercent
      />
      <DeltaRow
        label="Triangles"
        before={before.triangles}
        after={after.triangles}
        format={(n) => n.toLocaleString()}
      />
      <DeltaRow
        label="Textures"
        before={before.textures}
        after={after.textures}
        format={(n) => String(n)}
      />
    </div>
  )
}

/** One model in the bulk preview: filename header + its full stat block (or a
 *  skip/error label). */
function BulkItemRow({ item }: { item: BulkItemResult }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-xs">{item.name}</span>
        {item.status === 'skipped' && (
          <span className="shrink-0 text-muted-foreground text-xs" title={item.detail}>
            skipped
          </span>
        )}
        {item.status === 'error' && (
          <span className="shrink-0 text-destructive-foreground text-xs" title={item.detail}>
            error
          </span>
        )}
      </div>
      {item.status === 'done' && item.before && item.after && (
        <StatBlock before={item.before} after={item.after} />
      )}
    </div>
  )
}

/**
 * A panel (scoped `absolute` aside inside the viewer, like the texture panel) for
 * optimizing models: WebP re-encode / resize for textures, optional Meshopt
 * geometry compression, with a lossless cleanup pass always applied. Both modes
 * follow the same flow — set options, run a preview, then Load into viewer or
 * download. `single` previews the active model's before/after; `bulk` previews a
 * per-model list across the whole rail.
 */
export function OptimizePanel({
  mode,
  count = 0,
  source,
  overrides,
  onLoadResult,
  onSave,
  onOptimizeAll,
  onLoadAll,
  onSaveAll,
  onClose
}: {
  mode: 'single' | 'bulk'
  count?: number
  source?: ModelSource
  overrides?: Record<string, TextureOverride>
  onLoadResult?: (bytes: Uint8Array) => void
  onSave?: (bytes: Uint8Array) => Promise<void>
  onOptimizeAll?: (options: OptimizeOptions) => Promise<BulkItemResult[]>
  onLoadAll?: () => void
  onSaveAll?: () => Promise<void>
  onClose: () => void
}): ReactElement {
  const [textureFormat, setTextureFormat] = useState<TextureFormat>('webp')
  const [quality, setQuality] = useState(80)
  const [maxSize, setMaxSize] = useState(0)
  const [geometry, setGeometry] = useState<GeometryCompression>('meshopt')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [bulkResults, setBulkResults] = useState<BulkItemResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const options = (): OptimizeOptions => ({
    textureFormat,
    textureQuality: quality / 100,
    maxTextureSize: maxSize,
    geometry
  })

  // Any option change makes the last result/preview stale.
  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T): void => {
      setter(value)
      setResult(null)
      setBulkResults(null)
    }

  const run = async (): Promise<void> => {
    if (!source) return
    setRunning(true)
    setError(null)
    try {
      setResult(await optimizeModel(source, overrides ?? {}, options()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize the model.')
    } finally {
      setRunning(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!result || !onSave) return
    setSaving(true)
    try {
      await onSave(result.bytes)
    } finally {
      setSaving(false)
    }
  }

  // Bulk: run the optimize over the whole list in memory and preview a per-model
  // list. The output is held by the caller for Load into viewer / Download all.
  const runBulkPreview = async (): Promise<void> => {
    if (!onOptimizeAll) return
    setRunning(true)
    setError(null)
    try {
      setBulkResults(await onOptimizeAll(options()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize the models.')
    } finally {
      setRunning(false)
    }
  }

  const saveAll = async (): Promise<void> => {
    if (!onSaveAll) return
    setSaving(true)
    try {
      await onSaveAll()
    } finally {
      setSaving(false)
    }
  }

  const isBulk = mode === 'bulk'
  const doneCount = bulkResults ? bulkResults.filter((item) => item.status === 'done').length : 0

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop; Esc handled above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close */}
      <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-border border-l bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2">
          <h2 className="flex items-center gap-1.5 font-medium text-sm">
            <IconSparkles className="size-4" />
            {isBulk ? `Optimize all (${count})` : 'Optimize'}
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close" aria-label="Close">
            <IconX />
          </Button>
        </header>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-5 p-3">
            <Section label="Textures">
              <ToggleGroup
                variant="outline"
                size="sm"
                className="w-full"
                value={[textureFormat]}
                onValueChange={(value) => {
                  if (value.length)
                    change<TextureFormat>(setTextureFormat)(value[0] as TextureFormat)
                }}
              >
                <ToggleGroupItem value="keep" className="flex-1">
                  Keep format
                </ToggleGroupItem>
                <ToggleGroupItem value="webp" className="flex-1">
                  WebP
                </ToggleGroupItem>
              </ToggleGroup>

              {textureFormat === 'webp' && (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground text-xs">Quality</span>
                  <Slider
                    className="flex-1"
                    min={50}
                    max={100}
                    step={5}
                    value={quality}
                    onValueChange={(value) =>
                      change<number>(setQuality)(Array.isArray(value) ? value[0] : value)
                    }
                  />
                  <span className="w-8 text-right text-muted-foreground text-xs tabular-nums">
                    {quality}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Max resolution</span>
                <Select
                  value={maxSize}
                  onValueChange={(value) => change<number>(setMaxSize)(value as number)}
                >
                  <SelectTrigger size="sm" className="w-32">
                    {SIZE_OPTIONS.find((o) => o.value === maxSize)?.label}
                  </SelectTrigger>
                  <SelectContent>
                    {SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Section>

            <Section label="Geometry">
              <ToggleGroup
                variant="outline"
                size="sm"
                className="w-full"
                value={[geometry]}
                onValueChange={(value) => {
                  if (value.length)
                    change<GeometryCompression>(setGeometry)(value[0] as GeometryCompression)
                }}
              >
                <ToggleGroupItem value="none" className="flex-1">
                  None
                </ToggleGroupItem>
                <ToggleGroupItem value="meshopt" className="flex-1">
                  Meshopt
                </ToggleGroupItem>
              </ToggleGroup>
            </Section>

            <p className="text-muted-foreground text-xs">
              Cleanup (dedup, prune, weld, flatten, join) is always applied.
            </p>

            {isBulk ? (
              <Button onClick={() => void runBulkPreview()} loading={running} disabled={running}>
                <IconSparkles />
                Optimize all ({count})
              </Button>
            ) : (
              <Button onClick={() => void run()} loading={running} disabled={running}>
                <IconSparkles />
                Optimize
              </Button>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive-foreground text-xs">
                {error}
              </div>
            )}

            {isBulk && bulkResults && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex flex-col divide-y divide-border">
                  {bulkResults.map((item) => (
                    <BulkItemRow key={item.id} item={item} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={doneCount === 0}
                    onClick={() => onLoadAll?.()}
                  >
                    Load into viewer
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    loading={saving}
                    disabled={saving || doneCount === 0}
                    onClick={() => void saveAll()}
                  >
                    Download all
                  </Button>
                </div>
              </div>
            )}

            {!isBulk && result && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <StatBlock before={result.before} after={result.after} />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => onLoadResult?.(result.bytes)}
                  >
                    Load into viewer
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    loading={saving}
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    Save GLB
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>
    </>
  )
}
