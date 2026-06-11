import { IconFile, IconFolder } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { trpc } from '@/lib/trpc'

/**
 * A path field: a text input you can type into, plus a Browse button that opens
 * the native macOS picker (seeded with the current value). Defaults to picking a
 * directory — used for the project default path, a command action's working
 * directory, a repo's local clone path. Set `mode="file"` (with optional
 * `fileFilters`) to pick a single file instead, e.g. an IDE action's
 * `.code-workspace` target.
 */
export function PathInput({
  id,
  value,
  onChange,
  placeholder,
  defaultPath,
  mode = 'directory',
  fileFilters
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Where the picker starts when the field is empty (e.g. the project path).
   *  Without it the dialog reopens at the OS's last-used location. */
  defaultPath?: string
  mode?: 'directory' | 'file'
  /** Selectable file types when `mode="file"` (extensions without the dot). */
  fileFilters?: { name: string; extensions: string[] }[]
}): ReactElement {
  const pickDirectory = trpc.dialog.pickDirectory.useMutation()
  const pickFile = trpc.dialog.pickFile.useMutation()
  const picker = mode === 'file' ? pickFile : pickDirectory

  const browse = (): void => {
    const onSuccess = (picked: string | null): void => {
      if (picked) onChange(picked)
    }
    const startPath = value.trim() || defaultPath || undefined
    if (mode === 'file')
      pickFile.mutate({ defaultPath: startPath, filters: fileFilters }, { onSuccess })
    else pickDirectory.mutate({ defaultPath: startPath }, { onSuccess })
  }

  const BrowseIcon = mode === 'file' ? IconFile : IconFolder

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <InputGroupAddon align="inline-end">
        <Button type="button" variant="ghost" size="sm" loading={picker.isPending} onClick={browse}>
          <BrowseIcon />
          Browse
        </Button>
      </InputGroupAddon>
    </InputGroup>
  )
}
