import { useMemo } from 'react'
import { create } from 'zustand'
import type { DocumentSlice } from '../persistence/document'
import type { Block, Connection, Group, Point, Tool, Viewport } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { MIN_GROUP_SIZE, pruneGroups } from '../utils/groups'
import { createId } from '../utils/id'

/**
 * A block without its id. An explicit `id` may be supplied so that Phase 4's
 * undo/redo can re-create a removed block under its original identity.
 */
export type BlockInit = Omit<Block, 'id'> & { id?: string }

export type BlockPatch = Partial<Omit<Block, 'id'>>

/** A connection without its id, on the same terms as `BlockInit`. */
export type ConnectionInit = Omit<Connection, 'id'> & { id?: string }

export type ConnectionPatch = Partial<Omit<Connection, 'id'>>

/** A group without its id, on the same terms as `BlockInit`. */
export type GroupInit = Omit<Group, 'id'> & { id?: string }

/**
 * A block together with the slot it occupied in `blockOrder`.
 *
 * Phase 4 needed this and `addBlock`'s explicit id was not enough on its own:
 * re-creating a deleted block put it back in the map correctly but appended it
 * to the end of the paint order, so undoing the delete of a block that sat
 * underneath another silently brought it back on top. Undo has to be exact, so
 * the slot travels with the block.
 */
export interface BlockPlacement {
  block: Block
  index: number
}

/** The connection counterpart of `BlockPlacement`. */
export interface ConnectionPlacement {
  connection: Connection
  index: number
}

/** The group counterpart, and the third user of `spliceInOrder`. */
export interface GroupPlacement {
  group: Group
  index: number
}

/** Everything `removeBlocks` destroyed on the way, for undo to put back. */
export interface RemovedElements {
  /** Connections that had an endpoint among the removed blocks. */
  connections: Connection[]
  /**
   * Groups that lost a member — dissolved *or* merely shrunk — as they were
   * before the removal. Phase 5 widened this return value from a bare
   * `Connection[]`: the cascade is no longer only about arrows, and a caller
   * that got the arrows but not the memberships would restore a diagram whose
   * blocks had quietly forgotten they belonged together.
   */
  groups: Group[]
}

/**
 * Splices ids back into an order list at the slots they came from.
 *
 * Placements are applied in ascending index order, which is what makes the
 * indices mean "position in the finished list" rather than "position at the
 * moment this one is inserted".
 */
function spliceInOrder(
  order: readonly string[],
  placements: readonly { id: string; index: number }[],
): string[] {
  const next = [...order]
  for (const placement of [...placements].sort((a, b) => a.index - b.index)) {
    const at = Math.min(Math.max(placement.index, 0), next.length)
    next.splice(at, 0, placement.id)
  }
  return next
}

/**
 * Whether two connections are the same link drawn twice.
 *
 * Anchors are part of the identity: deliberately routing a second arrow out of
 * a different side of the same block is a legitimate thing to draw, so only an
 * exact repeat is a duplicate.
 */
function sameConnection(a: Connection, b: ConnectionInit): boolean {
  return (
    a.sourceId === b.sourceId &&
    a.targetId === b.targetId &&
    a.sourceAnchor === b.sourceAnchor &&
    a.targetAnchor === b.targetAnchor
  )
}

export interface DiagramState {
  /**
   * Blocks live in an id -> block map with a separate z-order list.
   *
   * Chosen over a plain array because from Phase 2 on the hot path is "patch
   * one block by id" on every pointer move, and Phase 3 resolves connection
   * endpoints by id — both O(1) here, O(n) with an array. The order list keeps
   * paint order explicit instead of leaning on object key ordering.
   */
  blocks: Record<string, Block>
  blockOrder: string[]
  /** Connections, in the same map + order-list shape as blocks. */
  connections: Record<string, Connection>
  connectionOrder: string[]
  /**
   * Groups, in the same map + order-list shape again.
   *
   * There is deliberately no `selectedGroupIds` beside the two selection lists
   * below. Selecting a group *is* selecting its member blocks — clicking a
   * member widens the selection to the whole group — so a group's selection
   * state is derivable, and `utils/groups.ts` derives it. Storing it as well
   * would give move, delete, marquee and the bounding box a second source of
   * truth to disagree with.
   */
  groups: Record<string, Group>
  groupOrder: string[]
  viewport: Viewport
  selectedIds: string[]
  /**
   * Selected connections, kept apart from `selectedIds`.
   *
   * Move, resize, marquee and the bounding box all mean "blocks", and a single
   * tagged list would have every one of them filtering by kind on every frame.
   * Two lists keep those paths untouched and make a mixed selection — some
   * blocks and some arrows, deleted together — fall out for free.
   */
  selectedConnectionIds: string[]
  /**
   * Active tool. UI state rather than document state: Phase 4's undo history
   * will record the block/viewport mutations below, not this.
   */
  tool: Tool
  /** Whether gestures round their result onto the grid. UI state, like `tool`. */
  snapToGrid: boolean

