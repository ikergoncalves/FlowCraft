import { beforeEach, describe, expect, it } from 'vitest'
import { useDiagramStore } from '../store/diagramStore'
import type { Block, Connection } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { describeCount, describeElements, EMPTY_SELECTION, type Command } from './command'
import {
  MERGE_WINDOW_MS,
  capturePlacements,
  cascadeConnectionIds,
  cascadeGroupIds,
  createAddCommand,
  createMoveCommand,
  createPatchCommand,
  createRegroupCommand,
  createRemoveCommand,
  createStyleCommand,
} from './commands'

/*
 * Each command type, against the real store.
 *
 * Every case here asserts against store state rather than anything rendered.
 * Phase 3 had a test pass with the delete cascade switched off because a DOM
 * assertion was masked by a defensive guard in the canvas; state behaviour is
 * checked where the state lives.
 */

const store = () => useDiagramStore.getState()

const seedBlock = (id: string, x = 0, y = 0): Block =>
  store().addBlock({ id, type: 'rect', x, y, width: 100, height: 60, text: id })

const seedConnection = (id: string, sourceId: string, targetId: string): Connection => {
  const created = store().addConnection({ id, sourceId, targetId, sourceAnchor: 'e' })
  if (!created) throw new Error(`store refused connection ${id}`)
  return created
}

/** Everything an undo has to reproduce exactly. */
const documentState = () => {
  const state = store()
  return {
    blocks: state.blocks,
    blockOrder: state.blockOrder,
    connections: state.connections,
    connectionOrder: state.connectionOrder,
  }
}

const noSelection = { selectionBefore: EMPTY_SELECTION, selectionAfter: EMPTY_SELECTION }

/**
 * The contract every command signs: applying twice and reverting twice lands
 * on the state you started from.
 *
 * It is not a theoretical property. A gesture updates the store live and only
 * records afterwards, so the first `apply` a command ever sees is already a
 * replay of work that has happened.
 */
function expectIdempotent(command: Command): void {
  const initial = structuredClone(documentState())
  command.apply()
  const applied = structuredClone(documentState())

  command.apply()
  expect(documentState()).toEqual(applied)

  command.revert()
  command.revert()
  expect(documentState()).toEqual(initial)
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

describe('describeCount', () => {
  it('drops the count in the singular', () => {
    expect(describeCount(1, 'block')).toBe('block')
  })

  it('pluralises for anything else', () => {
    expect(describeCount(3, 'block')).toBe('3 blocks')
    expect(describeCount(0, 'block')).toBe('0 blocks')
    expect(describeCount(2, 'connection')).toBe('2 connections')
  })
})

describe('describeElements', () => {
  it('names only the half that has anything in it', () => {
    expect(describeElements(1, 0)).toBe('block')
    expect(describeElements(0, 4)).toBe('4 connections')
  })

  it('joins the two halves', () => {
    expect(describeElements(2, 1)).toBe('2 blocks and connection')
  })

  it('says so when there is nothing', () => {
    expect(describeElements(0, 0)).toBe('nothing')
  })
})

describe('cascadeConnectionIds', () => {
  it('finds every connection touching a doomed block', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('c', 600)
    seedConnection('ab', 'a', 'b')
    seedConnection('bc', 'b', 'c')

    expect(cascadeConnectionIds(store(), ['b'], [])).toEqual(['ab', 'bc'])
    expect(cascadeConnectionIds(store(), ['a'], [])).toEqual(['ab'])
    expect(cascadeConnectionIds(store(), ['c'], [])).toEqual(['bc'])
  })

  it('includes explicitly named connections and never repeats one', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedConnection('ab', 'a', 'b')

    expect(cascadeConnectionIds(store(), ['a'], ['ab'])).toEqual(['ab'])
  })
})

