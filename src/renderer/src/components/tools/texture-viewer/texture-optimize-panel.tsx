import { IconCircleCheck, IconSparkles, IconX } from '@tabler/icons-react'
import { type ReactElement, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ImageFormat, ImageOptimizeOptions, ImageStats } from '@/lib/optimize'
import { formatBytes } from '../shared/format'
import { DeltaRow, Section, SliderRow } from '../shared/stat-rows'

const SIZE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Original' },
  { value: 4096, label: '4096 px' },
  { value: 2048, label: '2048 px' },
  { value: 1024, label: '1024 px' },
  { value: 512, label: '512 px' }
]

const FORMAT_OPTIONS: { value: ImageFormat; label: string }[] = [
  { value: 'keep', label: 'Keep format' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'ktx2', label: 'KTX2 (GPU)' }
]

// Lossy formats expose the quality slider; PNG is lossless and 'keep' re-encodes
// nothing, so neither shows it. KTX2's slider drives ETC1S quality for color maps.
const LOSSY_FORMATS: ImageFormat[] = ['webp', 'avif', 'jpeg', 'ktx2']

/**
 * One texture in the optimize panel's preview list — the single flow (a list of
 * one) and bulk flow (a list of N) share this shape. `before`/`after` set once
 * optimized; `state` carries an in-flight/failed marker; `optimizable` is false
 * for KTX2 (no main-side transcoder).
 */
export interface TextureOptimizeRow {
  id: string
  name: string
  optimizable: boolean
  before?: ImageStats
  after?: ImageStats
  state?: 'running' | 'error'
  detail?: string
}

function dimensions(stats: ImageStats): string {
  return stats.width && stats.height ? `${stats.width}×${stats.height}` : '—'
}

/** Before/after stat block for one optimized texture (File size / VRAM / Resolution). */
function StatBlock({ before, after }: { before: ImageStats; after: ImageStats }): ReactElement {
  const resized = before.width !== after.width || before.height !== after.height
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
        label="VRAM"
        before={before.vramBytes}
        after={after.vramBytes}
        format={formatBytes}
        showPercent
      />
      <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
        <span className="text-muted-foreground">Format</span>
        <span>
          {before.format} <span className="text-muted-foreground">→</span>{' '}
          <span className="font-medium text-foreground">{after.format}</span>
        </span>
      </div>
      {resized && (
        <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
          <span className="text-muted-foreground">Resolution</span>
          <span>
            {dimensions(before)} <span className="text-muted-foreground">→</span>{' '}
            <span className="font-medium text-foreground">{dimensions(after)}</span>
          </span>
        </div>
      )}
    </div>
  )
}

/** One texture row: filename header + its stat block (or a running / skipped /
 *  error marker). Single and bulk render the same row. */
function ResultRow({ row }: { row: TextureOptimizeRow }): ReactElement {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-xs">{row.name}</span>
        {!row.optimizable ? (
          <span className="shrink-0 text-muted-foreground text-xs" title="KTX2 can't be re-encoded">
            skipped
          </span>
        ) : row.state === 'running' ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : row.state === 'error' ? (
          <span className="shrink-0 text-destructive-foreground text-xs" title={row.detail}>
            error
          </span>
        ) : null}
      </div>
      {row.before && row.after && <StatBlock before={row.before} after={row.after} />}
    </div>
  )
}

/**
 * The optimize panel for textures: re-encode/resize a single image or the whole
 * list, with the same scoped-by-id flow as the model viewer (single = list of one).
 * Work runs in the main process; this panel gathers options and calls the parent's
 * handlers, then shows the per-texture before/after and Load / Save actions.
 */
