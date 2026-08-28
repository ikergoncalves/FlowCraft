import { describe, expect, it } from 'vitest'
import { toDocument } from '../persistence/document'
import { loadDocument } from '../persistence/validate'
import { bigBlockId, defaultColumns, makeBigDiagram } from './bigDiagram'

describe('makeBigDiagram', () => {
  it('makes exactly as many blocks as asked for', () => {
    const document = makeBigDiagram({ blocks: 500, connections: 800 })
    expect(document.blockOrder).toHaveLength(500)
    expect(Object.keys(document.blocks)).toHaveLength(500)
  })

  it('makes exactly as many connections as asked for', () => {
    const document = makeBigDiagram({ blocks: 500, connections: 800 })
    expect(document.connectionOrder).toHaveLength(800)
  })

  it('caps the connections at the neighbour pairs the grid actually has', () => {
    // Four blocks in a 2x2 grid have two horizontal and two vertical pairs.
    const document = makeBigDiagram({ blocks: 4, connections: 999, columns: 2 })
    expect(document.connectionOrder).toHaveLength(4)
  })

  it('is deterministic, so two runs measure the same document', () => {
    const first = makeBigDiagram({ blocks: 120, connections: 200 })
    const second = makeBigDiagram({ blocks: 120, connections: 200 })
    expect(first).toEqual(second)
  })

  it('lays the blocks out on a grid with no two in the same cell', () => {
    const document = makeBigDiagram({ blocks: 40, connections: 0, columns: 8 })
    const cells = document.blockOrder.map((id) => {
      const block = document.blocks[id]
      return `${block?.x},${block?.y}`
    })
    expect(new Set(cells).size).toBe(40)
  })

  it('gives every block a positional id matching its slot in the order', () => {
    const document = makeBigDiagram({ blocks: 10, connections: 0 })
    expect(document.blockOrder[0]).toBe(bigBlockId(0))
    expect(document.blockOrder[9]).toBe(bigBlockId(9))
  })

  it('joins only neighbouring blocks, never a block to itself', () => {
    const document = makeBigDiagram({ blocks: 100, connections: 180 })
    for (const id of document.connectionOrder) {
      const connection = document.connections[id]
      expect(connection?.sourceId).not.toBe(connection?.targetId)
    }
  })

  it('never repeats the same pair of endpoints', () => {
    const document = makeBigDiagram({ blocks: 100, connections: 180 })
    const pairs = document.connectionOrder.map((id) => {
      const connection = document.connections[id]
      return `${connection?.sourceId}->${connection?.targetId}`
    })
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('produces a document the validator accepts with nothing to repair', () => {
    // The validator is the same door a load comes through: no dangling
    // endpoint, no order list disagreeing with its map. A generator that
    // needed repairs would be measuring a document the editor cannot hold.
    const result = loadDocument(
      toDocument(makeBigDiagram({ blocks: 300, connections: 500 })),
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.repairs).toEqual([])
  })

  it('handles the degenerate sizes without throwing', () => {
    expect(makeBigDiagram({ blocks: 0, connections: 0 }).blockOrder).toEqual([])
    expect(makeBigDiagram({ blocks: 1, connections: 5 }).connectionOrder).toEqual([])
    expect(makeBigDiagram({ blocks: -3, connections: -3 }).blockOrder).toEqual([])
  })

  it('picks a roughly square grid when none is given', () => {
    expect(defaultColumns(100)).toBe(10)
    expect(defaultColumns(500)).toBe(23)
    expect(defaultColumns(0)).toBe(1)
  })
})
