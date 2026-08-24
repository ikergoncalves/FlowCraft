import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { makeBlockAt } from '../utils/blocks'
import { useDiagramStore } from './diagramStore'

/*
 * Connection state: adding, removing, the cascade from block removal, and the
 * two-list selection. Kept apart from diagramStore.test.ts so the Phase 2
 * block behaviour and the Phase 3 connection behaviour stay readable.
 */

const store = () => useDiagramStore.getState()

const reset = () =>
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    snapToGrid: true,
  })

beforeEach(reset)

/** Two blocks, side by side, ready to be wired together. */
const twoBlocks = () => ({
  a: store().addBlock(makeBlockAt('rect', { x: 0, y: 0 })),
  b: store().addBlock(makeBlockAt('rect', { x: 400, y: 0 })),
})

const idOf = (value: { id: string } | null): string => {
  if (value === null) throw new Error('expected a connection, got null')
  return value.id
}

describe('addConnection', () => {
  it('adds the connection and returns it with a generated id', () => {
    const { a, b } = twoBlocks()

    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })

    expect(connection).not.toBeNull()
    expect(connection?.id).toBeTruthy()
    expect(store().connections[idOf(connection)]).toEqual(connection)
    expect(store().connectionOrder).toEqual([idOf(connection)])
  })

  it('stores ids and anchors only, never endpoint coordinates', () => {
    const { a, b } = twoBlocks()

    const connection = store().addConnection({
      sourceId: a.id,
      targetId: b.id,
      sourceAnchor: 'e',
      targetAnchor: 'w',
    })

    expect(Object.keys(connection ?? {}).sort()).toEqual([
      'id',
      'sourceAnchor',
      'sourceId',
      'targetAnchor',
      'targetId',
    ])
  })

  it('keeps connectionOrder in step with the connections map', () => {
    const { a, b } = twoBlocks()
    const c = store().addBlock(makeBlockAt('rect', { x: 0, y: 400 }))

    const first = store().addConnection({ sourceId: a.id, targetId: b.id })
    const second = store().addConnection({ sourceId: a.id, targetId: c.id })

    expect(store().connectionOrder).toEqual([idOf(first), idOf(second)])
    expect(Object.keys(store().connections).sort()).toEqual(
      [idOf(first), idOf(second)].sort(),
    )
  })

  it('honours an explicit id, so Phase 4 can restore a removed connection', () => {
    const { a, b } = twoBlocks()

    const connection = store().addConnection({
      id: 'fixed-connection',
      sourceId: a.id,
      targetId: b.id,
    })

    expect(connection?.id).toBe('fixed-connection')
    expect(store().connections['fixed-connection']).toBeDefined()
  })

  it('rejects a block wired to itself', () => {
    const { a } = twoBlocks()

    expect(store().addConnection({ sourceId: a.id, targetId: a.id })).toBeNull()
    expect(store().connectionOrder).toEqual([])
  })

  it('rejects an exact duplicate', () => {
    const { a, b } = twoBlocks()
    store().addConnection({ sourceId: a.id, targetId: b.id })

    expect(store().addConnection({ sourceId: a.id, targetId: b.id })).toBeNull()
    expect(store().connectionOrder).toHaveLength(1)
  })

  it('treats differing anchors as a different connection', () => {
    const { a, b } = twoBlocks()
    store().addConnection({ sourceId: a.id, targetId: b.id, sourceAnchor: 'e' })

    const second = store().addConnection({
      sourceId: a.id,
      targetId: b.id,
      sourceAnchor: 'n',
    })

    expect(second).not.toBeNull()
    expect(store().connectionOrder).toHaveLength(2)
  })

  it('treats the reversed direction as a different connection', () => {
    const { a, b } = twoBlocks()
    store().addConnection({ sourceId: a.id, targetId: b.id })

    expect(store().addConnection({ sourceId: b.id, targetId: a.id })).not.toBeNull()
    expect(store().connectionOrder).toHaveLength(2)
  })

  it('rejects an endpoint that is not a block', () => {
    const { a } = twoBlocks()

    expect(store().addConnection({ sourceId: a.id, targetId: 'ghost' })).toBeNull()
    expect(store().addConnection({ sourceId: 'ghost', targetId: a.id })).toBeNull()
    expect(store().connectionOrder).toEqual([])
  })
})

describe('removeConnections', () => {
  it('removes the connection and leaves both blocks standing', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })

    store().removeConnection(idOf(connection))

    expect(store().connectionOrder).toEqual([])
    expect(store().connections).toEqual({})
    expect(store().blockOrder).toEqual([a.id, b.id])
    expect(store().blocks[a.id]).toBeDefined()
    expect(store().blocks[b.id]).toBeDefined()
  })

  it('drops the removed ids from the connection selection', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().selectConnections([idOf(connection)])

    store().removeConnections([idOf(connection)])

    expect(store().selectedConnectionIds).toEqual([])
  })

  it('is a no-op for ids that are not connections', () => {
    const { a, b } = twoBlocks()
    store().addConnection({ sourceId: a.id, targetId: b.id })
    const before = store().connections

    store().removeConnections(['ghost'])

    expect(store().connections).toBe(before)
  })
})