describe('capturePlacements', () => {
  it('records the slot each element occupied', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('c', 600)

    const placements = capturePlacements(store(), ['a', 'c'], [])
    expect(
      placements.blocks.map(({ block, index }) => [block.id, index]),
      // 'c' keeps index 2 even though 'b' is not in the capture: the index is
      // the slot in `blockOrder`, which is what undo has to splice back into.
    ).toEqual([
      ['a', 0],
      ['c', 2],
    ])
  })

  it('holds copies rather than the store objects themselves', () => {
    seedBlock('a')
    const captured = capturePlacements(store(), ['a'], []).blocks[0]?.block
    expect(captured).not.toBe(store().blocks.a)

    // The store swaps block objects out on every patch; a captured reference
    // would go stale the moment anything moved.
    store().updateBlock('a', { x: 999 })
    expect(captured?.x).toBe(0)
  })
})

describe('createAddCommand', () => {
  it('inserts blocks and connections, and takes them away again', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const command = createAddCommand({
      label: 'Paste 2 blocks',
      placements: {
        blocks: [
          {
            block: {
              id: 'x',
              type: 'rect',
              x: 20,
              y: 20,
              width: 10,
              height: 10,
              text: 'x',
            },
            index: 2,
          },
          {
            block: {
              id: 'y',
              type: 'rect',
              x: 40,
              y: 40,
              width: 10,
              height: 10,
              text: 'y',
            },
            index: 3,
          },
        ],
        connections: [
          { connection: { id: 'xy', sourceId: 'x', targetId: 'y' }, index: 0 },
        ],
        groups: [],
      },
      ...noSelection,
    })

    command.apply()
    expect(store().blockOrder).toEqual(['a', 'b', 'x', 'y'])
    expect(store().connectionOrder).toEqual(['xy'])

    command.revert()
    expect(store().blockOrder).toEqual(['a', 'b'])
    expect(store().connectionOrder).toEqual([])
  })

  it('is idempotent under replay', () => {
    seedBlock('a')
    expectIdempotent(
      createAddCommand({
        label: 'Add block',
        placements: {
          blocks: [
            {
              block: {
                id: 'x',
                type: 'rect',
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                text: '',
              },
              index: 1,
            },
          ],
          connections: [],
          groups: [],
        },
        ...noSelection,
      }),
    )
  })
})

describe('createRemoveCommand', () => {
  it('restores a deleted block into the slot it came from', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('c', 600)

    const command = createRemoveCommand({
      label: 'Delete block',
      placements: capturePlacements(store(), ['b'], []),
      ...noSelection,
    })

    command.apply()
    expect(store().blockOrder).toEqual(['a', 'c'])

    command.revert()
    // Back in the middle, not appended at the end: paint order is part of the
    // state undo has to reproduce.
    expect(store().blockOrder).toEqual(['a', 'b', 'c'])
  })

  it('restores the cascaded connections with their anchors intact', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const created = store().addConnection({
      id: 'ab',
      sourceId: 'a',
      targetId: 'b',
      sourceAnchor: 's',
      targetAnchor: 'n',
    })
    expect(created).not.toBeNull()

    const cascade = cascadeConnectionIds(store(), ['a'], [])
    const command = createRemoveCommand({
      label: 'Delete block',
      placements: capturePlacements(store(), ['a'], cascade),
      ...noSelection,
    })

    command.apply()
    expect(store().connections.ab).toBeUndefined()

    command.revert()
    expect(store().connections.ab).toEqual({
      id: 'ab',
      sourceId: 'a',
      targetId: 'b',
      sourceAnchor: 's',
      targetAnchor: 'n',
    })
  })

  it('is idempotent under replay', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedConnection('ab', 'a', 'b')

    expectIdempotent(
      createRemoveCommand({
        label: 'Delete block and connection',
        placements: capturePlacements(
          store(),
          ['a'],
          cascadeConnectionIds(store(), ['a']),
        ),
        ...noSelection,
      }),
    )
  })
})

