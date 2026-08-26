import { createDebouncer, systemTimers, type Timers } from './debounce'
import type { StorageDriver } from './storage'

/**
 * One debounced writer for one key.
 *
 * **The snapshot is taken when the write happens, not when the change does.**
 * That is the whole reason `changed()` carries no payload: a drag reports a
 * change on every pointer frame, and a design that handed a document to the
 * debouncer per frame would deep-copy the entire diagram sixty times a second
 * to throw away fifty-nine of the copies. Reporting the *fact* of a change and
 * reading the state once, at the moment of writing, costs one copy per save.
 *
 * **A write that fails must not reach the caller.** Storage is a nicety here:
 * the editor is a complete program without it, so a full disk or a private
 * window has to degrade to "you are not being saved" and nothing more. Every
 * rejection is caught, reported through `onError`, and swallowed.
 */
export interface AutosaveOptions<T> {
  driver: StorageDriver
  key: string
  /** Reads the current value. Called once per write, never per change. */
  snapshot: () => T
  delayMs: number
  maxWaitMs?: number
  timers?: Timers
  onSaving?: () => void
  onSaved?: () => void
  onError?: (error: Error) => void
}

export interface Autosave {
  /** Reports that the thing being saved has changed. */
  changed: () => void
  /** Writes anything outstanding immediately; resolves when it has landed. */
  flush: () => Promise<void>
  /** Forgets anything outstanding. */
  cancel: () => void
  readonly pending: boolean
}

export function createAutosave<T>({
  driver,
  key,
  snapshot,
  delayMs,
  maxWaitMs = 5000,
  timers = systemTimers,
  onSaving,
  onSaved,
  onError,
}: AutosaveOptions<T>): Autosave {
  /*
   * Writes are chained rather than fired in parallel. Two overlapping puts to
   * one key can land in either order, and the loser is an older document
   * overwriting a newer one — a data-loss bug that would show up only under a
   * slow disk, which is to say only on someone else's machine.
   */
  let queue: Promise<void> = Promise.resolve()

  const write = () => {
    onSaving?.()
    const value = snapshot()
    queue = queue.then(async () => {
      try {
        await driver.write(key, value)
        onSaved?.()
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  const debouncer = createDebouncer<null>(write, { delayMs, maxWaitMs, timers })

  return {
    changed: () => {
      debouncer.schedule(null)
    },
    flush: async () => {
      debouncer.flush()
      await queue
    },
    cancel: () => {
      debouncer.cancel()
    },
    get pending() {
      return debouncer.pending
    },
  }
}
