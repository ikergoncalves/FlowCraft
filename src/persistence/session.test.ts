import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlock, nudgeSelection } from '../history/actions'
import { useHistoryStore } from '../history/historyStore'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_THEME } from '../theme/stylesheet'
import { useThemeStore } from '../theme/themeStore'
import type { Block } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import type { Timers } from './debounce'
import { toDocument, type DocumentSlice } from './document'
import { usePersistenceStore } from './persistenceStore'
import { PREFERENCES_VERSION } from './preferences'
import {
  DOCUMENT_KEY,
  PREFERENCES_KEY,
  startPersistence,
  type PersistenceSession,
} from './session'
import { memoryDriver, type StorageDriver } from './storage'

/*
 * The session as the app actually runs it: real stores, a fake driver and a
 * hand-driven clock.
 *
 * The driver is injected because jsdom has no IndexedDB — see `storage.ts` on
 * why the seam is there and not around a polyfill. The clock is injected
 * because a debounce tested by sleeping is slow when it passes and flaky when
 * it fails.
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

const store = () => useDiagramStore.getState()
const persistence = () => usePersistenceStore.getState()

/**
 * Lets the write queue drain.
 *
 * A save is a chain of promises with no timer in it, so the injected clock
 * cannot advance past it; yielding to the real microtask queue can.
 */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve())

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  type: 'rect',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  text: id,
  ...extra,
})

function seedSlice(): DocumentSlice {
  return {
    blocks: { a: block('a'), b: block('b', { x: 300 }) },
    blockOrder: ['a', 'b'],
    connections: { ab: { id: 'ab', sourceId: 'a', targetId: 'b', sourceAnchor: 'e' } },
    connectionOrder: ['ab'],
    groups: { g1: { id: 'g1', blockIds: ['a', 'b'] } },
    groupOrder: ['g1'],
  }
}

let sessions: PersistenceSession[] = []

/** Starts a session and registers it for teardown. */
async function start(driver: StorageDriver, clock = fakeTimers()) {
  const session = await startPersistence({
    driver,
    delayMs: 500,
    timers: clock.timers,
    // No window: the page-lifecycle listeners are global, and a test that
    // left them behind would have every later test flushing this one.
    view: undefined,
  })
  sessions.push(session)
  return { session, clock }
}

beforeEach(() => {
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    groups: {},
    groupOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    snapToGrid: true,
  })
  useHistoryStore.getState().clear()
  useThemeStore.setState({ theme: DEFAULT_THEME })
  usePersistenceStore.getState().reset()
})

afterEach(() => {
  for (const session of sessions) session.stop()
  sessions = []
})