describe('removeBlocks cascade', () => {
  it('removes the connections touching a removed block', () => {
    const { a, b } = twoBlocks()
    const c = store().addBlock(makeBlockAt('rect', { x: 0, y: 400 }))
    const ab = store().addConnection({ sourceId: a.id, targetId: b.id })
    const bc = store().addConnection({ sourceId: b.id, targetId: c.id })

    store().removeBlocks([a.id])

    expect(store().connectionOrder).toEqual([idOf(bc)])
    expect(store().connections[idOf(ab)]).toBeUndefined()
  })

  it('cascades whether the block was the source or the target', () => {
    const { a, b } = twoBlocks()
    store().addConnection({ sourceId: a.id, targetId: b.id })

    store().removeBlocks([b.id])

    expect(store().connectionOrder).toEqual([])
  })

  it('returns the cascaded connections in full, for Phase 4 undo', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({
      sourceId: a.id,
      targetId: b.id,
      sourceAnchor: 'e',
      targetAnchor: 'w',
    })

    const removed = store().removeBlocks([a.id])

    // Whole objects, not ids: undo has to restore the anchors verbatim.
    expect(removed).toEqual([connection])
  })

  it('returns an empty list when nothing was connected', () => {
    const { a } = twoBlocks()

    expect(store().removeBlocks([a.id])).toEqual([])
  })

  it('returns an empty list when no id was a block', () => {
    twoBlocks()

    expect(store().removeBlocks(['ghost'])).toEqual([])
  })

  it('reports a connection between two removed blocks exactly once', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })

    const removed = store().removeBlocks([a.id, b.id])

    expect(removed.map((entry) => entry.id)).toEqual([idOf(connection)])
  })

  it('drops cascaded connections from the connection selection', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().selectConnections([idOf(connection)])

    store().removeBlocks([a.id])

    expect(store().selectedConnectionIds).toEqual([])
  })

  it('keeps connections between blocks that survive', () => {
    const { a, b } = twoBlocks()
    const c = store().addBlock(makeBlockAt('rect', { x: 0, y: 400 }))
    const ab = store().addConnection({ sourceId: a.id, targetId: b.id })

    store().removeBlocks([c.id])

    expect(store().connectionOrder).toEqual([idOf(ab)])
  })

  it('removeBlock forwards the cascade result too', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })

    expect(store().removeBlock(a.id)).toEqual([connection])
  })
})

describe('connection selection', () => {
  it('selects connections and clears the block selection', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().select([a.id])

    store().selectConnections([idOf(connection)])

    expect(store().selectedConnectionIds).toEqual([idOf(connection)])
    expect(store().selectedIds).toEqual([])
  })

  it('clears the connection selection when blocks are selected instead', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().selectConnections([idOf(connection)])

    store().select([a.id])

    expect(store().selectedConnectionIds).toEqual([])
    expect(store().selectedIds).toEqual([a.id])
  })

  it('toggles one connection without disturbing selected blocks', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().select([a.id])

    store().toggleConnectionSelection(idOf(connection))
    expect(store().selectedIds).toEqual([a.id])
    expect(store().selectedConnectionIds).toEqual([idOf(connection)])

    store().toggleConnectionSelection(idOf(connection))
    expect(store().selectedIds).toEqual([a.id])
    expect(store().selectedConnectionIds).toEqual([])
  })

  it('clears both kinds at once', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().select([a.id])
    store().toggleConnectionSelection(idOf(connection))

    store().clearSelection()

    expect(store().selectedIds).toEqual([])
    expect(store().selectedConnectionIds).toEqual([])
  })

  it('selects all blocks but no connections', () => {
    const { a, b } = twoBlocks()
    const connection = store().addConnection({ sourceId: a.id, targetId: b.id })
    store().toggleConnectionSelection(idOf(connection))

    store().selectAll()

    expect(store().selectedIds).toEqual([a.id, b.id])
    expect(store().selectedConnectionIds).toEqual([])
  })
})

describe('snapToGrid', () => {
  it('is on by default', () => {
    expect(store().snapToGrid).toBe(true)
  })

  it('is set outright by setSnapToGrid', () => {
    store().setSnapToGrid(false)
    expect(store().snapToGrid).toBe(false)
    store().setSnapToGrid(true)
    expect(store().snapToGrid).toBe(true)
  })

  it('flips with toggleSnapToGrid', () => {
    store().toggleSnapToGrid()
    expect(store().snapToGrid).toBe(false)
    store().toggleSnapToGrid()
    expect(store().snapToGrid).toBe(true)
  })
})
