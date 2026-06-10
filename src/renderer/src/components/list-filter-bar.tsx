import { IconCheck, IconChevronLeft, IconPlus, IconSearch, IconX } from '@tabler/icons-react'
import { type ReactElement, type ReactNode, useMemo, useState } from 'react'
import { ProjectIcon } from '@/components/project-icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverPrimitive, PopoverTrigger } from '@/components/ui/popover'
import {
  type ActiveFilter,
  type FilterField,
  type FilterOption,
  NONE_VALUE
} from '@/lib/list-filters'
import { cn } from '@/lib/utils'

/**
 * A plain auto-sizing popover popup — deliberately *not* the shared
 * {@link PopoverPopup}, whose `Popover.Viewport` pins the popup to the size
 * measured on open (it only re-measures when the trigger's payload changes, a
 * multi-trigger feature we don't use). Our popovers swap content in place
 * (field list → value list), so they need a popup that resizes to its content
 * on every render.
 */
function FilterPopup({ children }: { children: ReactNode }): ReactElement {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align="start"
        sideOffset={6}
        className="z-50 max-w-(--available-width)"
      >
        <PopoverPrimitive.Popup className="max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg/5 outline-none transition-[opacity,scale] data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

/** Add/remove a value from a list (the OR-set for one field). */
function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

/** The leading glyph for an option: avatar (user), color dot (label), project
 *  icon, or nothing (plain / None). */
function OptionAdornment({ option }: { option: FilterOption }): ReactElement | null {
  if (option.kind === 'user') {
    return (
      <Avatar className="size-5 shrink-0">
        {option.avatarUrl && <AvatarImage src={option.avatarUrl} alt={option.label} />}
        <AvatarFallback className="text-[0.6rem]">
          {option.label.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    )
  }
  if (option.kind === 'color') {
    return (
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
    )
  }
  if (option.kind === 'project' && option.project) {
    return (
      <ProjectIcon
        icon={option.project.icon}
        color={option.project.color}
        size={12}
        className="size-4.5 shrink-0"
      />
    )
  }
  return null
}

/** One selectable row: a checkbox-styled marker, the adornment, and the label. */
function OptionRow({
  option,
  checked,
  onToggle
}: {
  option: FilterOption
  checked: boolean
  onToggle: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50"
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
        )}
      >
        {checked && <IconCheck className="size-3" />}
      </span>
      <OptionAdornment option={option} />
      <span
        className={cn('truncate', option.value === NONE_VALUE && 'text-muted-foreground italic')}
      >
        {option.label}
      </span>
    </button>
  )
}

/** The value picker: a header, a search box, and the checkbox list. `onBack`
 *  (shown as a chevron) returns to the field list in the add flow. */
