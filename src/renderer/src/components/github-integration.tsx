import { IconBrandGithub, IconExternalLink, IconPlus, IconTrash } from '@tabler/icons-react'
import { type FormEvent, type ReactElement, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { GithubAccountRow } from '@/lib/project-types'
import { trpc } from '@/lib/trpc'

// Pre-scoped to fine-grained tokens; opens in the browser via the window-open handler.
const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new'

/** Dialog + form to link one owner by pasting a fine-grained token. */
function AddTokenDialog({ trigger }: { trigger: ReactElement }): ReactElement {
  const utils = trpc.useUtils()
  const [open, setOpen] = useState(false)
  const [owner, setOwner] = useState('')
  const [token, setToken] = useState('')
  const ownerId = useId()
  const tokenId = useId()

  const connect = trpc.github.connect.useMutation({
    onSuccess: () => {
      utils.github.listAccounts.invalidate()
      setOwner('')
      setToken('')
      setOpen(false)
    }
  })

  const canSubmit = owner.trim().length > 0 && token.trim().length > 0
  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    connect.mutate({ owner: owner.trim(), token: token.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a GitHub owner</DialogTitle>
          <DialogDescription>
            Paste a fine-grained token for one account or organization. It's validated against
            GitHub, then stored encrypted in your Keychain.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={ownerId}>Account or organization</Label>
              <Input
                id={ownerId}
                placeholder="e.g. aaronclaes"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                required
              />
              <p className="text-muted-foreground text-xs">
                The GitHub user or org this token grants access to.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={tokenId}>Fine-grained token</Label>
              <Input
                id={tokenId}
                type="password"
                placeholder="github_pat_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                required
              />
              <p className="text-muted-foreground text-xs">
                Read-only is enough — grant Contents, Issues, Pull requests and Metadata (read).{' '}
                <a
                  className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-4"
                  href={TOKEN_HELP_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Create one
                  <IconExternalLink className="size-3" />
                </a>
              </p>
            </div>
            {connect.error && (
              <p className="text-destructive-foreground text-sm">{connect.error.message}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" loading={connect.isPending} disabled={!canSubmit}>
              Link owner
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}

/** One linked owner: identity + a disconnect button. */
function AccountRow({ account }: { account: GithubAccountRow }): ReactElement {
  const utils = trpc.useUtils()
  const disconnect = trpc.github.disconnect.useMutation({
    onSuccess: () => utils.github.listAccounts.invalidate()
  })

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
      <IconBrandGithub className="size-5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1">
        <span className="truncate font-medium text-sm">{account.owner}</span>
        <span className="truncate text-muted-foreground text-xs">Signed in as {account.login}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Disconnect ${account.owner}`}
        title={`Disconnect ${account.owner}`}
        loading={disconnect.isPending}
        onClick={() => disconnect.mutate({ owner: account.owner })}
      >
        <IconTrash />
      </Button>
    </div>
  )
}

/** GitHub integration card: link one or more owners by fine-grained token. */
export function GitHubIntegration(): ReactElement {
  const accountsQuery = trpc.github.listAccounts.useQuery()
  const accounts = accountsQuery.data ?? []
  const connected = accounts.length > 0

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground">
          <IconBrandGithub className="size-5" />
        </span>
        <div className="grid flex-1 gap-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            GitHub
            {connected && (
              <Badge variant="success" size="sm">
                Connected
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Link repositories to projects to see issues, PRs, and what needs your attention.
          </CardDescription>
        </div>
        {!connected && (
          <AddTokenDialog
            trigger={
              <Button variant="outline" size="sm">
                <IconBrandGithub />
                Connect
              </Button>
            }
          />
        )}
      </CardHeader>

      {connected && (
        <CardContent className="grid gap-2 pt-0">
          {accounts.map((account) => (
            <AccountRow key={account.owner} account={account} />
          ))}
          <AddTokenDialog
            trigger={
              <Button variant="outline" size="sm" className="mt-1 justify-self-start">
                <IconPlus />
                Add token
              </Button>
            }
          />
        </CardContent>
      )}
    </Card>
  )
}
