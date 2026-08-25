import {
  useDiagramStore,
  type BlockPatch,
  type BlockPlacement,
  type ConnectionPlacement,
  type DiagramState,
  type GroupPlacement,
} from '../store/diagramStore'
import type { BlockStyle, ConnectionStyle, Point } from '../types'
import {
  cloneBlock,
  cloneConnection,
  cloneGroup,
  type Command,
  type SelectionSnapshot,
} from './command'
import { mergeHandler, openMergePolicy, type Mergeable, type MergeOptions } from './merge'

// Re-exported so the merge window keeps one public home even though the
// policy itself now lives in `merge.ts`.
export { MERGE_WINDOW_MS } from './merge'

/**
 * A set of blocks, connections and groups, each with the slot it occupied.
 *
 * Groups joined in Phase 5 as a third element kind. Nothing about the shape
 * had to change to let them in — `spliceInOrder` and `capturePlacements` were
 * already written against "an id, an index and an order list" rather than
 * against blocks specifically, so the third kind is one more field and one
 * more loop.
 */
export interface ElementPlacements {
  blocks: BlockPlacement[]
  connections: ConnectionPlacement[]
  groups: GroupPlacement[]
}

/**
 * Every connection id that removing `blockIds` would destroy, plus the ones
 * asked for by name.
 *
 * Undo of a delete has to put the cascade back too, and it cannot work out
 * afterwards which arrows those were — by then they are gone. So the cascade
 * is computed up front, from the same live state the removal will run against.
 */
export function cascadeConnectionIds(
  state: DiagramState,
  blockIds: readonly string[],
  connectionIds: readonly string[] = [],
): string[] {
  const doomed = new Set(blockIds)
  const named = new Set(connectionIds)

  return state.connectionOrder.filter((id) => {
    if (named.has(id)) return true
    const connection = state.connections[id]
    if (!connection) return false
    return doomed.has(connection.sourceId) || doomed.has(connection.targetId)
  })
}

/**
 * Every group id that removing `blockIds` would disturb.
 *
 * The connection cascade's exact counterpart, and needed for the same reason:
 * removing a block prunes it out of its group and dissolves the group if that
 * leaves fewer than two members, and undo cannot reconstruct either fact
 * afterwards. A group that merely *shrinks* is included as well as one that
 * dissolves — restoring a group's membership is as much a part of undoing a
 * delete as restoring the group itself.
 */
export function cascadeGroupIds(
  state: DiagramState,
  blockIds: readonly string[],
): string[] {
  const doomed = new Set(blockIds)
  return state.groupOrder.filter((id) => {
    const group = state.groups[id]
    if (!group) return false
    return group.blockIds.some((blockId) => doomed.has(blockId))
  })
}

/**
 * Deep copies of the named elements, with their positions in the order lists.
 *
 * Copies, never the store's own objects: the store swaps block objects out
 * wholesale on every patch, so a captured reference would describe a past that
 * quietly changes underneath the history.
 */
export function capturePlacements(
  state: DiagramState,
  blockIds: readonly string[],
  connectionIds: readonly string[],
  groupIds: readonly string[] = [],
): ElementPlacements {
  const wantedBlocks = new Set(blockIds)
  const blocks: BlockPlacement[] = []
  state.blockOrder.forEach((id, index) => {
    if (!wantedBlocks.has(id)) return
    const block = state.blocks[id]
    if (block) blocks.push({ block: cloneBlock(block), index })
  })

  const wantedConnections = new Set(connectionIds)
  const connections: ConnectionPlacement[] = []
  state.connectionOrder.forEach((id, index) => {
    if (!wantedConnections.has(id)) return
    const connection = state.connections[id]
    if (connection) connections.push({ connection: cloneConnection(connection), index })
  })

  const wantedGroups = new Set(groupIds)
  const groups: GroupPlacement[] = []
  state.groupOrder.forEach((id, index) => {
    if (!wantedGroups.has(id)) return
    const group = state.groups[id]
    if (group) groups.push({ group: cloneGroup(group), index })
  })

  return { blocks, connections, groups }
}

function insertElements(placements: ElementPlacements): void {
  const store = useDiagramStore.getState()
  // Blocks first: an arrow whose endpoints are missing would render as
  // nothing, and for one frame that is exactly what it would be. Groups last,
  // for the stronger reason that a group whose members are missing violates
  // the document's structural invariant outright.
  store.insertBlocks(placements.blocks)
  store.insertConnections(placements.connections)
  store.insertGroups(placements.groups)
}

