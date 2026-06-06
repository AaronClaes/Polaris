import { execa } from 'execa'

export interface OpenInEditorResult {
  ok: boolean
  error?: string
}

/**
 * Open a path in Cursor.
 *
 * Uses macOS `open -a` (Launch Services) rather than a bare `cursor`/`code`
 * command. A `.app` launched from Finder/Dock inherits a stripped PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin) and could not resolve those CLIs — even though
 * they work under `pnpm dev`, which inherits the terminal PATH. `open` is
 * PATH-independent, so this survives packaging. (execa still proves spawning.)
 */
export async function openInEditor(path: string): Promise<OpenInEditorResult> {
  try {
    await execa('open', ['-a', 'Cursor', path])
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