describe('createMoveCommand', () => {
  it('puts the blocks back exactly where they were', () => {
    seedBlock('a', 10, 10)
    seedBlock('b', 100, 100)

    const command = createMoveCommand({
      label: 'Move 2 blocks',
      before: { a: { x: 10, y: 10 }, b: { x: 100, y: 100 } },
      after: { a: { x: 50, y: 70 }, b: { x: 140, y: 160 } },
      ...noSelection,
    })

    command.apply()
    expect(store().blocks.a).toMatchObject({ x: 50, y: 70 })
    expect(store().blocks.b).toMatchObject({ x: 140, y: 160 })

    command.revert()
    expect(store().blocks.a).toMatchObject({ x: 10, y: 10 })
    expect(store().blocks.b).toMatchObject({ x: 100, y: 100 })
  })

  it('leaves everything but position alone', () => {
    seedBlock('a', 10, 10)
    store().updateBlock('a', { text: 'renamed', width: 42 })

    const command = createMoveCommand({
      label: 'Move block',
      before: { a: { x: 10, y: 10 } },
      after: { a: { x: 0, y: 0 } },
      ...noSelection,
    })
    command.apply()
    command.revert()

    expect(store().blocks.a).toMatchObject({ text: 'renamed', width: 42 })
  })

  it('is idempotent under replay', () => {
    seedBlock('a', 10, 10)
    expectIdempotent(
      createMoveCommand({
        label: 'Move block',
        before: { a: { x: 10, y: 10 } },
        after: { a: { x: 300, y: 300 } },
        ...noSelection,
      }),
    )
  })

  it('copies the position maps it was handed', () => {
    seedBlock('a', 10, 10)
    const after = { a: { x: 50, y: 50 } }
    const command = createMoveCommand({
      label: 'Move block',
      before: { a: { x: 10, y: 10 } },
      after,
      ...noSelection,
    })

    // A command must own its data: mutating the caller's object afterwards
    // must not rewrite what the history will replay.
    after.a.x = 9999
    command.apply()
    expect(store().blocks.a?.x).toBe(50)
  })
})

describe('nudge merging', () => {
  const nudge = (from: number, to: number, now: number, key = 'nudge:a') =>
    createMoveCommand({
      label: 'Move block',
      before: { a: { x: from, y: 0 } },
      after: { a: { x: to, y: 0 } },
      mergeKey: key,
      now,
      ...noSelection,
    })

  it('folds a second nudge into the first', () => {
    seedBlock('a', 0, 0)
    const first = nudge(0, 1, 1000)
    const merged = first.mergeWith?.(nudge(1, 2, 1100), 1100)

    expect(merged).not.toBeNull()
    merged?.apply()
    expect(store().blocks.a?.x).toBe(2)
    merged?.revert()
    // The merged entry spans the whole run: one undo, all the way back.
    expect(store().blocks.a?.x).toBe(0)
  })

  it('declines once the window has passed', () => {
    const first = nudge(0, 1, 1000)
    const late = 1000 + MERGE_WINDOW_MS + 1
    expect(first.mergeWith?.(nudge(1, 2, late), late)).toBeNull()
  })

  it('accepts a nudge on the very edge of the window', () => {
    const first = nudge(0, 1, 1000)
    const edge = 1000 + MERGE_WINDOW_MS
    expect(first.mergeWith?.(nudge(1, 2, edge), edge)).not.toBeNull()
  })

  it('declines a nudge of a different selection', () => {
    const first = nudge(0, 1, 1000)
    expect(first.mergeWith?.(nudge(1, 2, 1100, 'nudge:b'), 1100)).toBeNull()
  })

  it('declines a command that is not a move at all', () => {
    const first = nudge(0, 1, 1000)
    const other = createPatchCommand({
      label: 'Resize block',
      id: 'a',
      before: { width: 1 },
      after: { width: 2 },
      ...noSelection,
    })
    expect(first.mergeWith?.(other, 1100)).toBeNull()
  })

  it('never merges a drag, which carries no merge key', () => {
    const drag = createMoveCommand({
      label: 'Move block',
      before: { a: { x: 0, y: 0 } },
      after: { a: { x: 10, y: 0 } },
      now: 1000,
      ...noSelection,
    })
    expect(drag.mergeWith?.(nudge(10, 11, 1010), 1010)).toBeNull()
  })

  it('keeps extending the window as the run continues', () => {
    seedBlock('a', 0, 0)
    // Each press lands late in the previous one's window; the run still
    // collapses to a single entry because merging restarts the clock.
    let command = nudge(0, 1, 0)
    for (let i = 1; i <= 10; i += 1) {
      const at = i * (MERGE_WINDOW_MS - 50)
      const merged = command.mergeWith?.(nudge(i, i + 1, at), at)
      expect(merged).not.toBeNull()
      if (merged) command = merged
    }

    command.apply()
    expect(store().blocks.a?.x).toBe(11)
    command.revert()
    expect(store().blocks.a?.x).toBe(0)
  })
})

