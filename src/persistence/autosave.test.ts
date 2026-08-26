import { describe, expect, it, vi } from 'vitest'
import { createAutosave } from './autosave'
import { createDebouncer, systemTimers, type Timers } from './debounce'
import { memoryDriver, type StorageDriver } from './storage'

/**
 * A hand-driven clock.
 *
 * Vitest's fake timers would cover most of this, but not the interaction
 * between the quiet period and the ceiling, which needs `now` to advance in
 * step with the pending timeouts. Owning both means the two deadlines are
 * tested against each other rather than against a guess.
 */
function fakeTimers() {
  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, { at: number; run: () => void }>()

  const timers: Timers = {
    setTimeout: (callback, ms) => {
      const handle = nextHandle++
      scheduled.set(handle, { at: now + ms, run: callback })
      return handle
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle)
    },
    now: () => now,
  }

  return {
    timers,
    get scheduled() {
      return scheduled.size
    },
    /** Advances the clock, running whatever comes due on the way. */
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const due = [...scheduled.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [handle, entry] = due
        scheduled.delete(handle)
        now = entry.at
        entry.run()
      }
      now = target
    },
  }
}

describe('the debouncer', () => {
  it('turns N rapid changes into one call', () => {
    const clock = fakeTimers()
    const run = vi.fn()
    const debouncer = createDebouncer<number>(run, { delayMs: 500, timers: clock.timers })

    for (let i = 0; i < 10; i += 1) {
      debouncer.schedule(i)
      clock.advance(10)
    }
    expect(run).not.toHaveBeenCalled()

    clock.advance(500)
    expect(run).toHaveBeenCalledTimes(1)
    // The newest value, not the first: a save is a snapshot, not a log.
    expect(run).toHaveBeenCalledWith(9)
  })

  it('turns N spaced-out changes into N calls', () => {
    const clock = fakeTimers()
    const run = vi.fn()
    const debouncer = createDebouncer<number>(run, { delayMs: 500, timers: clock.timers })

    for (let i = 0; i < 4; i += 1) {
      debouncer.schedule(i)
      clock.advance(600)
    }
    expect(run).toHaveBeenCalledTimes(4)
    expect(run.mock.calls.map(([value]) => value as number)).toEqual([0, 1, 2, 3])
  })

  it('writes anyway once the ceiling is reached', () => {
    // The failure this prevents: a user who never stops editing is a user who
    // is never saved.
    const clock = fakeTimers()
    const run = vi.fn()
    const debouncer = createDebouncer<number>(run, {
      delayMs: 500,
      maxWaitMs: 2000,
      timers: clock.timers,
    })

    for (let tick = 0; tick < 40; tick += 1) {
      debouncer.schedule(tick)
      clock.advance(100)
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('has no ceiling when none is asked for', () => {
    const clock = fakeTimers()
    const run = vi.fn()
    const debouncer = createDebouncer<number>(run, {
      delayMs: 500,
      maxWaitMs: 0,
      timers: clock.timers,
    })

    for (let tick = 0; tick < 40; tick += 1) {
      debouncer.schedule(tick)
      clock.advance(100)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('runs a pending value at once when flushed', () => {
    const clock = fakeTimers()
    const run = vi.fn()
    const debouncer = createDebouncer<string>(run, {
      delayMs: 500,
      timers: clock.timers,
    })

    debouncer.schedule('now')
    expect(debouncer.pending).toBe(true)
    debouncer.flush()
    expect(run).toHaveBeenCalledWith('now')
    expect(debouncer.pending).toBe(false)

    // And does not run again when the timer would have come due.
    clock.advance(1000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does nothing when flushed with nothing pending', () => {
    const run = vi.fn()
    createDebouncer<string>(run, { delayMs: 500, timers: fakeTimers().timers }).flush()
    expect(run).not.toHaveBeenCalled()
  })

  it('forgets a pending value when cancelled', () => {
    const clock = fakeTimers()
    const run = vi.fn()
    const debouncer = createDebouncer<string>(run, {
      delayMs: 500,
      timers: clock.timers,
    })

    debouncer.schedule('doomed')
    debouncer.cancel()
    clock.advance(1000)
    expect(run).not.toHaveBeenCalled()
    expect(debouncer.pending).toBe(false)
  })

  it('leaves no timer behind when it fires', () => {
    const clock = fakeTimers()
    const debouncer = createDebouncer<number>(() => {}, {
      delayMs: 100,
      timers: clock.timers,
    })
    debouncer.schedule(1)
    clock.advance(200)
    expect(clock.scheduled).toBe(0)
  })

  it('uses real timers when none are injected', () => {
    // The default is what the app actually runs with, so it is worth one test.
    expect(typeof systemTimers.now()).toBe('number')
    const debouncer = createDebouncer<number>(() => {}, { delayMs: 10_000 })
    debouncer.schedule(1)
    expect(debouncer.pending).toBe(true)
    debouncer.cancel()
  })
})

describe('the auto-save', () => {
  const setup = (driver: StorageDriver = memoryDriver()) => {
    const clock = fakeTimers()
    const snapshot = vi.fn(() => ({ taken: clock.timers.now() }))
    const events: string[] = []
    const autosave = createAutosave({
      driver,
      key: 'document',
      snapshot,
      delayMs: 500,
      timers: clock.timers,
      onSaving: () => events.push('saving'),
      onSaved: () => events.push('saved'),
      onError: (error) => events.push(`error:${error.message}`),
    })
    return { autosave, clock, snapshot, events, driver }
  }

  it('writes once for a burst of changes', async () => {
    const { autosave, clock, driver } = setup()
    for (let i = 0; i < 20; i += 1) {
      autosave.changed()
      clock.advance(5)
    }
    clock.advance(500)
    await autosave.flush()

    // The last change landed at t=95, so the single write happens at t=595 —
    // one write, taken after every one of the twenty changes.
    expect(await driver.read('document')).toEqual({ taken: 595 })
  })

  it('takes the snapshot when it writes, not when the change happens', async () => {
    // The reason `changed()` carries no payload: a drag reports sixty changes
    // a second and fifty-nine of the copies would be thrown away.
    const { autosave, clock, snapshot } = setup()
    for (let i = 0; i < 20; i += 1) {
      autosave.changed()
      clock.advance(5)
    }
    expect(snapshot).not.toHaveBeenCalled()

    clock.advance(500)
    await autosave.flush()
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('reports saving and then saved', async () => {
    const { autosave, clock, events } = setup()
    autosave.changed()
    clock.advance(500)
    await autosave.flush()
    expect(events).toEqual(['saving', 'saved'])
  })

  it('does not let a failing driver throw at the caller', async () => {
    // Storage is a nicety; the editor is a complete program without it.
    const failing: StorageDriver = {
      name: 'broken',
      read: () => Promise.reject(new Error('read failed')),
      write: () => Promise.reject(new Error('QuotaExceededError')),
      remove: () => Promise.reject(new Error('remove failed')),
    }
    const { autosave, clock, events } = setup(failing)

    autosave.changed()
    clock.advance(500)
    await expect(autosave.flush()).resolves.toBeUndefined()
    expect(events).toEqual(['saving', 'error:QuotaExceededError'])
  })

  it('survives a driver that throws synchronously', async () => {
    const throwing: StorageDriver = {
      name: 'throwing',
      read: () => Promise.resolve(undefined),
      write: () => {
        throw new Error('boom')
      },
      remove: () => Promise.resolve(),
    }
    const { autosave, clock, events } = setup(throwing)
    autosave.changed()
    clock.advance(500)
    await expect(autosave.flush()).resolves.toBeUndefined()
    expect(events).toContain('error:boom')
  })

  it('keeps writing after a failure, in case the next one works', async () => {
    let fail = true
    const flaky: StorageDriver = {
      name: 'flaky',
      read: () => Promise.resolve(undefined),
      write: () => (fail ? Promise.reject(new Error('once')) : Promise.resolve()),
      remove: () => Promise.resolve(),
    }
    const { autosave, clock, events } = setup(flaky)

    autosave.changed()
    clock.advance(500)
    await autosave.flush()
    expect(events).toContain('error:once')

    fail = false
    autosave.changed()
    clock.advance(500)
    await autosave.flush()
    expect(events).toContain('saved')
  })

  it('writes in order, so a slow save cannot overwrite a newer one', async () => {
    // Two puts to one key can land either way round, and the loser is an
    // older document overwriting a newer one.
    const landed: number[] = []
    let value = 0
    let delay = 40
    const slow: StorageDriver = {
      name: 'slow',
      read: () => Promise.resolve(undefined),
      write: (_key, written) => {
        const wait = delay
        delay = 0
        return new Promise((resolve) => {
          setTimeout(() => {
            landed.push((written as { value: number }).value)
            resolve()
          }, wait)
        })
      },
      remove: () => Promise.resolve(),
    }

    const clock = fakeTimers()
    const autosave = createAutosave({
      driver: slow,
      key: 'document',
      snapshot: () => ({ value: (value += 1) }),
      delayMs: 100,
      timers: clock.timers,
    })

    autosave.changed()
    clock.advance(100)
    autosave.changed()
    clock.advance(100)
    await autosave.flush()

    expect(landed).toEqual([1, 2])
  })

  it('forgets a pending write when cancelled', async () => {
    const { autosave, clock, driver } = setup()
    autosave.changed()
    autosave.cancel()
    clock.advance(1000)
    await autosave.flush()
    expect(await driver.read('document')).toBeUndefined()
  })
})

describe('the memory driver', () => {
  it('reads back what it was given', async () => {
    const driver = memoryDriver()
    await driver.write('k', { a: 1 })
    expect(await driver.read('k')).toEqual({ a: 1 })
  })

  it('is undefined for a key never written', async () => {
    expect(await memoryDriver().read('missing')).toBeUndefined()
  })

  it('takes a seed, which is how a restore is tested', async () => {
    expect(await memoryDriver({ k: 'v' }).read('k')).toBe('v')
  })

  it('copies on the way in and out, the way IndexedDB does', async () => {
    // A fake that handed back live references would hide the class of bug
    // where a save captures an object the editor goes on mutating.
    const driver = memoryDriver()
    const value = { list: [1, 2] }
    await driver.write('k', value)
    value.list.push(3)
    expect(await driver.read('k')).toEqual({ list: [1, 2] })

    const first = (await driver.read('k')) as { list: number[] }
    first.list.push(9)
    expect(await driver.read('k')).toEqual({ list: [1, 2] })
  })

  it('forgets a removed key', async () => {
    const driver = memoryDriver({ k: 1 })
    await driver.remove('k')
    expect(await driver.read('k')).toBeUndefined()
  })
})
