import type { ReactElement } from 'react'
import { useEffect } from 'react'
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { useUiStore } from '@/stores/ui-store'

export function CommandPalette(): ReactElement {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const toggle = useUiStore((s) => s.toggleCommandPalette)

  // Cmd/Ctrl+K opens the palette when the window is focused.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup>
        <Command>
          <CommandInput placeholder="Type a command or search…" />
          <CommandList>
            <CommandEmpty>No commands found.</CommandEmpty>
            <CommandItem
              onClick={() => {
                // Placeholder — real commands (open project, new session, …) land here.
                console.info('Polaris: placeholder command invoked')
                setOpen(false)
              }}
            >
              Placeholder command
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