describe('restoring on open', () => {
  it('loads a stored document into the store', async () => {
    const driver = memoryDriver({ [DOCUMENT_KEY]: toDocument(seedSlice()) })
    await start(driver)

    expect(store().blockOrder).toEqual(['a', 'b'])
    expect(store().connections.ab?.sourceAnchor).toBe('e')
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
    expect(persistence().status).toBe('ready')
  })

  it('leaves an empty store alone when nothing is stored', async () => {
    await start(memoryDriver())
    expect(store().blockOrder).toEqual([])
    expect(persistence().status).toBe('ready')
  })

  it('does not clobber the running defaults on a first visit', async () => {
    // Nothing stored must change nothing. A restore that wrote fallback
    // preferences would overwrite the theme `main.tsx` just resolved from
    // `prefers-color-scheme`.
    useThemeStore.setState({ theme: 'light' })
    useDiagramStore.setState({ snapToGrid: false })
    await start(memoryDriver())

    expect(useThemeStore.getState().theme).toBe('light')
    expect(store().snapToGrid).toBe(false)
  })

  it('restores preferences when they are there', async () => {
    const driver = memoryDriver({
      [PREFERENCES_KEY]: {
        version: PREFERENCES_VERSION,
        theme: 'light',
        snapToGrid: false,
        viewport: { x: 120, y: -40, zoom: 2 },
      },
    })
    await start(driver)

    expect(useThemeStore.getState().theme).toBe('light')
    expect(store().snapToGrid).toBe(false)
    expect(store().viewport).toEqual({ x: 120, y: -40, zoom: 2 })
  })

  it('opens on an empty canvas when the stored document is unreadable', async () => {
    const driver = memoryDriver({ [DOCUMENT_KEY]: { version: 99, blocks: {} } })
    await start(driver)

    expect(store().blockOrder).toEqual([])
    expect(persistence().repairs.join(' ')).toContain('from-the-future')
  })

  it('leaves an unreadable record on disk rather than overwriting it', async () => {
    const wreck = { version: 99, blocks: {} }
    const driver = memoryDriver({ [DOCUMENT_KEY]: wreck })
    await start(driver)
    expect(await driver.read(DOCUMENT_KEY)).toEqual(wreck)
  })

  it('reports what the validator had to repair', async () => {
    const driver = memoryDriver({
      [DOCUMENT_KEY]: {
        ...toDocument(seedSlice()),
        connections: {
          ab: { id: 'ab', sourceId: 'a', targetId: 'ghost' },
        },
      },
    })
    await start(driver)

    expect(store().connectionOrder).toEqual([])
    expect(store().blockOrder).toEqual(['a', 'b'])
    expect(persistence().repairs.length).toBeGreaterThan(0)
  })

  it('drops a selection that belonged to the document it replaced', async () => {
    // The ids in a selection name blocks in *some* document. After a restore
    // they name blocks in the one that was just thrown away, and the overlay
    // would be outlining things that are not there.
    useDiagramStore.setState({
      selectedIds: ['from-before'],
      selectedConnectionIds: ['also-from-before'],
    })
    await start(memoryDriver({ [DOCUMENT_KEY]: toDocument(seedSlice()) }))

    expect(store().selectedIds).toEqual([])
    expect(store().selectedConnectionIds).toEqual([])
  })

  it('gives the user no history to undo the restore with', async () => {
    // Undo immediately after opening would empty the canvas, which is not an
    // edit the user made.
    const driver = memoryDriver({ [DOCUMENT_KEY]: toDocument(seedSlice()) })
    await start(driver)
    expect(useHistoryStore.getState().undoStack).toHaveLength(0)
  })
})

