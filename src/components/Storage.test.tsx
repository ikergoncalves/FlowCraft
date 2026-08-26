import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import App from '../App'
import { createBlock } from '../history/actions'
import { useHistoryStore } from '../history/historyStore'
import type { Timers } from '../persistence/debounce'
import { toDocument } from '../persistence/document'
import { usePersistenceStore } from '../persistence/persistenceStore'
import {
  DOCUMENT_KEY,
  startPersistence,
  type PersistenceSession,
} from '../persistence/session'
import { memoryDriver, type StorageDriver } from '../persistence/storage'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_THEME } from '../theme/stylesheet'
import { useThemeStore } from '../theme/themeStore'
import { DEFAULT_VIEWPORT } from '../utils/coords'

/*
 * The storage chip and the clear control, as a user meets them.
 *
 * The session itself is tested in `persistence/session.test.ts` against the
 * real stores; what is left for a rendered test is the part that is only true
 * in the DOM — that the failure is *visible*, that the editor keeps working
 * beside it, and that "clear" asks before it destroys anything.
 */

const CANVAS_BOX: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 1000,
  bottom: 800,
  width: 1000,
  height: 800,
  toJSON: () => ({}),
}

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

let sessions: PersistenceSession[] = []

async function start(driver: StorageDriver, clock = fakeTimers()) {
  let session!: PersistenceSession
  await act(async () => {
    session = await startPersistence({
      driver,
      delayMs: 500,
      timers: clock.timers,
      view: undefined,
    })
  })
  sessions.push(session)
  return { session, clock }
}

beforeAll(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

afterAll(() => {
  vi.restoreAllMocks()
})

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
    snapToGrid: false,
  })
  useHistoryStore.getState().clear()
  useThemeStore.setState({ theme: DEFAULT_THEME })
  usePersistenceStore.getState().reset()
})

afterEach(() => {
  for (const session of sessions) session.stop()
  sessions = []
})

const store = () => useDiagramStore.getState()
const chip = () => screen.getByTestId('storage-status')

const broken = (): StorageDriver => ({
  name: 'broken',
  read: () => Promise.reject(new Error('Storage is not available here')),
  write: () => Promise.reject(new Error('QuotaExceededError')),
  remove: () => Promise.reject(new Error('remove denied')),
})

describe('the storage chip', () => {
  it('says what state storage is in', async () => {
    render(<App />)
    expect(chip()).toHaveAttribute('data-status', 'loading')

    const { session, clock } = await start(memoryDriver())
    expect(chip()).toHaveAttribute('data-status', 'ready')

    act(() => {
      createBlock({ type: 'rect', x: 0, y: 0, width: 100, height: 60, text: 'a' })
      clock.advance(500)
    })
    await act(async () => {
      await session.flush()
    })
    await waitFor(() => {
      expect(chip()).toHaveAttribute('data-status', 'saved')
    })
  })

  it('shows the warning when storage cannot be opened', async () => {
    render(<App />)
    await start(broken())

    expect(chip()).toHaveAttribute('data-status', 'unavailable')
    expect(chip()).toHaveTextContent('Not saved')
    // The reason belongs on hover, not in a banner: it is not something the
    // user did or can fix.
    expect(chip()).toHaveAttribute('title', expect.stringContaining('not available'))
  })

  it('leaves the editor entirely usable while it is degraded', async () => {
    render(<App />)
    const { clock } = await start(broken())

    act(() => {
      createBlock({ type: 'rect', x: 40, y: 40, width: 100, height: 60, text: 'a' })
      clock.advance(2000)
    })
    expect(screen.getAllByTestId('block')).toHaveLength(1)

    act(() => {
      useHistoryStore.getState().undo()
    })
    expect(screen.queryAllByTestId('block')).toHaveLength(0)
    expect(chip()).toHaveAttribute('data-status', 'unavailable')
  })

  it('keeps saying "not saved" rather than claiming a save that failed', async () => {
    render(<App />)
    const { session, clock } = await start(broken())

    act(() => {
      createBlock({ type: 'rect', x: 0, y: 0, width: 100, height: 60, text: 'a' })
      clock.advance(500)
    })
    await act(async () => {
      await session.flush()
    })
    expect(chip()).toHaveAttribute('data-status', 'unavailable')
  })

  it('flags a document it had to repair on the way in', async () => {
    render(<App />)
    await start(
      memoryDriver({
        [DOCUMENT_KEY]: {
          ...toDocument({
            blocks: {},
            blockOrder: [],
            connections: {},
            connectionOrder: [],
            groups: {},
            groupOrder: [],
          }),
          connections: { x: { id: 'x', sourceId: 'gone', targetId: 'also-gone' } },
          connectionOrder: ['x'],
        },
      }),
    )

    expect(screen.getByTestId('storage-repairs')).toBeInTheDocument()
    expect(chip().getAttribute('title')).toContain('x')
  })
})

describe('clearing the saved data', () => {
  it('is disabled until there is a session to clear', () => {
    render(<App />)
    expect(screen.getByTestId('clear-storage')).toBeDisabled()
  })

  it('asks before it destroys anything', async () => {
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    await start(memoryDriver())
    act(() => {
      createBlock({ type: 'rect', x: 0, y: 0, width: 100, height: 60, text: 'a' })
    })

    fireEvent.click(screen.getByTestId('clear-storage'))

    expect(confirmed).toHaveBeenCalled()
    expect(store().blockOrder).toHaveLength(1)
    confirmed.mockRestore()
  })

  it('empties the canvas and the storage when confirmed', async () => {
    const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const driver = memoryDriver()
    render(<App />)
    const { session, clock } = await start(driver)

    act(() => {
      createBlock({ type: 'rect', x: 0, y: 0, width: 100, height: 60, text: 'a' })
      clock.advance(500)
    })
    await act(async () => {
      await session.flush()
    })
    expect(await driver.read(DOCUMENT_KEY)).toBeDefined()

    await act(async () => {
      fireEvent.click(screen.getByTestId('clear-storage'))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryAllByTestId('block')).toHaveLength(0)
    })
    expect(await driver.read(DOCUMENT_KEY)).toBeUndefined()
    confirmed.mockRestore()
  })
})
