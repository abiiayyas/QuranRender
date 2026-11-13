import type { Job, JobKind } from '@shared/types'
import { emit } from './events'
import { insertJob, updateJob } from './repo'

/** net: downloads and API calls; cpu: ffmpeg / Remotion (each uses most cores); align: the shared cloud GPU, one at a time. */
export type QueueName = 'net' | 'cpu' | 'align'

export interface TaskCtx {
  jobId: string
  signal: AbortSignal
  progress(p: number, message?: string): void
}

/** A task may return a message kept on the finished job (e.g. the output path). */
export type Task = (ctx: TaskCtx) => Promise<string | void>

const LIMITS: Record<QueueName, number> = { net: 3, cpu: 1, align: 1 }
const running: Record<QueueName, number> = { net: 0, cpu: 0, align: 0 }
const waiting: Record<QueueName, (() => void)[]> = { net: [], cpu: [], align: [] }
const controllers = new Map<string, AbortController>()

function acquire(q: QueueName): Promise<void> {
  if (running[q] < LIMITS[q]) {
    running[q]++
    return Promise.resolve()
  }
  return new Promise((resolve) =>
    waiting[q].push(() => {
      running[q]++
      resolve()
    })
  )
}

function release(q: QueueName): void {
  running[q]--
  waiting[q].shift()?.()
}

/** Creates the job row, returns it at once, and runs `task` when the queue has room. Errors become the job's error. */
export function startJob(projectId: string | null, kind: JobKind, queue: QueueName, task: Task): Job {
  const job = insertJob(projectId, kind)
  const ctrl = new AbortController()
  controllers.set(job.id, ctrl)
  let lastEmit = 0
  const ctx: TaskCtx = {
    jobId: job.id,
    signal: ctrl.signal,
    progress: (p, message) => {
      const j = updateJob(job.id, { progress: Math.min(0.99, Math.max(0, p)), ...(message !== undefined ? { message } : {}) })
      const now = Date.now()
      if (now - lastEmit > 200) {
        lastEmit = now
        emit.job(j)
      }
    }
  }
  emit.job(job)
  void (async () => {
    await acquire(queue)
    try {
      if (ctrl.signal.aborted) throw new Error('canceled')
      emit.job(updateJob(job.id, { status: 'running', progress: 0.01 }))
      const message = await task(ctx)
      emit.job(updateJob(job.id, { status: 'done', progress: 1, message: message ?? null }))
    } catch (e) {
      const canceled = ctrl.signal.aborted
      emit.job(updateJob(job.id, { status: canceled ? 'canceled' : 'failed', error: canceled ? null : ((e as Error)?.message ?? String(e)) }))
      if (!canceled) console.error(`[job ${kind}]`, e)
    } finally {
      release(queue)
      controllers.delete(job.id)
    }
  })()
  return job
}

/** Jobs running or waiting for a slot. Cleaning the cache or deleting assets waits for zero. */
export function activeJobs(): number {
  return controllers.size
}

export function cancelJob(id: string): void {
  controllers.get(id)?.abort()
}
