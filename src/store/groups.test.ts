import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { MIN_GROUP_SIZE, groupOf } from '../utils/groups'
import { useDiagramStore } from './diagramStore'

/*
 * The group actions, against the real store.
 *
 * State behaviour is asserted against the store, never the DOM — Phase 3 had a
 * test pass with the delete cascade switched off because a DOM assertion was
 * masked by a defensive guard in the canvas.
 */

const store = () => useDiagramStore.getState()

const seedBlock = (id: string, x = 0) =>
  store().addBlock({ id, type: 'rect', x, y: 0, width: 100, height: 60, text: id })

const seedBlocks = (...ids: string[]) => {
  ids.forEach((id, index) => seedBlock(id, index * 200))
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
    snapToGrid: false,
  })
})

describe('addGroup', () => {
  it('creates a group over live blocks', () => {
    seedBlocks('a', 'b')
    const group = store().addGroup({ blockIds: ['a', 'b'] })

    expect(group).not.toBeNull()
    expect(store().groupOrder).toEqual([group?.id])
    expect(store().groups[group?.id ?? '']?.blockIds).toEqual(['a', 'b'])
  })

  it('refuses a group of one', () => {
    seedBlocks('a')
    expect(store().addGroup({ blockIds: ['a'] })).toBeNull()
    expect(store().groupOrder).toEqual([])
  })

  it('refuses when only one id names a real block', () => {
    seedBlocks('a')
    expect(store().addGroup({ blockIds: ['a', 'ghost'] })).toBeNull()
  })

  it('drops a repeated id rather than counting it twice', () => {
    // Two ids, one block: still a group of one, and still refused.
    seedBlocks('a')
    expect(store().addGroup({ blockIds: ['a', 'a'] })).toBeNull()
  })

  it('honours an explicit id, so undo can re-create the same group', () => {
    seedBlocks('a', 'b')
    expect(store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })?.id).toBe('g1')
  })

  it('keeps a block in at most one group', () => {
    seedBlocks('a', 'b', 'c', 'd')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    store().addGroup({ id: 'g2', blockIds: ['b', 'c', 'd'] })

    expect(groupOf(store(), 'b')?.id).toBe('g2')
    // g1 lost b, which left it with one member, so it dissolved.
    expect(store().groupOrder).toEqual(['g2'])
  })

  it('absorbs a whole group rather than nesting it', () => {
    seedBlocks('a', 'b', 'c')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    const merged = store().addGroup({ id: 'g2', blockIds: ['a', 'b', 'c'] })

    expect(store().groupOrder).toEqual(['g2'])
    expect(merged?.blockIds).toEqual(['a', 'b', 'c'])
  })

  it('shrinks a partly absorbed group that still has two members left', () => {
    seedBlocks('a', 'b', 'c', 'd', 'e')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b', 'c'] })
    store().addGroup({ id: 'g2', blockIds: ['c', 'd', 'e'] })

    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
    expect(store().groups.g2?.blockIds).toEqual(['c', 'd', 'e'])
  })

  it('never leaves a group below the minimum size', () => {
    seedBlocks('a', 'b', 'c', 'd')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    store().addGroup({ id: 'g2', blockIds: ['b', 'c'] })

    for (const id of store().groupOrder) {
      expect(store().groups[id]?.blockIds.length).toBeGreaterThanOrEqual(MIN_GROUP_SIZE)
    }
  })
})

describe('removeGroups', () => {
  it('dissolves the group and leaves the blocks alone', () => {
    seedBlocks('a', 'b')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    store().removeGroups(['g1'])

    expect(store().groupOrder).toEqual([])
    expect(store().blockOrder).toEqual(['a', 'b'])
  })

  it('ignores ids it does not hold', () => {
    seedBlocks('a', 'b')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    store().removeGroups(['ghost'])

    expect(store().groupOrder).toEqual(['g1'])
  })
})

