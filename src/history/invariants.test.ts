import { beforeEach, describe, expect, it } from 'vitest'
import { clearClipboard } from '../store/clipboard'
import { useDiagramStore } from '../store/diagramStore'
import type { Block } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import {
  commitMove,
  commitResize,
  commitBlockText,
  copySelection,
  createBlock,
  createConnection,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  pasteClipboard,
} from './actions'
import { useHistoryStore } from './historyStore'

/*
 * The invariants, driven through a fixed script of real editor operations.
 *
 * These are the tests this phase is actually for. Any single command can be
 * right on its own and still leave the document wrong after a long session —
 * a connection restored without its blocks, an order list that drifts out of
 * step with its map, a redo replaying against a document that has moved on.
 * Nothing but a full round trip catches that.
 *
 * The script is fixed rather than randomly generated: a flaky invariant test
 * is a test people learn to re-run instead of read.
 */

const store = () => useDiagramStore.getState()
const history = () => useHistoryStore.getState()

/** Everything undo has to reproduce. Deliberately excludes selection and view. */
const documentState = () =>
  structuredClone({
    blocks: store().blocks,
    blockOrder: store().blockOrder,
    connections: store().connections,
    connectionOrder: store().connectionOrder,
  })

const rectOf = (id: string) => {
  const block = store().blocks[id]
  if (!block) throw new Error(`no block ${id}`)
  return { x: block.x, y: block.y, width: block.width, height: block.height }
}

const positionsOf = (ids: readonly string[]): Record<string, { x: number; y: number }> =>
  Object.fromEntries(
    ids.map((id) => {
      const block = store().blocks[id]
      if (!block) throw new Error(`no block ${id}`)
      return [id, { x: block.x, y: block.y }]
    }),
  )

/**
 * The three structural rules that must hold no matter what has happened.
 *
 * Checked after every single step, not just at the end: an invariant that
 * breaks in the middle and repairs itself by accident is still a bug, and
 * checking only the endpoints is exactly how it hides.
 */
function expectStructurallySound(where: string): void {
  const state = store()

  expect(Object.keys(state.blocks).sort(), `${where}: blocks vs blockOrder`).toEqual(
    [...state.blockOrder].sort(),
  )
  expect(state.blockOrder, `${where}: duplicate ids in blockOrder`).toHaveLength(
    new Set(state.blockOrder).size,
  )
  expect(
    Object.keys(state.connections).sort(),
    `${where}: connections vs connectionOrder`,
  ).toEqual([...state.connectionOrder].sort())
  expect(
    state.connectionOrder,
    `${where}: duplicate ids in connectionOrder`,
  ).toHaveLength(new Set(state.connectionOrder).size)

  for (const id of state.connectionOrder) {
    const connection = state.connections[id]
    if (!connection) continue
    expect(connection.sourceId in state.blocks, `${where}: orphan source on ${id}`).toBe(
      true,
    )
    expect(connection.targetId in state.blocks, `${where}: orphan target on ${id}`).toBe(
      true,
    )
  }
}

const seedBlock = (id: string, x: number, y: number): Block =>
  store().addBlock({ id, type: 'rect', x, y, width: 100, height: 60, text: id })

/**
 * A small diagram to start from: three blocks wired in a chain.
 *
 * Non-empty on purpose. Undoing back to an *empty* document proves much less:
 * restoring into the right slot of a non-empty order list is where a naive
 * "append it back on the end" undo falls over.
 */
function seedDiagram(): void {
  seedBlock('a', 0, 0)
  seedBlock('b', 300, 0)
  seedBlock('c', 600, 0)
  store().addConnection({ id: 'ab', sourceId: 'a', targetId: 'b', sourceAnchor: 'e' })
  store().addConnection({ id: 'bc', sourceId: 'b', targetId: 'c', sourceAnchor: 'e' })
  history().clear()
}

beforeEach(() => {
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    snapToGrid: false,
  })
  history().clear()
  clearClipboard()
})

interface Step {
  name: string
  run: () => void
}

/**
 * A deterministic script covering every command type this phase introduces.
 *
 * Ordered so that no two mergeable nudges are adjacent — two consecutive
 * nudges of the same selection are *supposed* to collapse into one entry, and
 * that behaviour has its own test rather than being smuggled in here.
 */
