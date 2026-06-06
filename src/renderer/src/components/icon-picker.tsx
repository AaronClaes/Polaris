import { IconSelector } from '@tabler/icons-react'
import { type ReactElement, useState } from 'react'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { selectTriggerIconClassName, selectTriggerVariants } from '@/components/ui/select'
import { getIcon, ICONS } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface IconPickerProps {
  value: string
  onChange: (key: string) => void
}

/** Trigger that opens a popover grid of the curated Tabler icons. */
export function IconPicker({ value, onChange }: IconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const current = getIcon(value)
  const CurrentIcon = current.Icon

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger type="button" className={cn(selectTriggerVariants())}>
        <span className="flex items-center gap-2 truncate">
          <CurrentIcon size={18} />
          {current.label}
        </span>
        <IconSelector className={selectTriggerIconClassName} />
      </PopoverTrigger>
      <PopoverPopup className="w-72" align="start">
        <div className="grid grid-cols-6 gap-1">
          {ICONS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={key === value}
              onClick={() => {
                onChange(key)
                setOpen(false)
              }}
              className={cn(
                'flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent',
                key === value && 'bg-accent text-accent-foreground ring-2 ring-ring'
              )}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  )
}