describe('what triggers a save', () => {
  it('saves the document after an edit', async () => {
    const driver = memoryDriver()
    const { clock } = await start(driver)

    createBlock({ type: 'rect', x: 40, y: 40, width: 100, height: 60, text: 'new' })
    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()

    clock.advance(500)
    await flushMicrotasks()

    const saved = await driver.read(DOCUMENT_KEY)
    expect(saved).toMatchObject({ version: 1 })
    expect(Object.keys((saved as { blocks: object }).blocks)).toHaveLength(1)
  })

  it('does not save the document on a selection change', async () => {
    // Structural, not a special case: selecting replaces none of the six
    // document slices, so the subscription cannot see it.
    const driver = memoryDriver()
    const { session, clock } = await start(driver)
    store().addBlock(block('a'))
    await session.flush()
    const afterSeed = await driver.read(DOCUMENT_KEY)

    store().select('a')
    store().clearSelection()
    store().selectAll()
    clock.advance(2000)
    await session.flush()

    expect(await driver.read(DOCUMENT_KEY)).toEqual(afterSeed)
  })

  it('does not save the document on a pan or a zoom', async () => {
    const driver = memoryDriver()
    const { session, clock } = await start(driver)
    store().addBlock(block('a'))
    await session.flush()
    const afterSeed = await driver.read(DOCUMENT_KEY)

    store().setViewport({ x: 200, y: 100, zoom: 1.5 })
    clock.advance(2000)
    await session.flush()

    expect(await driver.read(DOCUMENT_KEY)).toEqual(afterSeed)
  })

  it('does not save the document when the tool changes', async () => {
    const driver = memoryDriver()
    const { session, clock } = await start(driver)

    store().setTool('rect')
    store().setTool('text')
    clock.advance(2000)
    await session.flush()

    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
  })

  it('writes a pan into the preferences instead', async () => {
    const driver = memoryDriver()
    const { session, clock } = await start(driver)

    store().setViewport({ x: 200, y: 100, zoom: 1.5 })
    clock.advance(500)
    await session.flush()

    expect(await driver.read(PREFERENCES_KEY)).toMatchObject({
      viewport: { x: 200, y: 100, zoom: 1.5 },
    })
  })

  it('writes a theme switch into the preferences and nothing else', async () => {
    const driver = memoryDriver()
    const { session, clock } = await start(driver)

    useThemeStore.getState().toggleTheme()
    clock.advance(500)
    await session.flush()

    expect(await driver.read(PREFERENCES_KEY)).toMatchObject({ theme: 'light' })
    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
  })

  it('collapses a whole drag into one write', async () => {
    const driver = memoryDriver()
    const writes: unknown[] = []
    const counting: StorageDriver = {
      ...driver,
      write: async (key, value) => {
        if (key === DOCUMENT_KEY) writes.push(value)
        await driver.write(key, value)
      },
    }
    const { session, clock } = await start(counting)
    store().addBlock(block('a'))
    store().select('a')

    for (let frame = 0; frame < 60; frame += 1) {
      store().setBlockPositions({ a: { x: frame, y: frame } })
      clock.advance(16)
    }
    clock.advance(500)
    await session.flush()

    expect(writes).toHaveLength(1)
  })

  it('saves nothing at all after it is stopped', async () => {
    const driver = memoryDriver()
    const { session, clock } = await start(driver)
    session.stop()

    store().addBlock(block('a'))
    clock.advance(2000)
    await session.flush()

    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
  })
})

describe('a document that survives a reload', () => {
  it('comes back exactly as it went in', async () => {
    const driver = memoryDriver()
    const { session } = await start(driver)

    store().replaceDocument(seedSlice())
    store().select(['a', 'b'])
    nudgeSelection(0, 20)
    await session.flush()
    const before = structuredClone({
      blocks: store().blocks,
      blockOrder: store().blockOrder,
      connections: store().connections,
      connectionOrder: store().connectionOrder,
      groups: store().groups,
      groupOrder: store().groupOrder,
    })

    // The reload: tear the session down, empty the store, start again over
    // the same driver.
    session.stop()
    useDiagramStore.setState({
      blocks: {},
      blockOrder: [],
      connections: {},
      connectionOrder: [],
      groups: {},
      groupOrder: [],
    })
    await start(driver)

    expect({
      blocks: store().blocks,
      blockOrder: store().blockOrder,
      connections: store().connections,
      connectionOrder: store().connectionOrder,
      groups: store().groups,
      groupOrder: store().groupOrder,
    }).toEqual(before)
  })
})

describe('when storage fails', () => {
  const broken = (): StorageDriver => ({
    name: 'broken',
    read: () => Promise.reject(new Error('read denied')),
    write: () => Promise.reject(new Error('QuotaExceededError')),
    remove: () => Promise.reject(new Error('remove denied')),
  })

  it('starts anyway and says so', async () => {
    await start(broken())
    expect(persistence().status).toBe('unavailable')
    expect(persistence().message).toContain('read denied')
  })

  it('leaves the editor completely usable', async () => {
    const { clock } = await start(broken())

    createBlock({ type: 'rect', x: 0, y: 0, width: 100, height: 60, text: 'still works' })
    clock.advance(2000)

    expect(store().blockOrder).toHaveLength(1)
    expect(useHistoryStore.getState().undoStack).toHaveLength(1)
    useHistoryStore.getState().undo()
    expect(store().blockOrder).toHaveLength(0)
  })

  it('does not let a failed write reach the editor', async () => {
    const { session, clock } = await start(broken())
    store().addBlock(block('a'))
    clock.advance(500)
    await expect(session.flush()).resolves.toBeUndefined()
    expect(persistence().status).toBe('unavailable')
  })

  it('does not claim to have saved once it is degraded', async () => {
    const { session, clock } = await start(broken())
    store().addBlock(block('a'))
    clock.advance(500)
    await session.flush()
    expect(persistence().status).not.toBe('saved')
  })

  it('falls back to memory when IndexedDB cannot be opened', async () => {
    // jsdom has no IndexedDB at all, so this is the real code path here.
    const session = await startPersistence({ delayMs: 500, view: undefined })
    sessions.push(session)
    expect(session.driver.name).toBe('memory')
    expect(persistence().status).toBe('unavailable')
  })
})

