import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { makeBlockAt } from '../utils/blocks'
import { useDiagramStore } from './diagramStore'

const store = () => useDiagramStore.getState()

const reset = () =>
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    tool: 'select',
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
