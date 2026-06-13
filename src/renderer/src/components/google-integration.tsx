import { IconBrandGoogle, IconTrash } from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { GoogleAccountRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

/** One linked Google account: identity + a disconnect button. */
function AccountRow({ account }: { account: GoogleAccountRow }): ReactElement {
  const utils = trpc.useUtils()
  const disconnect = trpc.google.disconnect.useMutation({
    onSuccess: () => utils.google.listAccounts.invalidate()
  })

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <IconBrandGoogle className="size-5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1">
        <span className="truncate font-medium text-sm">{account.name ?? account.email}</span>
        <span className="truncate text-muted-foreground text-xs">{account.email}</span>
      </div>
      <Button
        variant="destructive-outline"
        size="icon-sm"
        aria-label={`Disconnect ${account.email}`}
        title={`Disconnect ${account.email}`}
        loading={disconnect.isPending}
        onClick={() => disconnect.mutate({ email: account.email })}
      >
        <IconTrash />
      </Button>
    </div>
  )
}

/** Google integration card: link one or more accounts via the OAuth consent
 *  flow. Clicking Connect opens the system browser; the grant is stored
 *  encrypted in the Keychain and only account metadata is shown here. */
export function GoogleIntegration(): ReactElement {
  const utils = trpc.useUtils()
  const accountsQuery = trpc.google.listAccounts.useQuery()
  const accounts = accountsQuery.data ?? []
  const connected = accounts.length > 0

  // The flow stays pending while the user consents in the browser, so the button
  // shows a spinner until the redirect lands (or it times out).
  const connect = trpc.google.connect.useMutation({
    onSuccess: () => utils.google.listAccounts.invalidate()
  })

  const connectButton = (label: string, className?: string): ReactElement => (
    <Button
      variant="outline"
      size="sm"
      className={className}
      loading={connect.isPending}
      onClick={() => connect.mutate()}
    >
      <IconBrandGoogle />
      {label}
    </Button>
  )

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground">
          <IconBrandGoogle className="size-5" />
        </span>
        <div className="grid flex-1 gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            Google
            {connected && (
              <Badge variant="success" size="sm">
                Connected
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Connect your calendar to see today's meetings on the dashboard.
          </CardDescription>
        </div>
        {!connected && connectButton('Connect')}
      </CardHeader>

      {connected && (
        <CardContent className="grid gap-2 pt-0">
          {accounts.map((account) => (
            <AccountRow key={account.email} account={account} />
          ))}
          {connectButton('Add account', 'mt-1 justify-self-start')}
        </CardContent>
      )}

      {connect.error && (
        <CardContent className="pt-0">
          <p className="text-destructive-foreground text-sm">{connect.error.message}</p>
        </CardContent>
      )}
    </Card>
  )
}