  addBlock: (init: BlockInit) => Block
  /**
   * Swaps the whole document out, as a restore from storage does.
   *
   * The only action that replaces state wholesale rather than transforming it,
   * and the only one that is not undoable — see `session.ts`. The selection
   * goes with it because the ids it named belonged to the document being
   * replaced; keeping them would leave the overlay outlining blocks that no
   * longer exist.
   */
  replaceDocument: (contents: DocumentSlice) => void
  insertBlocks: (placements: readonly BlockPlacement[]) => void
  insertConnections: (placements: readonly ConnectionPlacement[]) => void
  insertGroups: (placements: readonly GroupPlacement[]) => void
  updateBlock: (id: string, patch: BlockPatch) => void
  updateBlocks: (patches: Record<string, BlockPatch>) => void
  updateConnection: (id: string, patch: ConnectionPatch) => void
  updateConnections: (patches: Record<string, ConnectionPatch>) => void
  setBlockPositions: (positions: Record<string, Point>) => void
  removeBlock: (id: string) => RemovedElements
  removeBlocks: (ids: readonly string[]) => RemovedElements
  addConnection: (init: ConnectionInit) => Connection | null
  removeConnection: (id: string) => void
  removeConnections: (ids: readonly string[]) => void
  addGroup: (init: GroupInit) => Group | null
  removeGroups: (ids: readonly string[]) => void
  setViewport: (viewport: Viewport) => void
  select: (ids: string | readonly string[]) => void
  addToSelection: (ids: string | readonly string[]) => void
  toggleSelection: (id: string) => void
  selectConnections: (ids: string | readonly string[]) => void
  toggleConnectionSelection: (id: string) => void
  setSelection: (blockIds: readonly string[], connectionIds: readonly string[]) => void
  selectAll: () => void
  clearSelection: () => void
  setTool: (tool: Tool) => void
  setSnapToGrid: (snapToGrid: boolean) => void
  toggleSnapToGrid: () => void
  resetView: () => void
}

const toIdList = (ids: string | readonly string[]): string[] =>
  typeof ids === 'string' ? [ids] : [...ids]

/**
 * Every diagram mutation is a named action here — no inline `set()` in
 * components. Phase 4 wraps these in reversible Commands, which only works if
 * the mutation surface stays this narrow.
 */
