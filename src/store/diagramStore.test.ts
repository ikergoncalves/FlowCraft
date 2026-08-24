import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { makeBlockAt } from '../utils/blocks'
import { useDiagramStore } from './diagramStore'

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

describe('addBlock', () => {
  it('adds the block and returns it with a generated id', () => {
    const block = store().addBlock(makeBlockAt('rect', { x: 10, y: 20 }))

    expect(block.id).toBeTruthy()
    expect(store().blocks[block.id]).toEqual(block)
    expect(store().blockOrder).toEqual([block.id])
  })

  it('gives every block a unique id', () => {
    const ids = Array.from(
      { length: 50 },
      (_, index) => store().addBlock(makeBlockAt('rect', { x: index, y: index })).id,
    )

    expect(new Set(ids).size).toBe(ids.length)
    expect(store().blockOrder).toEqual(ids)
  })

  it('preserves insertion order for painting', () => {
    const first = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const second = store().addBlock(makeBlockAt('text', { x: 0, y: 0 }))
    expect(store().blockOrder).toEqual([first.id, second.id])
  })

  it('honours an explicit id, so Phase 4 can restore a removed block', () => {
    const block = store().addBlock({
      ...makeBlockAt('rect', { x: 0, y: 0 }),
      id: 'fixed-id',
    })

    expect(block.id).toBe('fixed-id')
    expect(store().blocks['fixed-id']).toBeDefined()
  })

  it('does not duplicate the z-order entry when re-adding the same id', () => {
    store().addBlock({ ...makeBlockAt('rect', { x: 0, y: 0 }), id: 'fixed-id' })
    store().addBlock({ ...makeBlockAt('text', { x: 5, y: 5 }), id: 'fixed-id' })

    expect(store().blockOrder).toEqual(['fixed-id'])
    expect(store().blocks['fixed-id']?.type).toBe('text')
  })
})

describe('updateBlock', () => {
  it('patches only the targeted block', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 300, y: 300 }))
    const bBefore = store().blocks[b.id]

    store().updateBlock(a.id, { text: 'renamed', x: 42 })

    expect(store().blocks[a.id]).toMatchObject({ text: 'renamed', x: 42 })
    expect(store().blocks[b.id]).toBe(bBefore)
  })

  it('leaves untouched fields alone', () => {
    const block = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    store().updateBlock(block.id, { text: 'hello' })

    expect(store().blocks[block.id]).toMatchObject({
      width: block.width,
      height: block.height,
      type: block.type,
    })
  })

  it('is a no-op for an unknown id', () => {
    const block = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const before = store().blocks

    store().updateBlock('does-not-exist', { text: 'nope' })

    expect(store().blocks).toBe(before)
    expect(store().blockOrder).toEqual([block.id])
  })
})

describe('removeBlock', () => {
  it('removes the block from the map and the z-order', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 100, y: 0 }))

    store().removeBlock(a.id)

    expect(store().blocks[a.id]).toBeUndefined()
    expect(store().blockOrder).toEqual([b.id])
  })

  it('drops the removed id from the selection', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 100, y: 0 }))
    store().select([a.id, b.id])

    store().removeBlock(a.id)

    expect(store().selectedIds).toEqual([b.id])
  })

  it('is a no-op for an unknown id', () => {
    const block = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const before = store().blocks

    store().removeBlock('does-not-exist')

    expect(store().blocks).toBe(before)
    expect(store().blockOrder).toEqual([block.id])
  })
})

describe('removeBlocks', () => {
  it('removes several blocks and clears their selection in one pass', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 100, y: 0 }))
    const c = store().addBlock(makeBlockAt('text', { x: 200, y: 0 }))
    store().select([a.id, b.id, c.id])

    store().removeBlocks([a.id, c.id])

    expect(store().blockOrder).toEqual([b.id])
    expect(store().selectedIds).toEqual([b.id])
  })
})

