import type { ReactElement, ReactNode } from 'react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { percent } from './format'

// Presentational building blocks shared by the model and texture optimize panels.

/** A labelled group with a muted heading. */
export function Section({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  )
}

/** Label + slider + numeric readout (quality, Draco quantization, tile repeat). */
export function SliderRow({
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

/** A before → after row with an optional green/amber percentage change. */
export function DeltaRow({
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