const SCRIPT: Step[] = [
  {
    name: 'nudge a',
    run: () => {
      store().select('a')
      nudgeSelection(1, 0)
    },
  },
  {
    name: 'drag a and b',
    run: () => {
      store().select(['a', 'b'])
      const origin = positionsOf(['a', 'b'])
      store().setBlockPositions({ a: { x: 40, y: 120 }, b: { x: 340, y: 120 } })
      commitMove(origin)
    },
  },
  {
    name: 'resize c',
    run: () => {
      store().select('c')
      const before = rectOf('c')
      store().updateBlock('c', { width: 260, height: 180 })
      commitResize('c', before)
    },
  },
  {
    name: 'rename b',
    run: () => {
      commitBlockText('b', 'Renamed')
    },
  },
  {
    name: 'connect c back to a',
    run: () => {
      createConnection('c', 'a', 'w')
    },
  },
  {
    name: 'create a fourth block',
    run: () => {
      createBlock({ type: 'rect', x: 900, y: 400, width: 120, height: 70, text: 'd' })
    },
  },
  {
    name: 'copy a and b, then paste',
    run: () => {
      store().select(['a', 'b'])
      copySelection()
      pasteClipboard()
    },
  },
  {
    name: 'paste a second time',
    run: () => {
      pasteClipboard()
    },
  },
  {
    name: 'duplicate the pasted material',
    run: () => {
      duplicateSelection()
    },
  },
  {
    name: 'delete b, cascading its arrows',
    run: () => {
      store().select('b')
      deleteSelection()
    },
  },
  {
    name: 'nudge c a grid step',
    run: () => {
      store().select('c')
      nudgeSelection(0, 20)
    },
  },
  {
    name: 'delete a connection on its own',
    run: () => {
      const id = store().connectionOrder[0]
      if (id === undefined) throw new Error('expected a connection to delete')
      store().selectConnections(id)
      deleteSelection()
    },
  },
  {
    name: 'select everything and delete it',
    run: () => {
      store().selectAll()
      deleteSelection()
    },
  },
]

describe('a full session, undone and redone', () => {
  it('reproduces the starting document exactly after undoing everything', () => {
    seedDiagram()
    const initial = documentState()

    for (const step of SCRIPT) {
      step.run()
      expectStructurallySound(`after ${step.name}`)
    }

    expect(history().undoStack.length).toBeGreaterThan(0)
    let guard = 0
    while (history().undoStack.length > 0) {
      history().undo()
      expectStructurallySound(`undo #${(guard += 1)}`)
      if (guard > 200) throw new Error('undo stack never drained')
    }

    expect(documentState()).toEqual(initial)
  })

  it('reproduces the finished document exactly after redoing everything', () => {
    seedDiagram()
    for (const step of SCRIPT) step.run()
    const final = documentState()

    while (history().undoStack.length > 0) history().undo()

    let guard = 0
    while (history().redoStack.length > 0) {
      history().redo()
      expectStructurallySound(`redo #${(guard += 1)}`)
      if (guard > 200) throw new Error('redo stack never drained')
    }

    expect(documentState()).toEqual(final)
  })

  it('survives being walked back and forth repeatedly', () => {
    seedDiagram()
    for (const step of SCRIPT) step.run()
    const final = documentState()

    // Three full round trips. A command that is not idempotent, or that holds
    // a reference into the store, gives up somewhere in here.
    for (let pass = 0; pass < 3; pass += 1) {
      while (history().undoStack.length > 0) history().undo()
      while (history().redoStack.length > 0) history().redo()
      expectStructurallySound(`round trip ${pass}`)
    }

    expect(documentState()).toEqual(final)
  })

  it('never leaves an orphaned connection part-way through', () => {
    seedDiagram()
    for (const step of SCRIPT) step.run()

    // Undo four, redo two, undo the rest — a deliberately ragged walk, since
    // straight-line traversals are the ones that accidentally work.
    for (let i = 0; i < 4 && history().undoStack.length > 0; i += 1) history().undo()
    for (let i = 0; i < 2 && history().redoStack.length > 0; i += 1) history().redo()
    while (history().undoStack.length > 0) history().undo()

    expectStructurallySound('after a ragged walk')
    expect(store().connectionOrder.length).toBe(2)
  })
})

describe('branching away from a redo', () => {
  it('drops the redo stack and stays consistent', () => {
    seedDiagram()
    store().select('a')
    nudgeSelection(0, 5)
    store().select('c')
    nudgeSelection(0, 7)

    history().undo()
    history().undo()
    expect(history().redoStack).toHaveLength(2)

    store().select('b')
    deleteSelection()

    expect(history().redoStack).toHaveLength(0)
    expectStructurallySound('after branching')

    history().undo()
    expectStructurallySound('after undoing the branch')
    expect(store().blockOrder).toEqual(['a', 'b', 'c'])
    expect(store().connectionOrder).toEqual(['ab', 'bc'])
  })
})

describe('paste under undo', () => {
  it('leaves the originals untouched when the paste is undone', () => {
    seedDiagram()
    store().select(['a', 'b'])
    copySelection()
    pasteClipboard()

    const pasted = store().selectedIds
    expect(pasted).toHaveLength(2)
    expect(store().connectionOrder).toHaveLength(3)

    history().undo()

    expect(store().blockOrder).toEqual(['a', 'b', 'c'])
    expect(store().connectionOrder).toEqual(['ab', 'bc'])
    expect(store().connections.ab).toMatchObject({ sourceId: 'a', targetId: 'b' })
  })

  it('wires the copies to each other, never back to the originals', () => {
    seedDiagram()
    store().select(['a', 'b'])
    copySelection()
    pasteClipboard()

    const copiedIds = new Set(store().selectedIds)
    const copiedConnection = store()
      .connectionOrder.map((id) => store().connections[id])
      .find(
        (connection) => connection && connection.id !== 'ab' && connection.id !== 'bc',
      )

    expect(copiedConnection).toBeDefined()
    expect(copiedIds.has(copiedConnection?.sourceId ?? '')).toBe(true)
    expect(copiedIds.has(copiedConnection?.targetId ?? '')).toBe(true)
    expect(copiedConnection?.sourceId).not.toBe('a')
    expect(copiedConnection?.targetId).not.toBe('b')
  })
})
