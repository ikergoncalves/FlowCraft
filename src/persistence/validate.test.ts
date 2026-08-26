import { describe, expect, it } from 'vitest'
import type { Block, Connection } from '../types'
import { MIN_GROUP_SIZE } from '../utils/groups'
import { fromDocument, toDocument, type DocumentSlice } from './document'
import type { Migration } from './migrations'
import { loadDocument, validateDocument } from './validate'

/*
 * The validator, one broken invariant at a time.
 *
 * Every case below is a document that would violate something
 * `invariants.test.ts` asserts about the in-memory store. The point of the
 * file is that none of them can get *into* the store: a load is the one door
 * that does not come from a command, and these are what comes through it.
 */

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

const connection = (id: string, sourceId: string, targetId: string): Connection => ({
  id,
  sourceId,
  targetId,
})

function soundSlice(): DocumentSlice {
  return {
    blocks: { a: block('a'), b: block('b', { x: 300 }), c: block('c', { x: 600 }) },
    blockOrder: ['a', 'b', 'c'],
    connections: { ab: connection('ab', 'a', 'b') },
    connectionOrder: ['ab'],
    groups: { g1: { id: 'g1', blockIds: ['a', 'b'] } },
    groupOrder: ['g1'],
  }
}

/** A raw record, mutable, that starts out perfectly sound. */
const sound = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(toDocument(soundSlice()))) as Record<string, unknown>

const loaded = (raw: unknown) => {
  const result = validateDocument(raw)
  if (!result.ok) throw new Error(`expected a document, got ${result.reason}`)
  return result
}

describe('a sound document', () => {
  it('passes through untouched, with nothing to repair', () => {
    const result = loaded(sound())
    expect(result.repairs).toEqual([])
    expect(fromDocument(result.document)).toEqual(soundSlice())
  })

  it('is the identity on a full round trip', () => {
    // The property the whole format rests on: validating must not be the thing
    // that changes a document.
    const slice = {
      ...soundSlice(),
      blocks: {
        a: block('a', { style: { fill: '#e2683c', fontSize: 18 } }),
        b: block('b', { x: 300, type: 'text' as const }),
        c: block('c', { x: 600 }),
      },
      connections: {
        ab: {
          ...connection('ab', 'a', 'b'),
          sourceAnchor: 'e' as const,
          style: { stroke: '#ffaa00', dashed: true },
        },
      },
    }
    const result = loaded(toDocument(slice))
    expect(result.repairs).toEqual([])
    expect(fromDocument(result.document)).toEqual(slice)
  })

  it('keeps an explicitly empty style as an empty style', () => {
    // Collapsing `{}` to `undefined` would be a repair on a sound document,
    // and would break the round trip above for any diagram that had one.
    const raw = sound()
    ;(raw.blocks as Record<string, Block>).a!.style = {}
    const result = loaded(raw)
    expect(result.repairs).toEqual([])
    expect(result.document.blocks.a?.style).toEqual({})
  })
})

describe('documents that are not documents at all', () => {
  it('refuses anything that is not an object', () => {
    for (const raw of [null, undefined, 7, 'hello', [], true]) {
      const result = validateDocument(raw)
      expect(result.ok, JSON.stringify(raw)).toBe(false)
      if (!result.ok) expect(result.reason).toBe('bad-shape')
    }
  })

  it('refuses a document with a missing slice', () => {
    for (const key of ['blocks', 'connections', 'groups'] as const) {
      const raw = sound()
      delete raw[key]
      expect(validateDocument(raw).ok, key).toBe(false)
    }
  })

  it('refuses a slice of the wrong kind', () => {
    const asArray = sound()
    asArray.blocks = []
    expect(validateDocument(asArray).ok).toBe(false)

    const asObject = sound()
    asObject.blockOrder = { 0: 'a' }
    expect(validateDocument(asObject).ok).toBe(false)
  })

  it('says which slice was wrong', () => {
    const raw = sound()
    raw.connections = 'nope'
    const result = validateDocument(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.detail).toContain('connections')
  })
})

