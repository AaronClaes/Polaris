// Display formatting shared across the asset tools (model + texture viewer).

/** Human-readable byte size: B / KB / MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Signed percentage change from `before` to `after` (0 when not computable). */
export function percent(before: number | undefined, after: number | undefined): number {
  if (before == null || after == null || before <= 0) return 0
  return Math.round(((after - before) / before) * 100)
}