/**
 * The mirror of `insertElements` — and deliberately silent about groups.
 *
 * `removeBlocks` already prunes departing members out of their group and
 * dissolves a group left with fewer than two, so every group in a placement
 * set is handled by removing the blocks. That is not a happy accident: a set
 * always holds either *all* of a group's members (an undone paste, whose group
 * dissolves) or *some* of them (a delete, whose group must shrink and survive).
 * An explicit `removeGroups` here would get the second case wrong by wiping a
 * group that only lost one member.
 */
function removeElements(placements: ElementPlacements): void {
  const store = useDiagramStore.getState()
  // Connections first, so the cascade in `removeBlocks` has nothing left to
  // do and the two calls stay independent of each other's order.
  store.removeConnections(placements.connections.map(({ connection }) => connection.id))
  store.removeBlocks(placements.blocks.map(({ block }) => block.id))
}

interface ElementCommandSpec {
  label: string
  placements: ElementPlacements
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
}

/**
 * Bringing elements into existence: block creation, paste, duplicate, and the
 * arrow a port drag draws.
 *
 * Idempotent in both directions because `insertBlocks` skips ids it already
 * holds and `removeBlocks` ignores ids it does not.
 */
export function createAddCommand(spec: ElementCommandSpec): Command {
  const { label, placements, selectionBefore, selectionAfter } = spec
  return {
    label,
    selectionBefore,
    selectionAfter,
    apply: () => {
      insertElements(placements)
    },
    revert: () => {
      removeElements(placements)
    },
  }
}

/** The exact mirror of `createAddCommand`: delete, with its cascade. */
export function createRemoveCommand(spec: ElementCommandSpec): Command {
  const { label, placements, selectionBefore, selectionAfter } = spec
  return {
    label,
    selectionBefore,
    selectionAfter,
    apply: () => {
      removeElements(placements)
    },
    revert: () => {
      insertElements(placements)
    },
  }
}

export interface MoveCommandSpec extends MergeOptions {
  label: string
  /** Where the blocks were, keyed by id. Absolute world coordinates. */
  before: Record<string, Point>
  /** Where they ended up. */
  after: Record<string, Point>
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
}

interface MoveCommand extends Mergeable<'move'> {
  readonly after: Record<string, Point>
}

const clonePositions = (positions: Record<string, Point>): Record<string, Point> =>
  Object.fromEntries(
    Object.entries(positions).map(([id, point]) => [id, { x: point.x, y: point.y }]),
  )

/**
 * A move: two absolute position maps, replayed through `setBlockPositions`.
 *
 * There is no delta anywhere. `setBlockPositions` is absolute and idempotent,
 * so "undo the move" is literally "put them back where the snapshot says",
 * and applying it twice cannot drift.
 */
export function createMoveCommand(spec: MoveCommandSpec): Command {
  const before = clonePositions(spec.before)
  const after = clonePositions(spec.after)
  const policy = openMergePolicy('move', spec)

  const command: MoveCommand = {
    kind: policy.kind,
    label: spec.label,
    mergeKey: policy.mergeKey,
    after,
    selectionBefore: spec.selectionBefore,
    selectionAfter: spec.selectionAfter,
    apply: () => {
      useDiagramStore.getState().setBlockPositions(after)
    },
    revert: () => {
      useDiagramStore.getState().setBlockPositions(before)
    },
    // The merged entry keeps *this* command's starting point and the new
    // one's destination, so one undo walks the whole run back at once.
    mergeWith: mergeHandler<'move', MoveCommand>(policy, (next, now) =>
      createMoveCommand({
        ...spec,
        before,
        after: next.after,
        selectionAfter: next.selectionAfter,
        mergeKey: policy.mergeKey,
        mergeWindowMs: policy.windowMs,
        now,
      }),
    ),
  }

  return command
}

/** Whichever style shape the target kind carries. */
export type ElementStyle = BlockStyle | ConnectionStyle

/**
 * A style map: element id to the whole style object it should end up with, or
 * `undefined` for "no style at all", which is how a block goes back to taking
 * its colours from the stylesheet.
 */
export type StyleMap = Record<string, ElementStyle | undefined>

export interface StyleCommandSpec extends MergeOptions {
  label: string
  /** Which map the ids index into. Styling never spans both in one command. */
  target: 'blocks' | 'connections'
  before: StyleMap
  after: StyleMap
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
}