describe('blocks with the wrong shape', () => {
  const withBlock = (value: unknown) => {
    const raw = sound()
    ;(raw.blocks as Record<string, unknown>).bad = value
    ;(raw.blockOrder as string[]).push('bad')
    return raw
  }

  it('drops a block that is not an object', () => {
    const result = loaded(withBlock('a block'))
    expect(result.document.blocks.bad).toBeUndefined()
    expect(result.document.blockOrder).not.toContain('bad')
    expect(result.repairs.join(' ')).toContain('bad')
  })

  it('drops a block whose id disagrees with its key', () => {
    expect(loaded(withBlock(block('other'))).document.blocks.bad).toBeUndefined()
  })

  it('drops a block with a coordinate that is not a number', () => {
    expect(
      loaded(withBlock({ ...block('bad'), x: '10' })).document.blocks.bad,
    ).toBeUndefined()
    expect(
      loaded(withBlock({ ...block('bad'), y: Number.NaN })).document.blocks.bad,
    ).toBeUndefined()
    expect(
      loaded(withBlock({ ...block('bad'), width: Number.POSITIVE_INFINITY })).document
        .blocks.bad,
    ).toBeUndefined()
  })

  it('drops a block with a negative size or a non-string label', () => {
    expect(
      loaded(withBlock({ ...block('bad'), height: -5 })).document.blocks.bad,
    ).toBeUndefined()
    expect(
      loaded(withBlock({ ...block('bad'), text: 42 })).document.blocks.bad,
    ).toBeUndefined()
  })

  it('drops a block of an unknown type', () => {
    expect(
      loaded(withBlock({ ...block('bad'), type: 'hexagon' })).document.blocks.bad,
    ).toBeUndefined()
  })

  it('keeps the block and drops only the bad style field', () => {
    // A block whose fontSize arrived as a string still has a perfectly good
    // fill; throwing the style away would repaint something deliberate.
    const raw = withBlock({
      ...block('bad'),
      style: { fill: '#123456', fontSize: '18', nonsense: true },
    })
    const result = loaded(raw)
    expect(result.document.blocks.bad?.style).toEqual({ fill: '#123456' })
    expect(result.repairs.join(' ')).toContain('fontSize')
    expect(result.repairs.join(' ')).toContain('nonsense')
  })
})

describe('the orphan rule', () => {
  it('drops a connection whose source is not a block', () => {
    const raw = sound()
    ;(raw.connections as Record<string, unknown>).bad = connection('bad', 'ghost', 'b')
    ;(raw.connectionOrder as string[]).push('bad')

    const result = loaded(raw)
    expect(result.document.connections.bad).toBeUndefined()
    expect(result.document.connectionOrder).toEqual(['ab'])
    expect(result.repairs.join(' ')).toContain('bad')
  })

  it('drops a connection whose target is not a block', () => {
    const raw = sound()
    ;(raw.connections as Record<string, unknown>).bad = connection('bad', 'a', 'ghost')
    expect(loaded(raw).document.connections.bad).toBeUndefined()
  })

  it('cascades: a malformed block takes its arrows with it', () => {
    // Exactly what `removeBlocks` does in a running editor. The repair is the
    // editor's own rule applied to a file, not a second, laxer notion of
    // soundness.
    const raw = sound()
    ;(raw.blocks as Record<string, unknown>).b = { ...block('b'), width: 'wide' }

    const result = loaded(raw)
    expect(result.document.blocks.b).toBeUndefined()
    expect(result.document.connections.ab).toBeUndefined()
    expect(result.document.groups.g1).toBeUndefined()
  })

  it('keeps the arrow but drops an anchor it cannot understand', () => {
    const raw = sound()
    ;(raw.connections as Record<string, unknown>).ab = {
      ...connection('ab', 'a', 'b'),
      sourceAnchor: 'up',
    }
    const result = loaded(raw)
    expect(result.document.connections.ab).toBeDefined()
    expect(result.document.connections.ab?.sourceAnchor).toBeUndefined()
    expect(result.repairs.join(' ')).toContain('sourceAnchor')
  })
})

describe('group rules', () => {
  it('drops a member that is not a block, keeping the group', () => {
    const raw = sound()
    ;(raw.groups as Record<string, unknown>).g1 = {
      id: 'g1',
      blockIds: ['a', 'b', 'ghost'],
    }
    const result = loaded(raw)
    expect(result.document.groups.g1?.blockIds).toEqual(['a', 'b'])
    expect(result.repairs.join(' ')).toContain('ghost')
  })

  it('dissolves a group left below the minimum', () => {
    const raw = sound()
    ;(raw.groups as Record<string, unknown>).g1 = { id: 'g1', blockIds: ['a', 'ghost'] }
    const result = loaded(raw)
    expect(result.document.groups.g1).toBeUndefined()
    expect(result.document.groupOrder).toEqual([])
    // Its blocks survive: ungrouping is not a delete.
    expect(result.document.blocks.a).toBeDefined()
  })

  it('dissolves a group of one, whatever the file says', () => {
    const raw = sound()
    ;(raw.groups as Record<string, unknown>).g1 = { id: 'g1', blockIds: ['a'] }
    expect(loaded(raw).document.groups.g1).toBeUndefined()
    expect(MIN_GROUP_SIZE).toBe(2)
  })

  it('never leaves a block in two groups', () => {
    const raw = sound()
    raw.groups = {
      g1: { id: 'g1', blockIds: ['a', 'b'] },
      g2: { id: 'g2', blockIds: ['a', 'c'] },
    }
    raw.groupOrder = ['g1', 'g2']

    const result = loaded(raw)
    const owners = new Map<string, string>()
    for (const entry of Object.values(result.document.groups)) {
      for (const id of entry.blockIds) {
        expect(owners.has(id)).toBe(false)
        owners.set(id, entry.id)
      }
    }
    // The first group to name it keeps it; the second is left with one member
    // and therefore dissolves.
    expect(result.document.groups.g1?.blockIds).toEqual(['a', 'b'])
    expect(result.document.groups.g2).toBeUndefined()
  })

  it('collapses a member listed twice in one group', () => {
    const raw = sound()
    ;(raw.groups as Record<string, unknown>).g1 = {
      id: 'g1',
      blockIds: ['a', 'b', 'a'],
    }
    expect(loaded(raw).document.groups.g1?.blockIds).toEqual(['a', 'b'])
  })

  it('drops a group whose members are not a list', () => {
    const raw = sound()
    ;(raw.groups as Record<string, unknown>).g1 = { id: 'g1', blockIds: 'a,b' }
    expect(loaded(raw).document.groups.g1).toBeUndefined()
  })
})