describe('clearing the saved data', () => {
  it('removes both records and empties the editor', async () => {
    const driver = memoryDriver({
      [DOCUMENT_KEY]: toDocument(seedSlice()),
      [PREFERENCES_KEY]: { version: 1, theme: 'light', snapToGrid: false },
    })
    const { session } = await start(driver)
    expect(store().blockOrder).toHaveLength(2)

    await session.clear()

    expect(store().blockOrder).toEqual([])
    expect(store().groupOrder).toEqual([])
    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
    expect(await driver.read(PREFERENCES_KEY)).toBeUndefined()
  })

  it('leaves nothing selected, because there is nothing left', async () => {
    const driver = memoryDriver({ [DOCUMENT_KEY]: toDocument(seedSlice()) })
    const { session } = await start(driver)
    store().select(['a', 'b'])

    await session.clear()
    expect(store().selectedIds).toEqual([])
  })

  it('does not let the pending save put the document straight back', async () => {
    // Emptying the canvas is itself a document change, so it schedules a
    // write. Cancelling after — not before — is what stops it landing.
    const driver = memoryDriver({ [DOCUMENT_KEY]: toDocument(seedSlice()) })
    const { session, clock } = await start(driver)

    await session.clear()
    clock.advance(5000)
    await session.flush()

    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
  })

  it('leaves nothing to undo the clear with', async () => {
    const driver = memoryDriver({ [DOCUMENT_KEY]: toDocument(seedSlice()) })
    const { session } = await start(driver)
    createBlock({ type: 'rect', x: 0, y: 0, width: 10, height: 10, text: 'x' })

    await session.clear()
    expect(useHistoryStore.getState().undoStack).toHaveLength(0)
    expect(useHistoryStore.getState().redoStack).toHaveLength(0)
  })

  it('survives a driver that refuses to delete', async () => {
    const refusing: StorageDriver = {
      name: 'refusing',
      read: () => Promise.resolve(undefined),
      write: () => Promise.resolve(),
      remove: () => Promise.reject(new Error('remove denied')),
    }
    const { session } = await start(refusing)
    await expect(session.clear()).resolves.toBeUndefined()
    expect(persistence().status).toBe('unavailable')
  })
})

describe('the page-lifecycle flush', () => {
  it('writes an outstanding edit when the page is hidden', async () => {
    const driver = memoryDriver()
    const clock = fakeTimers()
    const session = await startPersistence({
      driver,
      delayMs: 5000,
      timers: clock.timers,
      view: window,
    })
    sessions.push(session)

    store().addBlock(block('a'))
    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await flushMicrotasks()

    expect(await driver.read(DOCUMENT_KEY)).toBeDefined()
    vi.restoreAllMocks()
  })

  it('takes its listeners with it when it stops', async () => {
    const driver = memoryDriver()
    const session = await startPersistence({ driver, delayMs: 5000, view: window })
    session.stop()

    store().addBlock(block('a'))
    window.dispatchEvent(new Event('pagehide'))
    await flushMicrotasks()

    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
  })
})