type StyleCommand = Mergeable<'style'> & { readonly after: StyleMap }

const cloneStyleMap = (styles: StyleMap): StyleMap =>
  Object.fromEntries(
    Object.entries(styles).map(([id, style]) => [id, style ? { ...style } : undefined]),
  )

/**
 * A style edit across a selection: two per-element style maps.
 *
 * Per-element on purpose. A command holding one "the colour was blue" value
 * would repaint the whole selection blue on undo, when what the user had was
 * five blocks in five different colours. Both directions are absolute, so this
 * is idempotent for the same reason a move is.
 *
 * Mergeable, because dragging an `<input type="color">` fires `change` on
 * every pointer move: without merging, one colour pick would leave dozens of
 * entries and undo would crawl back through the gradient the user swept.
 */
export function createStyleCommand(spec: StyleCommandSpec): Command {
  const before = cloneStyleMap(spec.before)
  const after = cloneStyleMap(spec.after)
  const policy = openMergePolicy('style', spec)

  const write = (styles: StyleMap): void => {
    const store = useDiagramStore.getState()
    const patches = Object.fromEntries(
      Object.entries(styles).map(([id, style]) => [
        id,
        { style: style ? { ...style } : undefined },
      ]),
    )
    if (spec.target === 'blocks') store.updateBlocks(patches)
    else store.updateConnections(patches)
  }

  const command: StyleCommand = {
    kind: policy.kind,
    label: spec.label,
    mergeKey: policy.mergeKey,
    after,
    selectionBefore: spec.selectionBefore,
    selectionAfter: spec.selectionAfter,
    apply: () => {
      write(after)
    },
    revert: () => {
      write(before)
    },
    mergeWith: mergeHandler<'style', StyleCommand>(policy, (next, now) =>
      createStyleCommand({
        ...spec,
        before,
        after: next.after,
        selectionAfter: next.selectionAfter,
        mergeKey: policy.mergeKey,
        mergeWindowMs: policy.windowMs,
        now,
      }),
    ),
  }

  return command
}

export interface RegroupCommandSpec {
  label: string
  /** The groups that existed before, in full. */
  before: GroupPlacement[]
  /** The groups that should exist after. */
  after: GroupPlacement[]
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
}

/**
 * Grouping, ungrouping, and the absorb that happens when a selection spanning
 * an existing group is grouped again — all three are the same edit.
 *
 * Each direction drops the groups the other side does not have and then writes
 * the ones it does. `insertGroups` is an absolute overwrite rather than an
 * insert-if-missing, which is what lets one factory serve every case: "group"
 * is `before: []`, "ungroup" is `after: []`, and "absorb two groups into one"
 * is both lists non-empty. Idempotent in both directions, because removal
 * ignores ids it does not hold and the write is absolute.
 */
export function createRegroupCommand(spec: RegroupCommandSpec): Command {
  const before = spec.before.map(({ group, index }) => ({
    group: cloneGroup(group),
    index,
  }))
  const after = spec.after.map(({ group, index }) => ({
    group: cloneGroup(group),
    index,
  }))

  const go = (from: GroupPlacement[], to: GroupPlacement[]) => () => {
    const store = useDiagramStore.getState()
    const surviving = new Set(to.map(({ group }) => group.id))
    store.removeGroups(
      from.map(({ group }) => group.id).filter((id) => !surviving.has(id)),
    )
    store.insertGroups(to)
  }

  return {
    label: spec.label,
    selectionBefore: spec.selectionBefore,
    selectionAfter: spec.selectionAfter,
    apply: go(before, after),
    revert: go(after, before),
  }
}

export interface PatchCommandSpec {
  label: string
  id: string
  before: BlockPatch
  after: BlockPatch
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
}

/**
 * One block, two partial states — what resizing and text editing both are.
 *
 * A text edit is one entry rather than one per keystroke because `TextEditor`
 * keeps its draft in local state and only reaches the store on commit, so this
 * command never sees the intermediate values at all.
 */
export function createPatchCommand(spec: PatchCommandSpec): Command {
  const before = { ...spec.before }
  const after = { ...spec.after }
  return {
    label: spec.label,
    selectionBefore: spec.selectionBefore,
    selectionAfter: spec.selectionAfter,
    apply: () => {
      useDiagramStore.getState().updateBlock(spec.id, after)
    },
    revert: () => {
      useDiagramStore.getState().updateBlock(spec.id, before)
    },
  }
}