describe('createPatchCommand', () => {
  it('restores the exact box a resize started from', () => {
    seedBlock('a', 10, 10)
    const before = { x: 10, y: 10, width: 100, height: 60 }
    const after = { x: 10, y: 10, width: 250, height: 130 }

    const command = createPatchCommand({
      label: 'Resize block',
      id: 'a',
      before,
      after,
      ...noSelection,
    })

    command.apply()
    expect(store().blocks.a).toMatchObject(after)
    command.revert()
    expect(store().blocks.a).toMatchObject(before)
  })

  it('restores the previous text', () => {
    seedBlock('a')
    const command = createPatchCommand({
      label: 'Edit text',
      id: 'a',
      before: { text: 'a' },
      after: { text: 'Renamed' },
      ...noSelection,
    })

    command.apply()
    expect(store().blocks.a?.text).toBe('Renamed')
    command.revert()
    expect(store().blocks.a?.text).toBe('a')
  })

  it('is idempotent under replay', () => {
    seedBlock('a', 10, 10)
    expectIdempotent(
      createPatchCommand({
        label: 'Resize block',
        id: 'a',
        before: { width: 100, height: 60 },
        after: { width: 300, height: 200 },
        ...noSelection,
      }),
    )
  })

  it('does nothing at all when the block is gone', () => {
    const command = createPatchCommand({
      label: 'Edit text',
      id: 'ghost',
      before: { text: 'a' },
      after: { text: 'b' },
      ...noSelection,
    })
    expect(() => {
      command.apply()
      command.revert()
    }).not.toThrow()
    expect(store().blockOrder).toEqual([])
  })
})

describe('cascadeGroupIds', () => {
  const seedGroup = (id: string, ...blockIds: string[]) =>
    store().addGroup({ id, blockIds })

  it('finds a group a doomed block belongs to', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedGroup('g1', 'a', 'b')

    expect(cascadeGroupIds(store(), ['a'])).toEqual(['g1'])
  })

  it('reports a group that will merely shrink, not only one that dissolves', () => {
    // Undoing a delete has to restore membership as well as blocks.
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('c', 600)
    seedGroup('g1', 'a', 'b', 'c')

    expect(cascadeGroupIds(store(), ['a'])).toEqual(['g1'])
  })

  it('finds nothing when no group is touched', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('z', 900)
    seedGroup('g1', 'a', 'b')

    expect(cascadeGroupIds(store(), ['z'])).toEqual([])
  })

  it('reports each group once however many of its members go', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedGroup('g1', 'a', 'b')

    expect(cascadeGroupIds(store(), ['a', 'b'])).toEqual(['g1'])
  })
})

