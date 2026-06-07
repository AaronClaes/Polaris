import { IconSelector } from '@tabler/icons-react'
import { type ReactElement, useState } from 'react'
import { FaviconImg } from '@/components/action-icon'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
import { selectTriggerIconClassName, selectTriggerVariants } from '@/components/ui/select'
import { FAVICON_ICON_KEY } from '@/lib/favicon'
import { getIcon, ICONS } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface IconPickerProps {
  value: string
  onChange: (key: string) => void
  /** When provided (link actions), offers a leading "Favicon" option whose
   *  glyph is the site's favicon for this URL. Pass `undefined` to hide it. */
  linkUrl?: string
}

const cellClassName =
  'flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent'

/** Trigger that opens a popover grid of the curated Tabler icons. For link
 *  actions it also offers the site's favicon as the first (default) option. */
export function IconPicker({ value, onChange, linkUrl }: IconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const showFavicon = linkUrl !== undefined
  const isFavicon = showFavicon && value === FAVICON_ICON_KEY
  const current = getIcon(value)
  const CurrentIcon = current.Icon

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger type="button" className={cn(selectTriggerVariants())}>
        <span className="flex items-center gap-2 truncate">
          {isFavicon ? (
            <>
              <FaviconImg url={linkUrl} size={18} />
              Favicon
            </>
          ) : (
            <>
              <CurrentIcon size={18} />
              {current.label}
            </>
          )}
        </span>
        <IconSelector className={selectTriggerIconClassName} />
      </PopoverTrigger>
      <PopoverPopup className="w-72" align="start">
        <div className="grid grid-cols-6 gap-1">
          {showFavicon && (
            <button
              type="button"
              title="Favicon"
              aria-label="Favicon"
              aria-pressed={isFavicon}
              onClick={() => {
                onChange(FAVICON_ICON_KEY)
                setOpen(false)
              }}
              className={cn(
                cellClassName,
                isFavicon && 'bg-accent text-accent-foreground ring-2 ring-ring'
              )}
            >
              <FaviconImg url={linkUrl} size={18} />
            </button>
          )}
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
                cellClassName,
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