describe('selection', () => {
  it('accepts a single id', () => {
    store().select('one')
    expect(store().selectedIds).toEqual(['one'])
  })

  it('replaces the previous selection', () => {
    store().select(['one', 'two'])
    store().select('three')
    expect(store().selectedIds).toEqual(['three'])
  })

  it('clears the selection', () => {
    store().select(['one', 'two'])
    store().clearSelection()
    expect(store().selectedIds).toEqual([])
  })

  it('does not churn state when clearing an already-empty selection', () => {
    const before = store().selectedIds
    store().clearSelection()
    expect(store().selectedIds).toBe(before)
  })
})

describe('viewport', () => {
  it('stores the viewport verbatim', () => {
    const viewport = { x: -120, y: 55, zoom: 2.5 }
    store().setViewport(viewport)
    expect(store().viewport).toEqual(viewport)
  })

  it('resets back to the default view', () => {
    store().setViewport({ x: -120, y: 55, zoom: 2.5 })
    store().resetView()
    expect(store().viewport).toEqual(DEFAULT_VIEWPORT)
  })
})

describe('tool', () => {
  it('starts on select and switches on demand', () => {
    expect(store().tool).toBe('select')
    store().setTool('rect')
    expect(store().tool).toBe('rect')
  })
})

describe('updateBlocks', () => {
  it('patches several blocks in one state update', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 100, y: 0 }))
    let updates = 0
    const unsubscribe = useDiagramStore.subscribe(() => {
      updates += 1
    })

    store().updateBlocks({ [a.id]: { text: 'A' }, [b.id]: { text: 'B' } })
    unsubscribe()

    expect(updates).toBe(1)
    expect(store().blocks[a.id]?.text).toBe('A')
    expect(store().blocks[b.id]?.text).toBe('B')
  })

  it('touches only the targeted blocks', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 100, y: 0 }))
    const untouched = store().blocks[b.id]

    store().updateBlocks({ [a.id]: { x: 42 } })

    expect(store().blocks[a.id]?.x).toBe(42)
    expect(store().blocks[b.id]).toBe(untouched)
  })

  it('skips unknown ids and leaves the known ones patched', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))

    store().updateBlocks({ [a.id]: { text: 'kept' }, ghost: { text: 'ignored' } })

    expect(store().blocks[a.id]?.text).toBe('kept')
    expect(store().blocks.ghost).toBeUndefined()
    expect(store().blockOrder).toEqual([a.id])
  })

  it('is a no-op when nothing matches', () => {
    store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const before = store().blocks

    store().updateBlocks({ ghost: { text: 'nope' } })
    store().updateBlocks({})

    expect(store().blocks).toBe(before)
  })
})