describe('createStyleCommand', () => {
  it('applies a style to every named block and takes it back', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const command = createStyleCommand({
      label: 'Set fill',
      target: 'blocks',
      before: { a: undefined, b: undefined },
      after: { a: { fill: '#ff0000' }, b: { fill: '#ff0000' } },
      ...noSelection,
    })

    command.apply()
    expect(store().blocks.a?.style?.fill).toBe('#ff0000')
    expect(store().blocks.b?.style?.fill).toBe('#ff0000')

    command.revert()
    expect(store().blocks.a?.style).toBeUndefined()
    expect(store().blocks.b?.style).toBeUndefined()
  })

  it('restores each block its own former value, not one shared value', () => {
    // The failure this catches: a command that stored "the colour was blue"
    // rather than a per-element map would repaint the whole selection blue.
    seedBlock('a')
    seedBlock('b', 300)
    store().updateBlocks({
      a: { style: { fill: '#111111' } },
      b: { style: { fill: '#222222' } },
    })

    const command = createStyleCommand({
      label: 'Set fill',
      target: 'blocks',
      before: { a: { fill: '#111111' }, b: { fill: '#222222' } },
      after: { a: { fill: '#00ff00' }, b: { fill: '#00ff00' } },
      ...noSelection,
    })

    command.apply()
    command.revert()

    expect(store().blocks.a?.style?.fill).toBe('#111111')
    expect(store().blocks.b?.style?.fill).toBe('#222222')
  })

  it('styles connections when told to', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedConnection('ab', 'a', 'b')

    const command = createStyleCommand({
      label: 'Set line colour',
      target: 'connections',
      before: { ab: undefined },
      after: { ab: { stroke: '#ff0000', dashed: true } },
      ...noSelection,
    })

    command.apply()
    expect(store().connections.ab?.style).toEqual({ stroke: '#ff0000', dashed: true })
    command.revert()
    expect(store().connections.ab?.style).toBeUndefined()
  })

  it('is idempotent under replay', () => {
    seedBlock('a')
    expectIdempotent(
      createStyleCommand({
        label: 'Set fill',
        target: 'blocks',
        before: { a: undefined },
        after: { a: { fill: '#ff0000' } },
        ...noSelection,
      }),
    )
  })

  it('copies the style maps it was handed', () => {
    seedBlock('a')
    const after = { a: { fill: '#ff0000' } }
    const command = createStyleCommand({
      label: 'Set fill',
      target: 'blocks',
      before: { a: undefined },
      after,
      ...noSelection,
    })

    after.a.fill = '#00ff00'
    command.apply()
    expect(store().blocks.a?.style?.fill).toBe('#ff0000')
  })

  it('never hands the store an object the command still holds', () => {
    seedBlock('a')
    const command = createStyleCommand({
      label: 'Set fill',
      target: 'blocks',
      before: { a: undefined },
      after: { a: { fill: '#ff0000' } },
      ...noSelection,
    })

    command.apply()
    // Mutating what landed in the store must not rewrite the history's copy.
    const stored = store().blocks.a?.style
    if (stored) stored.fill = '#00ff00'
    command.apply()
    expect(store().blocks.a?.style?.fill).toBe('#ff0000')
  })
})

describe('style merging', () => {
  const styleEdit = (from: string, to: string, now: number, key = 'style:fill:a') =>
    createStyleCommand({
      label: 'Set fill',
      target: 'blocks',
      before: { a: { fill: from } },
      after: { a: { fill: to } },
      mergeKey: key,
      now,
      ...noSelection,
    })

  it('folds a sweep of the colour picker into one entry', () => {
    seedBlock('a')
    let command: Command = styleEdit('#000000', '#010101', 0)
    for (let i = 1; i <= 20; i += 1) {
      const at = i * 10
      const merged = command.mergeWith?.(styleEdit('#010101', `#00000${i % 10}`, at), at)
      expect(merged).not.toBeNull()
      if (merged) command = merged
    }

    command.revert()
    // One undo walks the whole sweep back to where it started.
    expect(store().blocks.a?.style?.fill).toBe('#000000')
  })

  it('declines once the window has passed', () => {
    const first = styleEdit('#000000', '#111111', 1000)
    const late = 1000 + MERGE_WINDOW_MS + 1
    expect(first.mergeWith?.(styleEdit('#111111', '#222222', late), late)).toBeNull()
  })

  it('declines a different field, so fill then stroke stays two entries', () => {
    const first = styleEdit('#000000', '#111111', 1000)
    const other = styleEdit('#000000', '#111111', 1100, 'style:stroke:a')
    expect(first.mergeWith?.(other, 1100)).toBeNull()
  })

  it('declines a move, however fast it follows', () => {
    const first = styleEdit('#000000', '#111111', 1000)
    const move = createMoveCommand({
      label: 'Move block',
      before: { a: { x: 0, y: 0 } },
      after: { a: { x: 1, y: 0 } },
      mergeKey: 'style:fill:a',
      now: 1010,
      ...noSelection,
    })
    expect(first.mergeWith?.(move, 1010)).toBeNull()
  })
})