function FilterValueList({
  label,
  options,
  values,
  onToggle,
  onBack
}: {
  label: string
  options: FilterOption[]
  values: string[]
  onToggle: (value: string) => void
  onBack?: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(values), [values])
  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options

  return (
    <div className="flex w-60 flex-col gap-2">
      <div className="flex items-center gap-1">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="-ml-1 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <IconChevronLeft className="size-4" />
          </button>
        )}
        <span className="font-medium text-sm">{label}</span>
      </div>
      <InputGroup>
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput
          autoFocus
          size="sm"
          placeholder={`Filter ${label.toLowerCase()}…`}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </InputGroup>
      <div className="-mx-1 max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-center text-muted-foreground text-xs">No options</p>
        ) : (
          filtered.map((option) => (
            <OptionRow
              key={option.value}
              option={option}
              checked={selected.has(option.value)}
              onToggle={() => onToggle(option.value)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/** An active filter as a pill: the field + selected summary opens the editor;
 *  the trailing × removes it. */
function FilterBadge({
  label,
  options,
  values,
  onChange,
  onRemove
}: {
  label: string
  options: FilterOption[]
  values: string[]
  onChange: (values: string[]) => void
  onRemove: () => void
}): ReactElement {
  const labelByValue = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options]
  )
  const names = values.map((value) => labelByValue.get(value) ?? value)
  const summary = names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1}`

  return (
    <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted/40 text-sm">
      <Popover>
        <PopoverTrigger className="flex h-full max-w-64 items-center gap-1 rounded-l-md py-0 pr-1.5 pl-2 outline-none transition-colors hover:bg-accent focus-visible:bg-accent">
          <span className="font-medium">{label}</span>
          <span className="truncate text-muted-foreground">is {summary}</span>
        </PopoverTrigger>
        <FilterPopup>
          <FilterValueList
            label={label}
            options={options}
            values={values}
            onToggle={(value) => onChange(toggleValue(values, value))}
          />
        </FilterPopup>
      </Popover>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="flex h-full items-center rounded-r-md px-1.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
      >
        <IconX className="size-3.5" />
      </button>
    </span>
  )
}

/** The "Add filter" entry point: pick a field, then its values. The picked field
 *  is held locally so it stays open even once selecting a value makes it active
 *  (and drops it from `available`). */
function AddFilterButton({
  available,
  optionsByField,
  getValues,
  onToggle
}: {
  available: { id: string; label: string }[]
  optionsByField: Map<string, FilterOption[]>
  getValues: (fieldId: string) => string[]
  onToggle: (fieldId: string, value: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<{ id: string; label: string } | null>(null)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setField(null)
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="border-dashed text-muted-foreground" />
        }
      >
        <IconPlus />
        Add filter
      </PopoverTrigger>
      <FilterPopup>
        {field == null ? (
          <div className="flex w-60 flex-col">
            <p className="px-2 pb-1 font-medium text-muted-foreground text-xs">Filter by</p>
            {available.length === 0 ? (
              <p className="px-2 py-2 text-muted-foreground text-xs">No more filters.</p>
            ) : (
              available.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setField(entry)}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50"
                >
                  {entry.label}
                </button>
              ))
            )}
          </div>
        ) : (
          <FilterValueList
            label={field.label}
            options={optionsByField.get(field.id) ?? []}
            values={getValues(field.id)}
            onToggle={(value) => onToggle(field.id, value)}
            onBack={() => setField(null)}
          />
        )}
      </FilterPopup>
    </Popover>
  )
}

/**
 * Filtering for a list, split into two pieces so they can sit in different
 * places: an `addButton` (kept in the toolbar, so it stays put) and a `badges`
 * row of active-filter pills (rendered below, free to grow). Options for every
 * field are derived once from the loaded `rows`. Several values within a field
 * are OR'd; separate filters AND together (the predicate lives in
 * {@link rowMatchesFilters}). Clearing a field's last value removes its filter.
 */
export function useListFilters<T>({
  fields,
  rows,
  value,
  onChange
}: {
  fields: FilterField<T>[]
  rows: T[]
  value: ActiveFilter[]
  onChange: (next: ActiveFilter[]) => void
}): { addButton: ReactNode; badges: ReactNode } {
  const optionsByField = useMemo(
    () => new Map(fields.map((field) => [field.id, field.buildOptions(rows)])),
    [fields, rows]
  )
  const activeIds = new Set(value.map((filter) => filter.fieldId))
  const available = fields
    .filter((field) => !activeIds.has(field.id))
    .map((field) => ({ id: field.id, label: field.label }))

  const getValues = (fieldId: string): string[] =>
    value.find((filter) => filter.fieldId === fieldId)?.values ?? []

  const setValues = (fieldId: string, values: string[]): void => {
    if (values.length === 0) {
      onChange(value.filter((filter) => filter.fieldId !== fieldId))
    } else if (activeIds.has(fieldId)) {
      onChange(value.map((filter) => (filter.fieldId === fieldId ? { fieldId, values } : filter)))
    } else {
      onChange([...value, { fieldId, values }])
    }
  }

  const addButton = (
    <AddFilterButton
      available={available}
      optionsByField={optionsByField}
      getValues={getValues}
      onToggle={(fieldId, value_) => setValues(fieldId, toggleValue(getValues(fieldId), value_))}
    />
  )

  const badges =
    value.length === 0 ? null : (
      <div className="flex flex-wrap items-center gap-2">
        {value.map((filter) => {
          const field = fields.find((candidate) => candidate.id === filter.fieldId)
          if (!field) return null
          return (
            <FilterBadge
              key={field.id}
              label={field.label}
              options={optionsByField.get(field.id) ?? []}
              values={filter.values}
              onChange={(values) => setValues(field.id, values)}
              onRemove={() => setValues(field.id, [])}
            />
          )
        })}
      </div>
    )

  return { addButton, badges }
}
