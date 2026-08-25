import { describe, expect, it } from 'vitest'
import type { Group } from '../types'
import {
  MIN_GROUP_SIZE,
  expandToGroups,
  groupOf,
  pruneGroups,
  selectedGroups,
  type GroupSource,
} from './groups'

const source = (...groups: Group[]): GroupSource => ({
  groups: Object.fromEntries(groups.map((group) => [group.id, group])),
  groupOrder: groups.map((group) => group.id),
})

const g = (id: string, ...blockIds: string[]): Group => ({ id, blockIds })

describe('groupOf', () => {
  it('finds the group a block belongs to', () => {
    expect(groupOf(source(g('g1', 'a', 'b')), 'b')?.id).toBe('g1')
  })

  it('returns null for an ungrouped block', () => {
    expect(groupOf(source(g('g1', 'a', 'b')), 'c')).toBeNull()
  })
})

describe('expandToGroups', () => {
  it('widens one member to the whole group', () => {
    expect(expandToGroups(source(g('g1', 'a', 'b', 'c')), ['b'])).toEqual(['a', 'b', 'c'])
  })

  it('leaves an ungrouped block alone', () => {
    expect(expandToGroups(source(g('g1', 'a', 'b')), ['z'])).toEqual(['z'])
  })

  it('never repeats a block that two ids pull in', () => {
    expect(expandToGroups(source(g('g1', 'a', 'b')), ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('widens across several groups at once', () => {
    const state = source(g('g1', 'a', 'b'), g('g2', 'c', 'd'))
    expect(expandToGroups(state, ['a', 'c'])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps the caller order, appending each group where it was pulled in', () => {
    const state = source(g('g1', 'a', 'b'))
    expect(expandToGroups(state, ['z', 'b'])).toEqual(['z', 'a', 'b'])
  })

  it('is a no-op on an empty selection', () => {
    expect(expandToGroups(source(g('g1', 'a', 'b')), [])).toEqual([])
  })
})

describe('selectedGroups', () => {
  it('reports a group all of whose members are selected', () => {
    const state = source(g('g1', 'a', 'b'))
    expect(selectedGroups(state, ['a', 'b']).map((group) => group.id)).toEqual(['g1'])
  })

  it('does not report a partly selected group', () => {
    // "Entered" a group: one member selected, so the group itself is not.
    expect(selectedGroups(source(g('g1', 'a', 'b')), ['a'])).toEqual([])
  })

  it('reports a group even when other blocks are also selected', () => {
    const state = source(g('g1', 'a', 'b'))
    expect(selectedGroups(state, ['a', 'b', 'z']).map((group) => group.id)).toEqual([
      'g1',
    ])
  })

  it('reports several groups at once, in group order', () => {
    const state = source(g('g1', 'a', 'b'), g('g2', 'c', 'd'))
    expect(selectedGroups(state, ['c', 'd', 'a', 'b']).map((group) => group.id)).toEqual([
      'g1',
      'g2',
    ])
  })
})

describe('pruneGroups', () => {
  it('leaves an untouched group exactly as it was', () => {
    const state = source(g('g1', 'a', 'b'))
    const pruned = pruneGroups(state, new Set(['z']))

    expect(pruned.groupOrder).toEqual(['g1'])
    expect(pruned.groups.g1?.blockIds).toEqual(['a', 'b'])
    expect(pruned.affected).toEqual([])
  })

  it('shrinks a group that keeps at least two members', () => {
    const state = source(g('g1', 'a', 'b', 'c'))
    const pruned = pruneGroups(state, new Set(['a']))

    expect(pruned.groups.g1?.blockIds).toEqual(['b', 'c'])
  })

  it('reports a shrunk group as it was, not as it became', () => {
    // This is what undo replays. Reporting the shrunken membership would make
    // undoing a delete restore the block but not its place in the group.
    const state = source(g('g1', 'a', 'b', 'c'))
    const pruned = pruneGroups(state, new Set(['a']))

    expect(pruned.affected).toEqual([g('g1', 'a', 'b', 'c')])
  })

  it('dissolves a group left with one member', () => {
    const state = source(g('g1', 'a', 'b'))
    const pruned = pruneGroups(state, new Set(['a']))

    expect(pruned.groupOrder).toEqual([])
    expect(pruned.groups).toEqual({})
    expect(pruned.affected).toEqual([g('g1', 'a', 'b')])
  })

  it('dissolves a group whose members all go', () => {
    const pruned = pruneGroups(source(g('g1', 'a', 'b')), new Set(['a', 'b']))
    expect(pruned.groupOrder).toEqual([])
  })

  it('never returns a group smaller than the minimum', () => {
    const state = source(g('g1', 'a', 'b', 'c'), g('g2', 'd', 'e'))
    const pruned = pruneGroups(state, new Set(['a', 'd']))

    for (const id of pruned.groupOrder) {
      expect(pruned.groups[id]?.blockIds.length).toBeGreaterThanOrEqual(MIN_GROUP_SIZE)
    }
    expect(pruned.groupOrder).toEqual(['g1'])
  })

  it('copies the member list rather than sharing the original', () => {
    const group = g('g1', 'a', 'b')
    const pruned = pruneGroups(source(group), new Set(['a']))

    pruned.affected[0]?.blockIds.push('mutated')
    expect(group.blockIds).toEqual(['a', 'b'])
  })
})
