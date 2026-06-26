import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type UtilityProcess, utilityProcess, type WebContents } from 'electron'
import type { ModelSource, OptimizeOptions, OptimizeStats, TextureOverrideInput } from './types'

/** Subfolder that Save / Download writes into, under the user's chosen directory. */
const OUTPUT_SUBDIR = 'polaris-optimized'

interface JobReply {
  id: string
  ok: boolean
  before?: OptimizeStats
  after?: OptimizeStats
  error?: string
}

interface ResultRecord {
  tempPath: string
  /** webContents id that owns this result, so it's freed when that window dies. */
  ownerId: number
}

export interface OptimizeResult {
  id: string
  before: OptimizeStats
  after: OptimizeStats
}

/**
 * Owns the optimize utilityProcess and the on-disk result cache. Optimized GLBs are
 * written to temp files (never held in main's heap); main keeps only id → temp path
 * + owner. Results are freed on supersede (the renderer disposes a stale preview),
 * explicit dispose, owner-window destruction, and a boot-time wipe of the whole temp
 * dir — so no path leaks RAM or accumulates on disk across all of those.
 */
class OptimizeManager {
  private worker: UtilityProcess | null = null
  private workerReady: Promise<UtilityProcess> | null = null
  private tempDir = ''
  private readonly results = new Map<string, ResultRecord>()
  private readonly pending = new Map<string, (reply: JobReply) => void>()
  private readonly hookedSenders = new Set<number>()

  /** Wipe any orphaned temp results from a previous (possibly crashed) run and make
   *  a fresh temp dir. Call once after the app is ready. */
  async init(): Promise<void> {
    this.tempDir = join(app.getPath('temp'), 'polaris', 'optimize')
    await rm(this.tempDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(this.tempDir, { recursive: true })
  }

  private ensureWorker(): Promise<UtilityProcess> {
    if (this.worker) return Promise.resolve(this.worker)
    this.workerReady ??= new Promise<UtilityProcess>((resolve) => {
      const worker = utilityProcess.fork(join(__dirname, 'optimize.worker.js'))
      worker.on('message', (reply: JobReply) => {
        const settle = this.pending.get(reply.id)
        if (!settle) return
        this.pending.delete(reply.id)
        settle(reply)
      })
      worker.on('exit', () => {
        this.worker = null
        this.workerReady = null
        for (const settle of this.pending.values()) {
          settle({ id: '', ok: false, error: 'Optimize worker exited.' })
        }
        this.pending.clear()
      })
      worker.on('spawn', () => {
        this.worker = worker
        resolve(worker)
      })
    })
    return this.workerReady
  }

  private async dispatch(
    type: 'optimize' | 'export',
    payload: {
      source: ModelSource
      overrides: TextureOverrideInput[]
      options?: OptimizeOptions
    }
  ): Promise<{ id: string; tempPath: string; before: OptimizeStats; after: OptimizeStats }> {
    const worker = await this.ensureWorker()
    const id = randomUUID()
    const outPath = join(this.tempDir, `${id}.glb`)
    const reply = await new Promise<JobReply>((resolve) => {
      this.pending.set(id, resolve)
      worker.postMessage({ id, type, outPath, ...payload })
    })
    if (!reply.ok || !reply.before || !reply.after) {
      throw new Error(reply.error ?? 'Optimize failed.')
    }
    return { id, tempPath: outPath, before: reply.before, after: reply.after }
  }

  /** Free a window's results when it's destroyed (closed/reloaded away). */
  private hookOwner(sender: WebContents): void {
    if (this.hookedSenders.has(sender.id) || sender.isDestroyed()) return
    this.hookedSenders.add(sender.id)
    sender.once('destroyed', () => {
      this.hookedSenders.delete(sender.id)
      void this.disposeOwner(sender.id)
    })
  }

  async run(
    sender: WebContents,
    source: ModelSource,
    overrides: TextureOverrideInput[],
    options: OptimizeOptions
  ): Promise<OptimizeResult> {
    this.hookOwner(sender)
    const { id, tempPath, before, after } = await this.dispatch('optimize', {
      source,
      overrides,
      options
    })
    this.results.set(id, { tempPath, ownerId: sender.id })
    return { id, before, after }
  }

  async export(
    sender: WebContents,
    source: ModelSource,
    overrides: TextureOverrideInput[]
  ): Promise<OptimizeResult> {
    this.hookOwner(sender)
    const { id, tempPath, before, after } = await this.dispatch('export', { source, overrides })
    this.results.set(id, { tempPath, ownerId: sender.id })
    return { id, before, after }
  }

  /** Read a result's bytes (base64) — for loading an optimized model into the viewer. */
  async read(id: string): Promise<string> {
    const record = this.results.get(id)
    if (!record) throw new Error('That optimized result is no longer available.')
    return (await readFile(record.tempPath)).toString('base64')
  }

  /** Copy a result into `<dir>/polaris-optimized/<name>`, overwriting same-named. */
  async write(id: string, dir: string, name: string): Promise<string> {
    const record = this.results.get(id)
    if (!record) throw new Error('That optimized result is no longer available.')
    const outDir = join(dir, OUTPUT_SUBDIR)
    await mkdir(outDir, { recursive: true })
    const dest = join(outDir, name)
    await copyFile(record.tempPath, dest)
    return dest
  }

  async dispose(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const record = this.results.get(id)
        if (!record) return
        this.results.delete(id)
        await rm(record.tempPath, { force: true }).catch(() => {})
      })
    )
  }

  private async disposeOwner(ownerId: number): Promise<void> {
    const ids = [...this.results.entries()]
      .filter(([, record]) => record.ownerId === ownerId)
      .map(([id]) => id)
    await this.dispose(ids)
  }

  /** Kill the worker and remove the temp dir — call on app quit. */
  async shutdown(): Promise<void> {
    this.worker?.kill()
    this.worker = null
    this.workerReady = null
    if (this.tempDir) await rm(this.tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export const optimizeManager = new OptimizeManager()