describe('insertGroups', () => {
  it('splices a missing group back into its slot', () => {
    seedBlocks('a', 'b', 'c', 'd')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    store().addGroup({ id: 'g2', blockIds: ['c', 'd'] })
    store().removeGroups(['g1'])

    store().insertGroups([{ group: { id: 'g1', blockIds: ['a', 'b'] }, index: 0 }])
    expect(store().groupOrder).toEqual(['g1', 'g2'])
  })

  it('overwrites the membership of a group that still exists', () => {
    // The case an insert-if-missing primitive would silently skip: undoing the
    // delete of one member of a three-block group.
    seedBlocks('a', 'b', 'c')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b', 'c'] })
    store().removeBlocks(['a'])
    expect(store().groups.g1?.blockIds).toEqual(['b', 'c'])

    store().insertBlocks([
      {
        block: { id: 'a', type: 'rect', x: 0, y: 0, width: 100, height: 60, text: 'a' },
        index: 0,
      },
    ])
    store().insertGroups([{ group: { id: 'g1', blockIds: ['a', 'b', 'c'] }, index: 0 }])

    expect(store().groups.g1?.blockIds).toEqual(['a', 'b', 'c'])
    expect(store().groupOrder).toEqual(['g1'])
  })

  it('is idempotent', () => {
    seedBlocks('a', 'b')
    const placement = { group: { id: 'g1', blockIds: ['a', 'b'] }, index: 0 }

    store().insertGroups([placement])
    store().insertGroups([placement])

    expect(store().groupOrder).toEqual(['g1'])
  })

  it('copies the member list it was handed', () => {
    seedBlocks('a', 'b')
    const group = { id: 'g1', blockIds: ['a', 'b'] }
    store().insertGroups([{ group, index: 0 }])

    group.blockIds.push('mutated')
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
  })
})

describe('removeBlocks and group membership', () => {
  it('prunes a removed block out of its group', () => {
    seedBlocks('a', 'b', 'c')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b', 'c'] })
    store().removeBlocks(['a'])

    expect(store().groups.g1?.blockIds).toEqual(['b', 'c'])
  })

  it('dissolves a group left with one member', () => {
    seedBlocks('a', 'b')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })
    store().removeBlocks(['a'])

    expect(store().groupOrder).toEqual([])
    expect(store().blockOrder).toEqual(['b'])
  })

  it('returns the disturbed groups as they were', () => {
    // Same contract as the connection cascade: undo cannot recompute this
    // afterwards, because by then the membership is gone.
    seedBlocks('a', 'b', 'c')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b', 'c'] })

    expect(store().removeBlocks(['a']).groups).toEqual([
      { id: 'g1', blockIds: ['a', 'b', 'c'] },
    ])
  })

  it('reports a dissolved group too, not only a shrunk one', () => {
    seedBlocks('a', 'b')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    expect(store().removeBlocks(['a', 'b']).groups).toEqual([
      { id: 'g1', blockIds: ['a', 'b'] },
    ])
  })

  it('reports nothing when no group was touched', () => {
    seedBlocks('a', 'b', 'z')
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    expect(store().removeBlocks(['z']).groups).toEqual([])
  })

  it('returns both cascades side by side', () => {
    seedBlocks('a', 'b')
    store().addConnection({ id: 'ab', sourceId: 'a', targetId: 'b' })
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    const removed = store().removeBlocks(['a'])
    expect(removed.connections.map((entry) => entry.id)).toEqual(['ab'])
    expect(removed.groups.map((entry) => entry.id)).toEqual(['g1'])
  })
})

describe('updateConnections', () => {
  it('patches many connections at once', () => {
    seedBlocks('a', 'b', 'c')
    store().addConnection({ id: 'ab', sourceId: 'a', targetId: 'b' })
    store().addConnection({ id: 'bc', sourceId: 'b', targetId: 'c' })

    store().updateConnections({
      ab: { style: { stroke: '#ff0000' } },
      bc: { style: { stroke: '#00ff00' } },
    })

    expect(store().connections.ab?.style?.stroke).toBe('#ff0000')
    expect(store().connections.bc?.style?.stroke).toBe('#00ff00')
  })

  it('ignores ids that are not connections', () => {
    seedBlocks('a', 'b')
    store().addConnection({ id: 'ab', sourceId: 'a', targetId: 'b' })
    store().updateConnections({ ghost: { style: { stroke: '#ff0000' } } })

    expect(store().connectionOrder).toEqual(['ab'])
    expect(store().connections.ghost).toBeUndefined()
  })

  it('clears a style back to nothing', () => {
    seedBlocks('a', 'b')
    store().addConnection({ id: 'ab', sourceId: 'a', targetId: 'b' })
    store().updateConnection('ab', { style: { stroke: '#ff0000' } })
    store().updateConnection('ab', { style: undefined })

    expect(store().connections.ab?.style).toBeUndefined()
  })
})