describe('createRegroupCommand', () => {
  const placement = (id: string, ...blockIds: string[]) => ({
    group: { id, blockIds },
    index: 0,
  })

  it('groups on apply and ungroups on revert', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const command = createRegroupCommand({
      label: 'Group 2 blocks',
      before: [],
      after: [placement('g1', 'a', 'b')],
      ...noSelection,
    })

    command.apply()
    expect(store().groupOrder).toEqual(['g1'])
    command.revert()
    expect(store().groupOrder).toEqual([])
  })

  it('runs the other way round for an ungroup', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const command = createRegroupCommand({
      label: 'Ungroup group',
      before: [placement('g1', 'a', 'b')],
      after: [],
      ...noSelection,
    })

    command.apply()
    expect(store().groupOrder).toEqual([])
    command.revert()
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
  })

  it('absorbs one group into another and puts both back', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('c', 600)
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    const command = createRegroupCommand({
      label: 'Group 3 blocks',
      before: [placement('g1', 'a', 'b')],
      after: [{ group: { id: 'g2', blockIds: ['a', 'b', 'c'] }, index: 1 }],
      ...noSelection,
    })

    command.apply()
    expect(store().groupOrder).toEqual(['g2'])

    command.revert()
    expect(store().groupOrder).toEqual(['g1'])
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
  })

  it('is idempotent in both directions', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const command = createRegroupCommand({
      label: 'Group 2 blocks',
      before: [],
      after: [placement('g1', 'a', 'b')],
      ...noSelection,
    })

    command.apply()
    command.apply()
    expect(store().groupOrder).toEqual(['g1'])

    command.revert()
    command.revert()
    expect(store().groupOrder).toEqual([])
  })

  it('copies the placements it was handed', () => {
    seedBlock('a')
    seedBlock('b', 300)
    const after = placement('g1', 'a', 'b')
    const command = createRegroupCommand({
      label: 'Group 2 blocks',
      before: [],
      after: [after],
      ...noSelection,
    })

    after.group.blockIds.push('mutated')
    command.apply()
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
  })
})

describe('placements with groups', () => {
  it('captures a group with the slot it occupied', () => {
    seedBlock('a')
    seedBlock('b', 300)
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    expect(capturePlacements(store(), [], [], ['g1']).groups).toEqual([
      { group: { id: 'g1', blockIds: ['a', 'b'] }, index: 0 },
    ])
  })

  it('captures no groups when none are asked for', () => {
    seedBlock('a')
    seedBlock('b', 300)
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    expect(capturePlacements(store(), ['a'], []).groups).toEqual([])
  })

  it('restores a group when a remove command is reverted', () => {
    seedBlock('a')
    seedBlock('b', 300)
    store().addGroup({ id: 'g1', blockIds: ['a', 'b'] })

    const command = createRemoveCommand({
      label: 'Delete 2 blocks',
      placements: capturePlacements(store(), ['a', 'b'], [], ['g1']),
      ...noSelection,
    })

    command.apply()
    expect(store().blockOrder).toEqual([])
    expect(store().groupOrder).toEqual([])

    command.revert()
    expect(store().blockOrder).toEqual(['a', 'b'])
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b'])
  })

  it('restores the membership of a group that only shrank', () => {
    seedBlock('a')
    seedBlock('b', 300)
    seedBlock('c', 600)
    store().addGroup({ id: 'g1', blockIds: ['a', 'b', 'c'] })

    const command = createRemoveCommand({
      label: 'Delete block',
      placements: capturePlacements(store(), ['a'], [], ['g1']),
      ...noSelection,
    })

    command.apply()
    expect(store().groups.g1?.blockIds).toEqual(['b', 'c'])

    command.revert()
    expect(store().groups.g1?.blockIds).toEqual(['a', 'b', 'c'])
  })

  it('dissolves a pasted group again when the paste is undone', () => {
    seedBlock('a')
    const command = createAddCommand({
      label: 'Paste 2 blocks',
      placements: {
        blocks: [
          {
            block: { id: 'x', type: 'rect', x: 0, y: 0, width: 10, height: 10, text: '' },
            index: 1,
          },
          {
            block: {
              id: 'y',
              type: 'rect',
              x: 20,
              y: 0,
              width: 10,
              height: 10,
              text: '',
            },
            index: 2,
          },
        ],
        connections: [],
        groups: [{ group: { id: 'g1', blockIds: ['x', 'y'] }, index: 0 }],
      },
      ...noSelection,
    })

    command.apply()
    expect(store().groupOrder).toEqual(['g1'])

    // Removing every member is what dissolves it — `removeElements` never
    // names a group, deliberately.
    command.revert()
    expect(store().groupOrder).toEqual([])
  })
})
