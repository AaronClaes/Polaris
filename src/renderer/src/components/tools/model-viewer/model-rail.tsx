import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconDownload,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconX
} from '@tabler/icons-react'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** One model in the rail: the files needed to load it plus display meta. */
export interface ModelEntry {
  id: string
  name: string
  /** Display badge: GLB / glTF / OBJ. */
  format: string
  kind: 'glb' | 'gltf' | 'obj'
  /** Total bytes of the model's files (the model + any sidecars). */
  bytes: number
  /** Main file first, then sidecars (.bin / textures / .mtl). */
  files: File[]
}

/** Per-entry status during/after a bulk export or optimize run. */
export interface EntryStatus {
  state: 'running' | 'done' | 'error' | 'skipped'
  /** File size before/after — set for a completed optimize, to show the delta. */
  before?: number
  after?: number
  detail?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatusBadge({ status }: { status: EntryStatus | undefined }): ReactElement | null {
  if (!status) return null
  if (status.state === 'running') return <Spinner className="size-3.5 text-muted-foreground" />
  if (status.state === 'error') {
    return (
      <span title={status.detail}>
        <IconAlertCircle className="size-3.5 text-destructive-foreground" />
      </span>
    )
  }
  if (status.state === 'skipped') {
    return (
      <span className="text-[10px] text-muted-foreground" title={status.detail}>
        skipped
      </span>
    )
  }
  if (status.before != null && status.after != null && status.before > 0) {
    const pct = Math.round(((status.after - status.before) / status.before) * 100)
    return (
      <span
        className={cn(
          'text-[10px] tabular-nums',
          pct < 0 ? 'text-green-600 dark:text-green-500' : 'text-muted-foreground'
        )}
      >
        {pct > 0 ? '+' : ''}
        {pct}%
      </span>
    )
  }
  return <IconCircleCheck className="size-3.5 text-green-600 dark:text-green-500" />
}

/**
 * The left rail: a collapsible, macOS-Preview-style list of loaded models. Pick a
 * row to view it (only the active one is rendered), cycle with the prev/next
 * buttons, remove rows, add more, and run Export all / Optimize all over the whole
 * list. Collapses to a thin strip that still exposes expand + add.
 */
export function ModelRail({
  entries,
  activeId,
  status,
  collapsed,
  busy,
  onSelect,
  onCycle,
  onRemove,
  onAdd,
  onClear,
  onToggleCollapse,
  onExportAll,
  onOptimizeAll
}: {
  entries: ModelEntry[]
  activeId: string | null
  status: Record<string, EntryStatus>
  collapsed: boolean
  busy: boolean
  onSelect: (id: string) => void
  onCycle: (delta: 1 | -1) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onClear: () => void
  onToggleCollapse: () => void
  onExportAll: () => void
  onOptimizeAll: () => void
}): ReactElement {
  if (collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-border border-r bg-background p-1">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onToggleCollapse}
          title="Show models"
          aria-label="Show models"
        >
          <IconLayoutSidebarLeftExpand />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onAdd}
          title="Add models"
          aria-label="Add models"
        >
          <IconPlus />
        </Button>
      </div>
    )
  }

  const activeIndex = entries.findIndex((entry) => entry.id === activeId)

  return (
    <div className="flex w-64 shrink-0 flex-col border-border border-r bg-background">
      <header className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-2 py-1.5">
        <span className="font-medium text-muted-foreground text-xs">Models ({entries.length})</span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onAdd}
            disabled={busy}
            title="Add models"
            aria-label="Add models"
          >
            <IconPlus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClear}
            disabled={busy}
            title="Clear all"
            aria-label="Clear all models"
          >
            <IconTrash />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onToggleCollapse}
            title="Hide models"
            aria-label="Hide models"
          >
            <IconLayoutSidebarLeftCollapse />
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-1.5">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'group flex items-center gap-1 rounded-md',
                entry.id === activeId && 'bg-accent'
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(entry.id)}
                className="flex min-w-0 flex-1 flex-col items-start px-2 py-1.5 text-left"
              >
                <span className="w-full truncate font-medium text-xs">{entry.name}</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatBytes(entry.bytes)} · {entry.format}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1 pe-1.5">
                <StatusBadge status={status[entry.id]} />
                <button
                  type="button"
                  onClick={() => onRemove(entry.id)}
                  disabled={busy}
                  title="Remove"
                  aria-label={`Remove ${entry.name}`}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 disabled:pointer-events-none"
                >
                  <IconX className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <footer className="flex shrink-0 flex-col gap-2 border-border border-t p-2">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onCycle(-1)}
            disabled={busy || activeIndex <= 0}
            title="Previous model"
          >
            <IconChevronUp />
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onCycle(1)}
            disabled={busy || activeIndex === -1 || activeIndex >= entries.length - 1}
            title="Next model"
          >
            <IconChevronDown />
            Next
          </Button>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={onOptimizeAll}
            loading={busy}
            disabled={busy}
            title="Optimize all models"
          >
            <IconSparkles />
            Optimize all
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={onExportAll}
            disabled={busy}
            title="Export all models"
          >
            <IconDownload />
            Export all
          </Button>
        </div>
      </footer>
    </div>
  )
}
