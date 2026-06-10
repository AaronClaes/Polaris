import { IconChevronDown, IconSortAscending, IconSortDescending } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/menu'
import { SORT_FIELDS, type SortFieldId, type SortState } from '@/lib/list-sort'

/**
 * The list sort control: a dropdown to pick the field plus a button to flip the
 * direction. Sits next to the Add-filter button on the issue/PR toolbars; the
 * same four fields serve both lists, so one control covers every surface.
 */
export function ListSort({
  value,
  onChange
}: {
  value: SortState
  onChange: (next: SortState) => void
}): ReactElement {
  const active = SORT_FIELDS.find((field) => field.id === value.field) ?? SORT_FIELDS[0]
  const isDesc = value.direction === 'desc'
  const DirectionIcon = isDesc ? IconSortDescending : IconSortAscending

  return (
    <div className="flex items-center gap-1">
      <Menu>
        <MenuTrigger render={<Button variant="outline" size="sm" />}>
          {active.label}
          <IconChevronDown />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-44">
          <MenuRadioGroup
            value={value.field}
            onValueChange={(field) => onChange({ ...value, field: field as SortFieldId })}
          >
            {SORT_FIELDS.map((field) => (
              <MenuRadioItem key={field.id} value={field.id}>
                {field.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={isDesc ? 'Sort descending' : 'Sort ascending'}
        title={isDesc ? 'Sort descending' : 'Sort ascending'}
        onClick={() => onChange({ ...value, direction: isDesc ? 'asc' : 'desc' })}
      >
        <DirectionIcon />
      </Button>
    </div>
  )
}
