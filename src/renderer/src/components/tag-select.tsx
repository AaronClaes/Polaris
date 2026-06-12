import type { ReactElement } from 'react'
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@/components/ui/select'
import { getColor } from '@/lib/colors'
import type { TagRow } from '@/lib/project-types'

// base-ui Select values are strings; this sentinel stands in for "no tag" so the
// option is selectable (clearing a project's tag), distinct from any numeric id.
const NO_TAG = '__none__'

/** A small filled dot in a tag's palette color — the only visual a tag gets. */
export function TagDot({ color, className }: { color: string; className?: string }): ReactElement {
  return (
    <span
      className={className ?? 'size-3 shrink-0 rounded-full'}
      style={{ backgroundColor: getColor(color).hex }}
    />
  )
}

interface TagSelectProps {
  tags: TagRow[]
  value: number | null
  onChange: (tagId: number | null) => void
}

/** Pick a project's single optional tag (or "No tag"). Used in the create-project
 * dialog and the project's General settings. */
export function TagSelect({ tags, value, onChange }: TagSelectProps): ReactElement {
  const selected = value != null ? tags.find((tag) => tag.id === value) : undefined

  return (
    <Select
      value={value == null ? NO_TAG : String(value)}
      onValueChange={(next) => {
        if (!next) return
        onChange(next === NO_TAG ? null : Number(next))
      }}
    >
      <SelectTrigger>
        <span className="flex items-center gap-2 truncate">
          {selected ? (
            <>
              <TagDot color={selected.color} />
              {selected.label}
            </>
          ) : (
            <span className="text-muted-foreground">No tag</span>
          )}
        </span>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NO_TAG}>
          <span className="text-muted-foreground">No tag</span>
        </SelectItem>
        {tags.map((tag) => (
          <SelectItem key={tag.id} value={String(tag.id)}>
            <span className="flex items-center gap-2 truncate">
              <TagDot color={tag.color} />
              {tag.label}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  )
}
