import { IconPlus, IconTrash, IconWorld } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import type { InstalledBrowserRow, LinkedBrowserRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** Dropdown of installed-but-unlinked browsers; picking one links it. */
function AddBrowserMenu({
  addable,
  label
}: {
  addable: InstalledBrowserRow[]
  label: string
}): ReactElement {
  const utils = trpc.useUtils()
  const link = trpc.browsers.link.useMutation({
    onSuccess: () => utils.browsers.listLinked.invalidate()
  })

  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" />}>
        <IconPlus />
        {label}
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-48">
        {addable.map((browser) => (
          <MenuItem key={browser.key} onClick={() => link.mutate({ key: browser.key })}>
            {browser.name}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

/** One linked browser: its profiles + an unlink button. */
function BrowserRow({ browser }: { browser: LinkedBrowserRow }): ReactElement {
  const utils = trpc.useUtils()
  const unlink = trpc.browsers.unlink.useMutation({
    onSuccess: () => utils.browsers.listLinked.invalidate()
  })

  const profiles =
    browser.profiles.length > 0
      ? browser.profiles.map((profile) => profile.name).join(', ')
      : 'No profiles found'

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <IconWorld className="size-5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1">
        <span className="truncate font-medium text-sm">{browser.name}</span>
        <span className="truncate text-muted-foreground text-xs">{profiles}</span>
      </div>
      <Button
        variant="destructive-outline"
        size="icon-sm"
        aria-label={`Unlink ${browser.name}`}
        title={`Unlink ${browser.name}`}
        loading={unlink.isPending}
        onClick={() => unlink.mutate({ key: browser.key })}
      >
        <IconTrash />
      </Button>
    </div>
  )
}

/**
 * Browsers integration card: link the Chromium browsers installed on this Mac so
 * their profiles can be targeted by link actions. A link action with no profile
 * still opens in the OS default browser; picking a profile here is what makes it
 * selectable there.
 */
export function BrowsersIntegration(): ReactElement {
  const linkedQuery = trpc.browsers.listLinked.useQuery()
  const installedQuery = trpc.browsers.listInstalled.useQuery()
  const linked = linkedQuery.data ?? []
  const installed = installedQuery.data ?? []

  const linkedKeys = new Set(linked.map((browser) => browser.key))
  const addable = installed.filter((browser) => !linkedKeys.has(browser.key))
  const connected = linked.length > 0

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground">
          <IconWorld className="size-5" />
        </span>
        <div className="grid flex-1 gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            Browsers
            {connected && (
              <Badge variant="success" size="sm">
                {linked.length} linked
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Link installed browsers to open link actions in a specific profile.
          </CardDescription>
        </div>
        {!connected && addable.length > 0 && (
          <AddBrowserMenu addable={addable} label="Add browser" />
        )}
      </CardHeader>

      {connected ? (
        <CardContent className="grid gap-2 pt-0">
          {linked.map((browser) => (
            <BrowserRow key={browser.key} browser={browser} />
          ))}
          {addable.length > 0 && (
            <div className="mt-1">
              <AddBrowserMenu addable={addable} label="Add browser" />
            </div>
          )}
          <p className="mt-1 text-muted-foreground text-xs">
            Dia and Arc can't open links in a specific profile, so they aren't listed.
          </p>
        </CardContent>
      ) : (
        installed.length === 0 && (
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-sm">
              No supported browsers detected. Chromium browsers with profile support (Chrome, Brave,
              Edge, Vivaldi) can be linked. Dia and Arc don't allow targeting a profile from outside
              the app.
            </p>
          </CardContent>
        )
      )}
    </Card>
  )
}
