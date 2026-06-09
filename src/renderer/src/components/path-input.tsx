import { IconFolder } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { trpc } from '@/lib/trpc'

/**
 * A directory path field: a text input you can type into, plus a Browse button
 * that opens the native macOS folder picker (seeded with the current value).
 * Used everywhere a local directory is entered — the project default path, a
 * command action's working directory, a repo's local clone path.
 */
export function PathInput({
  id,
  value,
  onChange,
  placeholder
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): ReactElement {
  const pickDirectory = trpc.dialog.pickDirectory.useMutation()

  const browse = (): void => {
    pickDirectory.mutate(
      { defaultPath: value.trim() || undefined },
      { onSuccess: (picked) => picked && onChange(picked) }
    )
  }

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <InputGroupAddon align="inline-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={pickDirectory.isPending}
          onClick={browse}
        >
          <IconFolder />
          Browse
        </Button>
      </InputGroupAddon>
    </InputGroup>
  )
}