describe('order lists out of step with their maps', () => {
  it('drops an order entry naming nothing', () => {
    const raw = sound()
    ;(raw.blockOrder as string[]).push('ghost')
    const result = loaded(raw)
    expect(result.document.blockOrder).toEqual(['a', 'b', 'c'])
    expect(result.repairs.join(' ')).toContain('blockOrder')
  })

  it('appends a block the order forgot, rather than dropping the block', () => {
    // Losing content over a paint-order detail would be the wrong trade.
    const raw = sound()
    raw.blockOrder = ['a', 'c']
    const result = loaded(raw)
    expect(result.document.blockOrder).toHaveLength(3)
    expect(result.document.blockOrder).toContain('b')
    expect(result.document.blocks.b).toBeDefined()
  })

  it('collapses a duplicate order entry', () => {
    const raw = sound()
    raw.blockOrder = ['a', 'b', 'a', 'c']
    expect(loaded(raw).document.blockOrder).toEqual(['a', 'b', 'c'])
  })

  it('keeps the order it can, and only appends what is missing', () => {
    const raw = sound()
    raw.blockOrder = ['c', 'a']
    expect(loaded(raw).document.blockOrder).toEqual(['c', 'a', 'b'])
  })

  it('rebuilds every order list, not just the blocks', () => {
    const raw = sound()
    raw.connectionOrder = []
    raw.groupOrder = ['g1', 'g1', 'ghost']
    const result = loaded(raw)
    expect(result.document.connectionOrder).toEqual(['ab'])
    expect(result.document.groupOrder).toEqual(['g1'])
  })

  it('leaves every surviving map and order in step', () => {
    const raw = sound()
    raw.blockOrder = ['ghost']
    raw.connectionOrder = ['ab', 'ab']
    raw.groupOrder = []
    const { document } = loaded(raw)
    for (const [map, order] of [
      [document.blocks, document.blockOrder],
      [document.connections, document.connectionOrder],
      [document.groups, document.groupOrder],
    ] as const) {
      expect(Object.keys(map).sort()).toEqual([...order].sort())
      expect(new Set(order).size).toBe(order.length)
    }
  })
})

describe('loadDocument', () => {
  it('migrates before it validates', () => {
    // A migration is written against the shape it upgrades *from*, so
    // validating first would check version 1 against version 2's rules.
    const migrations: Record<number, Migration> = {
      1: (document) => ({
        ...document,
        blocks: {
          ...(document.blocks as Record<string, Block>),
          d: block('d', { x: 900 }),
        },
        blockOrder: [...(document.blockOrder as string[]), 'd'],
      }),
    }
    const result = loadDocument(sound(), { migrations, target: 2 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.blocks.d).toBeDefined()
    expect(result.document.version).toBe(2)
  })

  it('passes a migration failure straight through', () => {
    expect(loadDocument({ version: 99 })).toEqual({
      ok: false,
      reason: 'from-the-future',
    })
    expect(loadDocument('a diagram')).toEqual({ ok: false, reason: 'not-an-object' })
    expect(loadDocument(undefined)).toEqual({ ok: false, reason: 'not-an-object' })
  })

  it('rejects a document that migrates cleanly but is not one', () => {
    expect(loadDocument({ version: 1, blocks: 'none' }).ok).toBe(false)
  })

  it('reports the version the walk arrived at, not the one in the file', () => {
    const result = loadDocument(sound())
    expect(result.ok && result.document.version).toBe(1)
  })
})
