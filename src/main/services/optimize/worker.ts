import { writeFile } from 'node:fs/promises'
import { exportModel, optimizeModel } from './core'
import type { ModelSource, OptimizeOptions, OptimizeStats, TextureOverrideInput } from './types'

// utilityProcess child: runs the CPU-heavy optimize/export off the main event loop
// so bulk runs never freeze the UI, and its memory (the gltf-transform Document,
// sharp buffers) lives in this process and is reclaimed here. The manager owns temp
// paths and passes `outPath`; we write the result there and report only stats back.

interface JobMessage {
  id: string
  type: 'optimize' | 'export'
  outPath: string
  source: ModelSource
  overrides: TextureOverrideInput[]
  options?: OptimizeOptions
}

type ReplyMessage =
  | { id: string; ok: true; before: OptimizeStats; after: OptimizeStats }
  | { id: string; ok: false; error: string }

const parentPort = process.parentPort

async function handle(job: JobMessage): Promise<ReplyMessage> {
  try {
    const result =
      job.type === 'optimize'
        ? await optimizeModel(job.source, job.overrides, job.options as OptimizeOptions)
        : await exportModel(job.source, job.overrides)
    await writeFile(job.outPath, Buffer.from(result.bytes))
    return { id: job.id, ok: true, before: result.before, after: result.after }
  } catch (err) {
    return { id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

parentPort.on('message', (event) => {
  const job = event.data as JobMessage
  handle(job).then((reply) => parentPort.postMessage(reply))
})