export function TextureOptimizePanel({
  rows,
  busy,
  onOptimize,
  onInvalidate,
  onLoad,
  onSave,
  onClose
}: {
  rows: TextureOptimizeRow[]
  busy: boolean
  onOptimize: (options: ImageOptimizeOptions) => Promise<void>
  onInvalidate: () => void
  onLoad: () => void
  onSave: () => Promise<void>
  onClose: () => void
}): ReactElement {
  const [format, setFormat] = useState<ImageFormat>('webp')
  const [quality, setQuality] = useState(80)
  const [maxSize, setMaxSize] = useState(0)
  const [ktx2Normal, setKtx2Normal] = useState(false)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const options = (): ImageOptimizeOptions => ({
    format,
    quality: quality / 100,
    maxSize,
    ktx2Normal
  })

  // Any option change makes the last preview stale: clear the parent's results.
  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T): void => {
      setter(value)
      setSaved(false)
      onInvalidate()
    }

  const run = async (): Promise<void> => {
    setRunning(true)
    setSaved(false)
    setError(null)
    try {
      await onOptimize(options())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize.')
    } finally {
      setRunning(false)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave()
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const optimizable = rows.filter((row) => row.optimizable).length
  const doneCount = rows.filter((row) => row.before && row.after).length
  const hasActivity = rows.some((row) => row.before != null || row.state != null)
  const isSingle = rows.length === 1
  const title = isSingle ? 'Optimize' : `Optimize all (${optimizable})`

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop; Esc handled above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close */}
      <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-border border-l bg-background shadow-xl">
        <header className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2">
          <h2 className="flex items-center gap-1.5 font-medium text-sm">
            <IconSparkles className="size-4" />
            {title}
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close" aria-label="Close">
            <IconX />
          </Button>
        </header>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-5 p-3">
            <Section label="Format">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Output</span>
                <Select
                  value={format}
                  onValueChange={(value) => change<ImageFormat>(setFormat)(value as ImageFormat)}
                >
                  <SelectTrigger size="sm" className="w-32">
                    {FORMAT_OPTIONS.find((o) => o.value === format)?.label}
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {LOSSY_FORMATS.includes(format) && (
                <SliderRow
                  label="Quality"
                  min={50}
                  max={100}
                  step={5}
                  value={quality}
                  onChange={change<number>(setQuality)}
                />
              )}

              {format === 'jpeg' && (
                <p className="text-[11px] text-muted-foreground">
                  JPEG has no transparency or lossless mode — best for opaque color maps.
                </p>
              )}

              {format === 'ktx2' && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs">Map type</span>
                    <ToggleGroup
                      variant="outline"
                      size="sm"
                      value={[ktx2Normal ? 'normal' : 'color']}
                      onValueChange={(value) => {
                        if (value.length) change<boolean>(setKtx2Normal)(value[0] === 'normal')
                      }}
                    >
                      <ToggleGroupItem value="color" className="px-4">
                        Color
                      </ToggleGroupItem>
                      <ToggleGroupItem value="normal" className="px-4">
                        Normal
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    GPU-compressed (Basis): stays compressed in VRAM. Often larger on disk than
                    WebP, but far lighter on GPU memory. Color uses ETC1S; Normal uses UASTC for
                    linear / normal maps.
                  </p>
                </>
              )}
            </Section>

            <Section label="Resolution">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Max size</span>
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

            <Button onClick={() => void run()} loading={running} disabled={running || busy}>
              <IconSparkles />
              {title}
            </Button>

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive-foreground text-xs">
                {error}
              </div>
            )}

            {hasActivity && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex flex-col divide-y divide-border">
                  {rows.map((row) => (
                    <ResultRow key={row.id} row={row} />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={doneCount === 0 || busy}
                    onClick={() => onLoad()}
                  >
                    Load into viewer
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    loading={saving}
                    disabled={saving || busy || doneCount === 0}
                    onClick={() => void save()}
                  >
                    {isSingle ? 'Save' : 'Download all'}
                  </Button>
                </div>
                {saved && (
                  <p className="flex items-center justify-center gap-1 text-green-600 text-xs dark:text-green-500">
                    <IconCircleCheck className="size-3.5" />
                    {isSingle ? 'Saved' : `Saved ${doneCount} textures`}
                  </p>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>
    </>
  )
}