export const useDiagramStore = create<DiagramState>()((set, get) => ({
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
  snapToGrid: true,

  addBlock: (init) => {
    const block: Block = { ...init, id: init.id ?? createId() }
    set((state) => ({
      blocks: { ...state.blocks, [block.id]: block },
      blockOrder: state.blockOrder.includes(block.id)
        ? state.blockOrder
        : [...state.blockOrder, block.id],
    }))
    return block
  },

  replaceDocument: (contents) =>
    set({
      blocks: contents.blocks,
      blockOrder: [...contents.blockOrder],
      connections: contents.connections,
      connectionOrder: [...contents.connectionOrder],
      groups: contents.groups,
      groupOrder: [...contents.groupOrder],
      selectedIds: [],
      selectedConnectionIds: [],
    }),

  /**
   * Puts blocks back exactly where they were, paint order included.
   *
   * A restore primitive, not a creation one: it is what undoing a delete calls,
   * so unlike `addBlock` it takes whole `Block` objects and their old slots.
   * Ids already present are skipped, which makes a replayed `apply` a no-op
   * rather than a duplicate — history commands are required to be idempotent.
   */
  insertBlocks: (placements) =>
    set((state) => {
      const pending = placements.filter(({ block }) => !(block.id in state.blocks))
      if (pending.length === 0) return state

      const blocks = { ...state.blocks }
      for (const { block } of pending) blocks[block.id] = block

      return {
        blocks,
        blockOrder: spliceInOrder(
          state.blockOrder,
          pending.map(({ block, index }) => ({ id: block.id, index })),
        ),
      }
    }),

  /**
   * The connection counterpart of `insertBlocks`.
   *
   * Deliberately skips the validation `addConnection` does: this restores a
   * link that the diagram already accepted once, and re-running the duplicate
   * check against the connection's own former self would refuse it.
   */
  insertConnections: (placements) =>
    set((state) => {
      const pending = placements.filter(
        ({ connection }) => !(connection.id in state.connections),
      )
      if (pending.length === 0) return state

      const connections = { ...state.connections }
      for (const { connection } of pending) connections[connection.id] = connection

      return {
        connections,
        connectionOrder: spliceInOrder(
          state.connectionOrder,
          pending.map(({ connection, index }) => ({ id: connection.id, index })),
        ),
      }
    }),

  /**
   * Restores groups, overwriting membership rather than skipping ids it
   * already holds.
   *
   * The one restore primitive that is *absolute* instead of insert-if-missing,
   * and it has to be. Deleting one member of a three-block group leaves the
   * group alive with two, so undo has a group to put a member back into, not a
   * group to re-create. An insert-if-missing here would silently do nothing in
   * exactly that case. Absolute is still idempotent, which is all the history
   * actually requires.
   */
  insertGroups: (placements) =>
    set((state) => {
      if (placements.length === 0) return state

      const groups = { ...state.groups }
      for (const { group } of placements) {
        groups[group.id] = { ...group, blockIds: [...group.blockIds] }
      }

      const missing = placements.filter(({ group }) => !(group.id in state.groups))
      return {
        groups,
        groupOrder: spliceInOrder(
          state.groupOrder,
          missing.map(({ group, index }) => ({ id: group.id, index })),
        ),
      }
    }),

  updateBlock: (id, patch) =>
    set((state) => {
      const current = state.blocks[id]
      if (!current) return state
      return { blocks: { ...state.blocks, [id]: { ...current, ...patch } } }
    }),

  /**
   * Patches many blocks in one state update. A drag touching N blocks would
   * otherwise fire N `updateBlock` calls per pointer frame, and every one of
   * them re-renders every subscriber.
   */
  updateBlocks: (patches) =>
    set((state) => {
      const blocks = { ...state.blocks }
      let changed = false

      for (const [id, patch] of Object.entries(patches)) {
        const current = blocks[id]
        if (!current) continue
        blocks[id] = { ...current, ...patch }
        changed = true
      }

      return changed ? { blocks } : state
    }),

  updateConnection: (id, patch) => {
    get().updateConnections({ [id]: patch })
  },

  /**
   * `updateBlocks` for arrows.
   *
   * Added in Phase 5 because styling a mixed selection has to patch both kinds
   * in one command, and until now nothing had ever edited a connection after
   * creating it — anchors were set once and geometry was never stored at all.
   */
  updateConnections: (patches) =>
    set((state) => {
      const connections = { ...state.connections }
      let changed = false

      for (const [id, patch] of Object.entries(patches)) {
        const current = connections[id]
        if (!current) continue
        connections[id] = { ...current, ...patch }
        changed = true
      }

      return changed ? { connections } : state
    }),

  /**
   * Absolute positions rather than deltas, on purpose.
   *
   * A drag applies `snapshot + accumulated delta` every frame, so absolute
   * coordinates are what the caller already holds; they are idempotent, so a
   * repeated or replayed frame cannot drift; and Phase 4 inverts the whole
   * gesture by replaying the snapshot through this very action, with no
   * separate inverse operation to get wrong.
   */
  setBlockPositions: (positions) => {
    get().updateBlocks(positions)
  },

  removeBlock: (id) => get().removeBlocks([id]),

  /**
   * Removes blocks and, in cascade, every connection touching one of them —
   * returning those connections in full.
   *
   * Returning them (rather than exposing them as state, or leaving the caller
   * to work them out) is a Phase 4 requirement. Undoing a delete has to put
   * the arrows back too, and it cannot recompute which ones they were: by the
   * time undo runs they are gone from the store. A return value keeps that
   * knowledge with the single `set` that destroyed them, so the command can
   * capture it without a second read that might race a concurrent action.
   * They come back as whole `Connection` objects rather than ids because undo
   * must restore each one's anchors and style verbatim. Phase 5 extended the
   * same reasoning to groups: removing a member prunes it out of its group and
   * dissolves a group left below `MIN_GROUP_SIZE`, and neither fact can be
   * recomputed once the blocks are gone.
   */
  removeBlocks: (ids) => {
    const doomed = new Set(ids)
    const state = get()
    if (![...doomed].some((id) => id in state.blocks))
      return { connections: [], groups: [] }

    const orphaned = state.connectionOrder
      .map((id) => state.connections[id])
      .filter(
        (connection): connection is Connection =>
          connection !== undefined &&
          (doomed.has(connection.sourceId) || doomed.has(connection.targetId)),
      )
    const orphanedIds = new Set(orphaned.map((connection) => connection.id))
    const pruned = pruneGroups(state, doomed)

    set((current) => {
      const blocks: Record<string, Block> = {}
      for (const id of current.blockOrder) {
        if (doomed.has(id)) continue
        const block = current.blocks[id]
        if (block) blocks[id] = block
      }

      const connections: Record<string, Connection> = {}
      for (const id of current.connectionOrder) {
        if (orphanedIds.has(id)) continue
        const connection = current.connections[id]
        if (connection) connections[id] = connection
      }

      return {
        blocks,
        blockOrder: current.blockOrder.filter((id) => !doomed.has(id)),
        connections,
        connectionOrder: current.connectionOrder.filter((id) => !orphanedIds.has(id)),
        groups: pruned.groups,
        groupOrder: pruned.groupOrder,
        selectedIds: current.selectedIds.filter((id) => !doomed.has(id)),
        selectedConnectionIds: current.selectedConnectionIds.filter(
          (id) => !orphanedIds.has(id),
        ),
      }
    })

    return { connections: orphaned, groups: pruned.affected }
  },

  /**
   * Adds a connection, or returns `null` if the diagram refuses it.
   *
   * Two things are refused: a block wired to itself, which has no sensible
   * orthogonal route and reads as a slip of the pointer; and an exact repeat
   * of an existing link, which would only ever paint a second arrow on top of
   * the first. Both endpoints must also exist — a connection to a missing
   * block could never be drawn.
   */
  addConnection: (init) => {
    const state = get()
    if (init.sourceId === init.targetId) return null
    if (!(init.sourceId in state.blocks) || !(init.targetId in state.blocks)) return null

    const duplicate = state.connectionOrder.some((id) => {
      const existing = state.connections[id]
      return existing !== undefined && sameConnection(existing, init)
    })
    if (duplicate) return null

    const connection: Connection = { ...init, id: init.id ?? createId() }
    set((current) => ({
      connections: { ...current.connections, [connection.id]: connection },
      connectionOrder: current.connectionOrder.includes(connection.id)
        ? current.connectionOrder
        : [...current.connectionOrder, connection.id],
    }))
    return connection
  },

  removeConnection: (id) => {
    get().removeConnections([id])
  },

  /** Removes connections only; the blocks they joined are left alone. */
  removeConnections: (ids) =>
    set((state) => {
      const doomed = new Set(ids)
      if (![...doomed].some((id) => id in state.connections)) return state

      const connections: Record<string, Connection> = {}
      for (const id of state.connectionOrder) {
        if (doomed.has(id)) continue
        const connection = state.connections[id]
        if (connection) connections[id] = connection
      }

      return {
        connections,
        connectionOrder: state.connectionOrder.filter((id) => !doomed.has(id)),
        selectedConnectionIds: state.selectedConnectionIds.filter(
          (id) => !doomed.has(id),
        ),
      }
    }),

  /**
   * Groups blocks, or returns `null` if the diagram refuses.
   *
   * Refused when fewer than `MIN_GROUP_SIZE` of the ids name a live block — a
   * group of one is indistinguishable from the block itself.
   *
   * Members already in another group are *absorbed*: they leave the old group,
   * which dissolves if that drops it below the minimum. This is the flat
   * alternative to nesting. Rejecting the attempt outright was the other
   * option, but it makes a perfectly ordinary action ("group these two things,
   * one of which happens to be a pair") fail for a reason the user cannot see,
   * and clicking a member already selects its whole group, so the situation
   * arises constantly rather than rarely.
   */
  addGroup: (init) => {
    const state = get()
    const seen = new Set<string>()
    const blockIds = init.blockIds.filter((id) => {
      if (!(id in state.blocks) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (blockIds.length < MIN_GROUP_SIZE) return null

    const group: Group = { id: init.id ?? createId(), blockIds }
    // Absorb first, so the old memberships are gone before the new one lands
    // and no block is ever briefly in two groups at once.
    const absorbed = pruneGroups(state, new Set(blockIds))

    set({
      groups: { ...absorbed.groups, [group.id]: group },
      groupOrder: absorbed.groupOrder.includes(group.id)
        ? absorbed.groupOrder
        : [...absorbed.groupOrder, group.id],
    })
    return group
  },

  /**
   * Dissolves groups. The blocks themselves are untouched — ungrouping is not
   * a delete, and this is also how undoing a "group" runs backwards.
   */
  removeGroups: (ids) =>
    set((state) => {
      const doomed = new Set(ids)
      if (![...doomed].some((id) => id in state.groups)) return state

      const groups: Record<string, Group> = {}
      for (const id of state.groupOrder) {
        if (doomed.has(id)) continue
        const group = state.groups[id]
        if (group) groups[id] = group
      }

      return {
        groups,
        groupOrder: state.groupOrder.filter((id) => !doomed.has(id)),
      }
    }),

  setViewport: (viewport) => set({ viewport }),

  /**
   * Replaces the selection with these blocks. A replace means the whole
   * selection, so any selected connections go too — otherwise clicking a block
   * would silently leave an arrow highlighted and Delete would eat it.
   */
  select: (ids) => set({ selectedIds: toIdList(ids), selectedConnectionIds: [] }),

  /** Adds ids to the selection, skipping the ones already in it. */
  addToSelection: (ids) =>
    set((state) => {
      const missing = toIdList(ids).filter((id) => !state.selectedIds.includes(id))
      return missing.length ? { selectedIds: [...state.selectedIds, ...missing] } : state
    }),

  /** Flips one id in or out of the selection — shift-click's whole job. */
  toggleSelection: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((selected) => selected !== id)
        : [...state.selectedIds, id],
    })),

  /** The connection counterpart of `select`, and just as exclusive. */
  selectConnections: (ids) =>
    set({ selectedConnectionIds: toIdList(ids), selectedIds: [] }),

  /** Shift-click on an arrow; leaves any selected blocks in place. */
  toggleConnectionSelection: (id) =>
    set((state) => ({
      selectedConnectionIds: state.selectedConnectionIds.includes(id)
        ? state.selectedConnectionIds.filter((selected) => selected !== id)
        : [...state.selectedConnectionIds, id],
    })),

  /**
   * Sets both selection lists at once.
   *
   * Every other selection action is exclusive — `select` clears the arrows,
   * `selectConnections` clears the blocks — which is right for pointer input
   * but cannot express "these blocks *and* these arrows". Undo needs exactly
   * that: restoring the selection a command was created with has to reinstate
   * a mixed selection verbatim, so this is the one action that writes both.
   */
  setSelection: (blockIds, connectionIds) =>
    set({ selectedIds: [...blockIds], selectedConnectionIds: [...connectionIds] }),

  /**
   * Selects every block — but no connections.
   *
   * Deliberate: the selection drives move, resize and the bounding box, all of
   * which mean blocks, and highlighting every arrow as well would suggest they
   * were about to move too. Nothing is lost on delete, because removing all
   * the blocks cascades all the arrows anyway.
   */
  selectAll: () =>
    set((state) => ({
      // blockOrder is already every live id, in paint order.
      selectedIds: [...state.blockOrder],
      selectedConnectionIds: [],
    })),

  clearSelection: () =>
    set((state) =>
      state.selectedIds.length || state.selectedConnectionIds.length
        ? { selectedIds: [], selectedConnectionIds: [] }
        : state,
    ),

  setTool: (tool) => set({ tool }),

  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),

  toggleSnapToGrid: () => set((state) => ({ snapToGrid: !state.snapToGrid })),

  resetView: () => set({ viewport: DEFAULT_VIEWPORT }),
}))

/**
 * Blocks in paint order. Memoised because the mapping allocates a new array,
 * which would defeat the store's reference equality check if used inline as a
 * selector.
 */
export function useBlockList(): Block[] {
  const blocks = useDiagramStore((state) => state.blocks)
  const blockOrder = useDiagramStore((state) => state.blockOrder)

  return useMemo(
    () =>
      blockOrder
        .map((id) => blocks[id])
        .filter((block): block is Block => block !== undefined),
    [blocks, blockOrder],
  )
}

/** Connections in paint order. Memoised for the same reason as `useBlockList`. */
export function useConnectionList(): Connection[] {
  const connections = useDiagramStore((state) => state.connections)
  const connectionOrder = useDiagramStore((state) => state.connectionOrder)

  return useMemo(
    () =>
      connectionOrder
        .map((id) => connections[id])
        .filter((connection): connection is Connection => connection !== undefined),
    [connections, connectionOrder],
  )
}
