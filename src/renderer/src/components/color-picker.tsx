import { IconCheck, IconSelector } from '@tabler/icons-react'
import { type ReactElement, useState } from 'react'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { selectTriggerIconClassName, selectTriggerVariants } from '@/components/ui/select'
import { getColor, PROJECT_COLORS } from '@/lib/colors'
import { cn } from '@/lib/utils'

interface ColorPickerProps {
  value: string
  onChange: (key: string) => void
}

/** Trigger that opens a popover grid of the palette swatches. */
export function ColorPicker({ value, onChange }: ColorPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const current = getColor(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger type="button" className={cn(selectTriggerVariants())}>
        <span className="flex items-center gap-2 truncate">
          <span className="size-4 rounded-full" style={{ backgroundColor: current.hex }} />
          {current.name}
        </span>
        <IconSelector className={selectTriggerIconClassName} />
      </PopoverTrigger>
      <PopoverPopup className="w-56" align="start">
        <div className="grid grid-cols-5 gap-2">
          {PROJECT_COLORS.map((color) => {
            const selected = color.key === value
            return (
              <button
                key={color.key}
                type="button"
                title={color.name}
                aria-label={color.name}
                aria-pressed={selected}
                onClick={() => {
                  onChange(color.key)
                  setOpen(false)
                }}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full transition hover:scale-110',
                  selected && 'ring-2 ring-foreground/40 ring-offset-2 ring-offset-popover'
                )}
                style={{ backgroundColor: color.hex }}
              >
                {selected && <IconCheck size={16} stroke={3} className="text-white drop-shadow" />}
              </button>
            )
          })}
        </div>
      </PopoverPopup>
    </Popover>
  )
}
