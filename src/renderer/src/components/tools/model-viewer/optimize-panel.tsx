import { IconCircleCheck, IconSparkles, IconX } from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DRACO_DEFAULTS,
  type GeometryCompression,
  type OptimizeOptions,
  type OptimizeStats,
  type TextureFormat
} from '@/lib/optimize'
import { cn } from '@/lib/utils'

const SIZE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Original' },
  { value: 4096, label: '4096 px' },
  { value: 2048, label: '2048 px' },
  { value: 1024, label: '1024 px' },
  { value: 512, label: '512 px' }
]

const FORMAT_OPTIONS: { value: TextureFormat; label: string }[] = [
  { value: 'keep', label: 'Keep format' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' }
]

// Lossy formats expose the quality slider; PNG is lossless and 'keep' re-encodes
// nothing, so neither shows it.
const LOSSY_FORMATS: TextureFormat[] = ['webp', 'avif', 'jpeg']

/**
 * One model in the optimize panel's preview list. The same shape backs the single
 * flow (a list of one) and the bulk flow (a list of N) — there is no separate
 * single/bulk render path. `before`/`after` set once the model has been optimized;
 * `state` carries an in-flight/failed marker; `optimizable` is false for OBJ.
 */
export interface OptimizeRow {
  id: string
  name: string
  optimizable: boolean
  before?: OptimizeStats
  after?: OptimizeStats
  state?: 'running' | 'error'
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

/** Label + slider + numeric readout, used for the WebP quality and Draco
 *  quantization controls. */
function SliderRow({
  label,
  min,
  max,
  step = 1,
  value,
  onChange
}: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
}): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 text-muted-foreground text-xs">{label}</span>
      <Slider
        className="w-32"
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
      />
      <span className="w-8 text-right text-muted-foreground text-xs tabular-nums">{value}</span>
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
 *  data / Triangles / Textures). */
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

/** One model in the preview list: filename header + its stat block (or a
 *  running / skipped / error marker). Single and bulk render the same row. */
function ResultRow({ row }: { row: OptimizeRow }): ReactElement {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-xs">{row.name}</span>
        {!row.optimizable ? (
          <span className="shrink-0 text-muted-foreground text-xs" title="OBJ not supported">
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
 * A panel (scoped `absolute` aside inside the viewer, like the texture panel) for
 * optimizing models: WebP re-encode / resize for textures, optional Meshopt/Draco
 * geometry compression, with a lossless cleanup pass always applied. The work runs
 * in the main process — the panel gathers options and calls the parent's handlers.
 *
 * There is one flow, scoped by `rows`: a single model is a list of one; "all" is a
 * list of N. The parent owns the results (so the rail and viewer stay in sync); the
 * panel just shows them and triggers Optimize / Load into viewer / Save over the
 * whole list.
 */
export function OptimizePanel({
  rows,
  busy,
  onOptimize,
  onInvalidate,
  onLoad,
  onSave,
  onClose
}: {
  rows: OptimizeRow[]
  busy: boolean
  onOptimize: (options: OptimizeOptions) => Promise<void>
  onInvalidate: () => void
  onLoad: () => void
  onSave: () => Promise<void>
  onClose: () => void
}): ReactElement {
  const [textureFormat, setTextureFormat] = useState<TextureFormat>('webp')
  const [quality, setQuality] = useState(80)
  const [maxSize, setMaxSize] = useState(0)
  const [geometry, setGeometry] = useState<GeometryCompression>('draco')
  const [dracoPosition, setDracoPosition] = useState(DRACO_DEFAULTS.quantizePosition)
  const [dracoNormal, setDracoNormal] = useState(DRACO_DEFAULTS.quantizeNormal)
  const [dracoTexcoord, setDracoTexcoord] = useState(DRACO_DEFAULTS.quantizeTexcoord)
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

  const options = (): OptimizeOptions => ({
    textureFormat,
    textureQuality: quality / 100,
    maxTextureSize: maxSize,
    geometry,
    draco: {
      quantizePosition: dracoPosition,
      quantizeNormal: dracoNormal,
      quantizeTexcoord: dracoTexcoord
    }
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
            <Section label="Textures">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground text-xs">Format</span>
                <Select
                  value={textureFormat}
                  onValueChange={(value) =>
                    change<TextureFormat>(setTextureFormat)(value as TextureFormat)
                  }
                >
                  <SelectTrigger size="sm" className="w-32">
                    {FORMAT_OPTIONS.find((o) => o.value === textureFormat)?.label}
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

              {LOSSY_FORMATS.includes(textureFormat) && (
                <SliderRow
                  label="Quality"
                  min={50}
                  max={100}
                  step={5}
                  value={quality}
                  onChange={change<number>(setQuality)}
                />
              )}

              {textureFormat === 'jpeg' && (
                <p className="text-[11px] text-muted-foreground">
                  JPEG has no transparency or lossless mode — best for opaque color maps.
                </p>
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
                <ToggleGroupItem value="draco" className="flex-1">
                  Draco
                </ToggleGroupItem>
              </ToggleGroup>

              {geometry === 'draco' && (
                <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-2.5">
                  <span className="text-[11px] text-muted-foreground">
                    Quantization bits — fewer is smaller but lossier.
                  </span>
                  <SliderRow
                    label="Position"
                    min={8}
                    max={16}
                    value={dracoPosition}
                    onChange={change<number>(setDracoPosition)}
                  />
                  <SliderRow
                    label="Normal"
                    min={6}
                    max={12}
                    value={dracoNormal}
                    onChange={change<number>(setDracoNormal)}
                  />
                  <SliderRow
                    label="Texture (UV)"
                    min={8}
                    max={14}
                    value={dracoTexcoord}
                    onChange={change<number>(setDracoTexcoord)}
                  />
                </div>
              )}
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
                    {isSingle ? 'Save GLB' : 'Download all'}
                  </Button>
                </div>
                {saved && (
                  <p className="flex items-center justify-center gap-1 text-green-600 text-xs dark:text-green-500">
                    <IconCircleCheck className="size-3.5" />
                    {isSingle ? 'Saved' : `Saved ${doneCount} models`}
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
