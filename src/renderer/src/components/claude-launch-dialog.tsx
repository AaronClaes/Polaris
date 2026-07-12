import { type FormEvent, type ReactElement, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectItem, SelectPopup, SelectTrigger } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { trpc } from '@/lib/trpc'

/** Select value standing in for the ''-valued "Default" entries of the Claude
 *  flag registries (base-ui select values must be non-empty strings). */
const CLAUDE_DEFAULT = '__default__'

/** The default kickoff prompt for a worktree's Claude session — just the item
 *  reference; Claude pulls the details itself (e.g. via `gh issue view`). */
export function claudePromptSeed(
  repo: { owner: string; name: string },
  issue: { number: number; title: string }
): string {
  return `Work on ${repo.owner}/${repo.name}#${issue.number}: ${issue.title}`
}

/** One entry of a main-side flag registry (CLAUDE_MODELS / …_PERMISSION_MODES). */
interface FlagOption {
  value: string
  label: string
}

function FlagSelect({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: FlagOption[]
  value: string
  onChange: (value: string) => void
}): ReactElement {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select
        value={value || CLAUDE_DEFAULT}
        onValueChange={(next) => next && onChange(next === CLAUDE_DEFAULT ? '' : next)}
      >
        <SelectTrigger className="w-full">
          <span className="truncate">
            {options.find((entry) => entry.value === value)?.label ?? 'Default'}
          </span>
        </SelectTrigger>
        <SelectPopup>
          {options.map((entry) => (
            <SelectItem key={entry.value} value={entry.value || CLAUDE_DEFAULT}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  )
}

/**
 * The launch fields of a Claude session — prompt plus model / permission-mode
 * selects. Shared by the create dialog's "Start Claude" checkbox and the
 * standalone StartClaudeDialog, so the two surfaces can't drift. `''` values
 * mean Default (the flag is omitted; the user's own claude config decides).
 */
export function ClaudeLaunchFields({
  models,
  permissionModes,
  prompt,
  onPromptChange,
  model,
  onModelChange,
  permissionMode,
  onPermissionModeChange
}: {
  models: FlagOption[]
  permissionModes: FlagOption[]
  prompt: string
  onPromptChange: (value: string) => void
  model: string
  onModelChange: (value: string) => void
  permissionMode: string
  onPermissionModeChange: (value: string) => void
}): ReactElement {
  const promptId = useId()
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={promptId}>Prompt</Label>
        <Textarea
          id={promptId}
          value={prompt}
          onChange={(event) => onPromptChange(event.currentTarget.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FlagSelect label="Model" options={models} value={model} onChange={onModelChange} />
        <FlagSelect
          label="Permissions"
          options={permissionModes}
          value={permissionMode}
          onChange={onPermissionModeChange}
        />
      </div>
    </>
  )
}

/**
 * The standalone "Start Claude" dialog for an existing worktree: prompt
 * (prefilled with the row's item reference when known), model, and permission
 * mode, then an interactive `claude` in the default terminal. Like
 * RemoveWorktreeDialog it renders as a *sibling* of the worktree popover —
 * mount it conditionally and treat onOpenChange(false) as the unmount signal,
 * so every use starts from fresh drafts.
 */
export function StartClaudeDialog({
  path,
  seed,
  onOpenChange
}: {
  path: string
  /** Prefill for the prompt, when the row has item context. */
  seed?: string
  onOpenChange: (open: boolean) => void
}): ReactElement {
  const info = trpc.worktrees.claudeLaunchInfo.useQuery()
  const [promptDraft, setPromptDraft] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState<string | null>(null)
  const [modeDraft, setModeDraft] = useState<string | null>(null)
  const prompt = promptDraft ?? seed ?? ''
  const model = modelDraft ?? info.data?.model ?? ''
  const permissionMode = modeDraft ?? info.data?.permissionMode ?? ''

  const start = trpc.worktrees.startClaude.useMutation({ onSuccess: () => onOpenChange(false) })

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (start.isPending || !info.data) return
    // Sending model/mode explicitly also makes them the remembered defaults.
    start.mutate({ path, prompt, model, permissionMode })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start Claude</DialogTitle>
          <DialogDescription>
            Opens {info.data?.terminal ?? 'your terminal'} at{' '}
            <span className="break-all font-medium text-foreground">{path}</span> with an
            interactive Claude session.
          </DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel className="grid gap-4">
            {info.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-4" /> Loading…
              </div>
            )}
            {info.error && (
              <p className="text-destructive-foreground text-sm">{info.error.message}</p>
            )}
            {info.data && (
              <ClaudeLaunchFields
                models={info.data.models}
                permissionModes={info.data.permissionModes}
                prompt={prompt}
                onPromptChange={setPromptDraft}
                model={model}
                onModelChange={setModelDraft}
                permissionMode={permissionMode}
                onPermissionModeChange={setModeDraft}
              />
            )}
            {start.error && (
              <p className="text-destructive-foreground text-sm">{start.error.message}</p>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!info.data} loading={start.isPending}>
              Start Claude
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
