/**
 * A trailing debouncer with an injectable clock.
 *
 * Auto-save exists because a diagram changes on every pointer frame of a drag
 * and a write per frame would be absurd. What it must *not* become is a save
 * that never happens: a long editing session is a continuous stream of
 * changes, and a naive debounce that restarts its timer on each one would keep
 * postponing the write for as long as the user kept working. So this is
 * trailing-only with a hard `maxWaitMs` ceiling — quiet down and it saves, or
 * keep going and it saves anyway.
 *
 * The timers are parameters rather than globals so tests can drive them.
 * Vitest's fake timers would cover most of it, but not the interaction between
 * the two deadlines, and a debounce tested by sleeping is a test that is slow
 * when it passes and flaky when it fails.
 */

export interface Timers {
  setTimeout: (callback: () => void, ms: number) => number
  clearTimeout: (handle: number) => void
  now: () => number
}

/** The real ones, bound so they keep working when destructured. */
export const systemTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle)
  },
  now: () => Date.now(),
}

export interface DebouncerOptions {
  /** Quiet period after the last change before the value is handed over. */
  delayMs: number
  /**
   * Longest a change may sit unwritten however busy things stay. `0` disables
   * the ceiling.
   */
  maxWaitMs?: number
  timers?: Timers
}

export interface Debouncer<T> {
  /** Queues `value`, replacing whatever was queued before. */
  schedule: (value: T) => void
  /** Runs anything queued right now. No-op when nothing is. */
  flush: () => void
  /** Drops anything queued without running it. */
  cancel: () => void
  /** Whether a value is waiting. */
  readonly pending: boolean
}

export function createDebouncer<T>(
  run: (value: T) => void,
  { delayMs, maxWaitMs = 0, timers = systemTimers }: DebouncerOptions,
): Debouncer<T> {
  let handle: number | null = null
  let queued: { value: T } | null = null
  let firstQueuedAt = 0

  const clear = () => {
    if (handle !== null) timers.clearTimeout(handle)
    handle = null
  }

  const fire = () => {
    clear()
    const entry = queued
    queued = null
    if (entry) run(entry.value)
  }

  return {
    schedule: (value) => {
      const now = timers.now()
      if (!queued) firstQueuedAt = now
      // Only the newest value is ever written: a save is a snapshot of the
      // document, not an event log, so the intermediate ones have nothing to
      // contribute.
      queued = { value }

      clear()
      const wait =
        maxWaitMs > 0
          ? Math.max(0, Math.min(delayMs, firstQueuedAt + maxWaitMs - now))
          : delayMs
      handle = timers.setTimeout(fire, wait)
    },
    flush: fire,
    cancel: () => {
      clear()
      queued = null
    },
    get pending() {
      return queued !== null
    },
  }
}
