import { describe, expect, it } from 'vitest'
import type { Block, Connection } from '../types'
import { cloneElements, collectElements, type ElementSource } from './clone'

const block = (id: string, x = 0, y = 0): Block => ({
  id,
  type: 'rect',
  x,
  y,
  width: 100,
  height: 60,
  text: id,
})

const connection = (id: string, sourceId: string, targetId: string): Connection => ({
  id,
  sourceId,
  targetId,
  sourceAnchor: 'e',
})

/** Three blocks in a row, wired a -> b -> c. */
function diagram(): ElementSource {
  const blocks = [block('a', 0, 0), block('b', 200, 0), block('c', 400, 0)]
  const connections = [connection('ab', 'a', 'b'), connection('bc', 'b', 'c')]
  return {
    blocks: Object.fromEntries(blocks.map((item) => [item.id, item])),
    blockOrder: blocks.map((item) => item.id),
    connections: Object.fromEntries(connections.map((item) => [item.id, item])),
    connectionOrder: connections.map((item) => item.id),
    groups: {},
    groupOrder: [],
  }
}

/** Readable ids, so the remapping assertions read as assertions. */
function idFactory(prefix = 'new'): () => string {
  let n = 0
  return () => `${prefix}-${(n += 1)}`
}

describe('collectElements', () => {
  it('takes the named blocks in paint order', () => {
    const set = collectElements(diagram(), ['c', 'a'])
    expect(set.blocks.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('takes a connection whose two ends are both selected', () => {
    const set = collectElements(diagram(), ['a', 'b'])
    expect(set.connections.map((item) => item.id)).toEqual(['ab'])
  })

  it('drops a connection with only one end selected', () => {
    // 'bc' leaves the selection: copying it would either dangle or silently
    // re-attach the copy to the original 'c'.
    const set = collectElements(diagram(), ['b'])
    expect(set.connections).toEqual([])
  })

  it('copies rather than aliasing the source objects', () => {
    const source = diagram()
    const set = collectElements(source, ['a'])
    expect(set.blocks[0]).not.toBe(source.blocks.a)
    expect(set.blocks[0]).toEqual(source.blocks.a)
  })

  it('copies a block style instead of sharing the object', () => {
    const source = diagram()
    const a = source.blocks.a
    if (!a) throw new Error('missing a')
    a.style = { fill: '#f00' }

    const set = collectElements(source, ['a'])
    expect(set.blocks[0]?.style).toEqual({ fill: '#f00' })
    expect(set.blocks[0]?.style).not.toBe(a.style)
  })

  it('ignores ids that are not in the diagram', () => {
    const set = collectElements(diagram(), ['ghost'])
    expect(set).toEqual({ blocks: [], connections: [], groups: [] })
  })
})

describe('cloneElements', () => {
  it('gives every block a fresh id', () => {
    const set = collectElements(diagram(), ['a', 'b'])
    const clone = cloneElements(set, { x: 0, y: 0 }, idFactory())
    expect(clone.blocks.map((item) => item.id)).toEqual(['new-1', 'new-2'])
  })

  it('remaps connection endpoints onto the new ids', () => {
    const set = collectElements(diagram(), ['a', 'b'])
    const clone = cloneElements(set, { x: 0, y: 0 }, idFactory())

    const [copied] = clone.connections
    expect(copied?.sourceId).toBe('new-1')
    expect(copied?.targetId).toBe('new-2')
    // The whole point: nothing in the copy still refers to the originals.
    expect(copied?.sourceId).not.toBe('a')
    expect(copied?.targetId).not.toBe('b')
  })

  it('keeps the anchors and style of the connection it copied', () => {
    const source = diagram()
    const ab = source.connections.ab
    if (!ab) throw new Error('missing ab')
    ab.targetAnchor = 'w'
    ab.style = { dashed: true }

    const clone = cloneElements(
      collectElements(source, ['a', 'b']),
      { x: 0, y: 0 },
      idFactory(),
    )
    expect(clone.connections[0]?.sourceAnchor).toBe('e')
    expect(clone.connections[0]?.targetAnchor).toBe('w')
    expect(clone.connections[0]?.style).toEqual({ dashed: true })
  })

  it('shifts every block by the offset and leaves the size alone', () => {
    const clone = cloneElements(
      collectElements(diagram(), ['a', 'b']),
      { x: 20, y: -5 },
      idFactory(),
    )
    expect(clone.blocks[0]).toMatchObject({ x: 20, y: -5, width: 100, height: 60 })
    expect(clone.blocks[1]).toMatchObject({ x: 220, y: -5 })
  })

  it('leaves the source untouched', () => {
    const set = collectElements(diagram(), ['a', 'b'])
    cloneElements(set, { x: 50, y: 50 }, idFactory())
    expect(set.blocks[0]).toMatchObject({ id: 'a', x: 0, y: 0 })
    expect(set.connections[0]).toMatchObject({ sourceId: 'a', targetId: 'b' })
  })

  it('drops a connection whose endpoint is not in the set', () => {
    // Never produced by `collectElements`, but this is the invariant that
    // guarantees a pasted arrow can never point outside the paste.
    const set = {
      blocks: [block('a')],
      connections: [connection('ax', 'a', 'x')],
      groups: [],
    }
    expect(cloneElements(set, { x: 0, y: 0 }, idFactory()).connections).toEqual([])
  })

  it('produces different ids on a second clone of the same set', () => {
    const set = collectElements(diagram(), ['a', 'b'])
    const next = idFactory()
    const first = cloneElements(set, { x: 20, y: 20 }, next)
    const second = cloneElements(set, { x: 40, y: 40 }, next)
    expect(first.blocks.map((item) => item.id)).not.toEqual(
      second.blocks.map((item) => item.id),
    )
  })
})
