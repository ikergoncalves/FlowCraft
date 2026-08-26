import { describe, expect, it } from 'vitest'
import type { Block, Connection, Group } from '../types'
import {
  DOCUMENT_KEYS,
  DOCUMENT_VERSION,
  emptyDocument,
  fromDocument,
  isEmptyDocument,
  toDocument,
  type DocumentSlice,
} from './document'
import { migrateDocument, type Migration } from './migrations'

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
  sourceAnchor: 'e',
})

const group = (id: string, blockIds: string[]): Group => ({ id, blockIds })

/** A diagram with a bit of everything: styles, anchors, groups, paint order. */
function sampleSlice(): DocumentSlice {
  return {
    blocks: {
      a: block('a', { style: { fill: '#e2683c', strokeWidth: 2 } }),
      b: block('b', { x: 300, type: 'text', text: 'note' }),
      c: block('c', { x: 600 }),
    },
    blockOrder: ['c', 'a', 'b'],
    connections: {
      ab: { ...connection('ab', 'a', 'b'), style: { stroke: '#ffaa00', dashed: true } },
      bc: connection('bc', 'b', 'c'),
    },
    connectionOrder: ['bc', 'ab'],
    groups: { g1: group('g1', ['a', 'c']) },
    groupOrder: ['g1'],
  }
}

describe('the document format', () => {
  it('stamps the current version from the very first save', () => {
    expect(toDocument(sampleSlice()).version).toBe(DOCUMENT_VERSION)
    expect(emptyDocument().version).toBe(DOCUMENT_VERSION)
  })

  it('carries every slice the store calls the document', () => {
    const document = toDocument(sampleSlice())
    for (const key of DOCUMENT_KEYS) expect(document).toHaveProperty(key)
  })

  it('round-trips a document to itself', () => {
    const slice = sampleSlice()
    expect(fromDocument(toDocument(slice))).toEqual(slice)
  })

  it('round-trips an empty document too', () => {
    const slice = fromDocument(emptyDocument())
    expect(fromDocument(toDocument(slice))).toEqual(slice)
    expect(isEmptyDocument(slice)).toBe(true)
  })

  it('round-trips through JSON, which is what a driver may do to it', () => {
    const slice = sampleSlice()
    const revived: unknown = JSON.parse(JSON.stringify(toDocument(slice)))
    expect(fromDocument(revived as ReturnType<typeof toDocument>)).toEqual(slice)
  })

  it('preserves paint order exactly, not merely membership', () => {
    // The order lists are the whole reason the format mirrors the store; a
    // round trip that sorted them would look right and paint wrong.
    const document = toDocument(sampleSlice())
    expect(document.blockOrder).toEqual(['c', 'a', 'b'])
    expect(document.connectionOrder).toEqual(['bc', 'ab'])
  })

  it('copies deeply, so a later edit cannot reach into a saved document', () => {
    const slice = sampleSlice()
    const document = toDocument(slice)
    const live = slice.blocks.a
    if (!live) throw new Error('missing block')

    live.x = 999
    live.style = { fill: '#000000' }
    slice.blockOrder.push('ghost')

    expect(document.blocks.a?.x).toBe(0)
    expect(document.blocks.a?.style?.fill).toBe('#e2683c')
    expect(document.blockOrder).toEqual(['c', 'a', 'b'])
  })

  it('does not let the version leak back into the store', () => {
    // The version describes the file. A copy of it sitting in the store would
    // be one more thing a later save could stamp wrongly.
    expect(fromDocument(toDocument(sampleSlice()))).not.toHaveProperty('version')
  })
})

describe('migrations', () => {
  const v1 = () => toDocument(sampleSlice()) as unknown

  it('accepts a current-version document with no work to do', () => {
    const result = migrateDocument(v1())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.steps).toBe(0)
      expect(result.from).toBe(1)
    }
  })

  it('rejects anything that is not an object', () => {
    for (const raw of [null, undefined, 42, 'a diagram', [], true]) {
      expect(migrateDocument(raw)).toEqual({ ok: false, reason: 'not-an-object' })
    }
  })

  it('rejects a document with no usable version', () => {
    expect(migrateDocument({ blocks: {} }).ok).toBe(false)
    expect(migrateDocument({ version: '1' }).ok).toBe(false)
    expect(migrateDocument({ version: 1.5 }).ok).toBe(false)
    expect(migrateDocument({ version: 0 }).ok).toBe(false)
    expect(migrateDocument({ version: -1 }).ok).toBe(false)
  })

  it('refuses a document from the future rather than guessing at it', () => {
    // The failure this prevents: reading a version 2 document with version 1
    // rules silently drops whatever fields version 2 added, and then the next
    // auto-save writes the loss back over the original.
    const result = migrateDocument({ ...(v1() as object), version: 99 })
    expect(result).toEqual({ ok: false, reason: 'from-the-future', version: 99 })
  })

  it('walks a registered chain one step at a time', () => {
    // The pretend future the mechanism exists for. Two steps, so the walk is
    // actually a walk rather than a single call in disguise.
    const steps: number[] = []
    const migrations: Record<number, Migration> = {
      1: (document) => {
        steps.push(1)
        return { ...document, addedInTwo: true }
      },
      2: (document) => {
        steps.push(2)
        return { ...document, addedInThree: true }
      },
    }

    const result = migrateDocument(v1(), { migrations, target: 3 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(steps).toEqual([1, 2])
    expect(result.steps).toBe(2)
    expect(result.document.addedInTwo).toBe(true)
    expect(result.document.addedInThree).toBe(true)
    expect(result.document.version).toBe(3)
    // The original document survives the walk unchanged.
    expect(result.document.blocks).toEqual(toDocument(sampleSlice()).blocks)
  })

  it('owns the version counter, whatever a migration claims', () => {
    const migrations: Record<number, Migration> = {
      // A step that forgets to bump the version, which would otherwise loop.
      1: (document) => ({ ...document }),
    }
    const result = migrateDocument(v1(), { migrations, target: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.document.version).toBe(2)
  })

  it('stops cleanly when a step of the chain is missing', () => {
    const result = migrateDocument(v1(), { migrations: {}, target: 2 })
    expect(result).toEqual({ ok: false, reason: 'no-migration', version: 1 })
  })

  it('stops cleanly when a migration throws', () => {
    const migrations: Record<number, Migration> = {
      1: () => {
        throw new Error('bad migration')
      },
    }
    expect(migrateDocument(v1(), { migrations, target: 2 })).toEqual({
      ok: false,
      reason: 'migration-failed',
      version: 1,
    })
  })

  it('stops cleanly when a migration returns something that is not a document', () => {
    const migrations = { 1: () => null as unknown as Record<string, unknown> }
    expect(migrateDocument(v1(), { migrations, target: 2 }).ok).toBe(false)
  })

  it('ships with an empty chain, because there is only one version', () => {
    // Not a tautology: it asserts that nobody has added a migration without
    // also raising DOCUMENT_VERSION, which would leave it unreachable.
    const result = migrateDocument(v1())
    expect(result.ok && result.steps).toBe(0)
  })
})
