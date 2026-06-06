import type { ReactElement } from 'react'
import { getColor } from '@/lib/colors'
import { getIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface ProjectIconProps {
  icon: string
  color: string
  /** Glyph size in px. */
  size?: number
  className?: string
}

/** A project's icon rendered as a color-tinted chip (tinted backdrop + glyph). */
export function ProjectIcon({ icon, color, size = 20, className }: ProjectIconProps): ReactElement {
  const { Icon } = getIcon(icon)
  const { hex } = getColor(color)
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', className)}
      // `${hex}24` ≈ 14% opacity tint behind the full-strength glyph.
      style={{ backgroundColor: `${hex}24`, color: hex }}
    >
      <Icon size={size} stroke={1.75} />
    </span>
  )
}