describe('setBlockPositions', () => {
  it('moves blocks to absolute positions without touching their size', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))

    store().setBlockPositions({ [a.id]: { x: 250, y: -30 } })

    expect(store().blocks[a.id]).toMatchObject({
      x: 250,
      y: -30,
      width: a.width,
      height: a.height,
    })
  })

  it('preserves the relative distances when moving N blocks by one delta', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 300, y: 120 }))
    const c = store().addBlock(makeBlockAt('text', { x: -80, y: 40 }))
    const snapshot = [a, b, c].map((block) => ({ id: block.id, x: block.x, y: block.y }))
    const delta = { x: 37.5, y: -12.25 }

    store().setBlockPositions(
      Object.fromEntries(
        snapshot.map(({ id, x, y }) => [id, { x: x + delta.x, y: y + delta.y }]),
      ),
    )

    const moved = snapshot.map(({ id }) => store().blocks[id])
    for (const [index, block] of moved.entries()) {
      expect(block?.x).toBeCloseTo((snapshot[index]?.x ?? 0) + delta.x, 10)
      expect(block?.y).toBeCloseTo((snapshot[index]?.y ?? 0) + delta.y, 10)
    }
    // Pairwise gaps survive the move, which is the whole point of applying a
    // shared delta to a snapshot rather than nudging each block in turn.
    expect((moved[1]?.x ?? 0) - (moved[0]?.x ?? 0)).toBeCloseTo(
      (snapshot[1]?.x ?? 0) - (snapshot[0]?.x ?? 0),
      10,
    )
    expect((moved[2]?.y ?? 0) - (moved[1]?.y ?? 0)).toBeCloseTo(
      (snapshot[2]?.y ?? 0) - (snapshot[1]?.y ?? 0),
      10,
    )
  })

  it('is idempotent, so a replayed frame cannot drift', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const positions = { [a.id]: { x: 12.3, y: 45.6 } }

    store().setBlockPositions(positions)
    store().setBlockPositions(positions)
    store().setBlockPositions(positions)

    expect(store().blocks[a.id]).toMatchObject({ x: 12.3, y: 45.6 })
  })

  it('restores a snapshot verbatim, which is how a cancelled drag rewinds', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 10, y: 20 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 90, y: 10 }))
    const snapshot = {
      [a.id]: { x: a.x, y: a.y },
      [b.id]: { x: b.x, y: b.y },
    }

    store().setBlockPositions({ [a.id]: { x: 999, y: 999 }, [b.id]: { x: 0, y: 0 } })
    store().setBlockPositions(snapshot)

    expect(store().blocks[a.id]).toMatchObject(snapshot[a.id] ?? {})
    expect(store().blocks[b.id]).toMatchObject(snapshot[b.id] ?? {})
  })
})

describe('addToSelection', () => {
  it('adds ids without dropping the existing selection', () => {
    store().select(['a'])
    store().addToSelection(['b', 'c'])
    expect(store().selectedIds).toEqual(['a', 'b', 'c'])
  })

  it('accepts a single id', () => {
    store().select(['a'])
    store().addToSelection('b')
    expect(store().selectedIds).toEqual(['a', 'b'])
  })

  it('never duplicates an id already selected', () => {
    store().select(['a', 'b'])
    store().addToSelection(['b', 'c'])
    expect(store().selectedIds).toEqual(['a', 'b', 'c'])
  })

  it('does not churn state when everything is already selected', () => {
    store().select(['a', 'b'])
    const before = store().selectedIds
    store().addToSelection(['a', 'b'])
    expect(store().selectedIds).toBe(before)
  })
})

describe('toggleSelection', () => {
  it('adds an id that was not selected', () => {
    store().select(['a'])
    store().toggleSelection('b')
    expect(store().selectedIds).toEqual(['a', 'b'])
  })

  it('removes an id that was selected, keeping the rest', () => {
    store().select(['a', 'b', 'c'])
    store().toggleSelection('b')
    expect(store().selectedIds).toEqual(['a', 'c'])
  })

  it('round-trips back to the original selection', () => {
    store().select(['a'])
    store().toggleSelection('b')
    store().toggleSelection('b')
    expect(store().selectedIds).toEqual(['a'])
  })

  it('works from an empty selection', () => {
    store().toggleSelection('a')
    expect(store().selectedIds).toEqual(['a'])
  })
})

describe('selectAll', () => {
  it('selects every block, in paint order', () => {
    const ids = ['rect', 'text', 'rect'].map(
      (type, index) =>
        store().addBlock(makeBlockAt(type as 'rect' | 'text', { x: index * 50, y: 0 }))
          .id,
    )

    store().selectAll()

    expect(store().selectedIds).toEqual(ids)
  })

  it('selects nothing on an empty diagram', () => {
    store().select(['stale'])
    store().selectAll()
    expect(store().selectedIds).toEqual([])
  })

  it('replaces a partial selection rather than appending to it', () => {
    const a = store().addBlock(makeBlockAt('rect', { x: 0, y: 0 }))
    const b = store().addBlock(makeBlockAt('rect', { x: 50, y: 0 }))
    store().select([b.id])

    store().selectAll()

    expect(store().selectedIds).toEqual([a.id, b.id])
  })
})
