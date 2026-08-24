import { useMemo } from 'react'
import { create } from 'zustand'
import type { Block, Connection, Point, Tool, Viewport } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { createId } from '../utils/id'

/**
 * A block without its id. An explicit `id` may be supplied so that Phase 4's
 * undo/redo can re-create a removed block under its original identity.
 */
export type BlockInit = Omit<Block, 'id'> & { id?: string }

export type BlockPatch = Partial<Omit<Block, 'id'>>

/** A connection without its id, on the same terms as `BlockInit`. */
export type ConnectionInit = Omit<Connection, 'id'> & { id?: string }

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
  updateBlock: (id: string, patch: BlockPatch) => void
  updateBlocks: (patches: Record<string, BlockPatch>) => void
  setBlockPositions: (positions: Record<string, Point>) => void
  removeBlock: (id: string) => Connection[]
  removeBlocks: (ids: readonly string[]) => Connection[]
  addConnection: (init: ConnectionInit) => Connection | null
  removeConnection: (id: string) => void
  removeConnections: (ids: readonly string[]) => void
  setViewport: (viewport: Viewport) => void
  select: (ids: string | readonly string[]) => void
  addToSelection: (ids: string | readonly string[]) => void
  toggleSelection: (id: string) => void
  selectConnections: (ids: string | readonly string[]) => void
  toggleConnectionSelection: (id: string) => void
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
   * must restore each one's anchors and style verbatim.
   */
  removeBlocks: (ids) => {
    const doomed = new Set(ids)
    const state = get()
    if (![...doomed].some((id) => id in state.blocks)) return []

    const orphaned = state.connectionOrder
      .map((id) => state.connections[id])
      .filter(
        (connection): connection is Connection =>
          connection !== undefined &&
          (doomed.has(connection.sourceId) || doomed.has(connection.targetId)),
      )
    const orphanedIds = new Set(orphaned.map((connection) => connection.id))

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
        selectedIds: current.selectedIds.filter((id) => !doomed.has(id)),
        selectedConnectionIds: current.selectedConnectionIds.filter(
          (id) => !orphanedIds.has(id),
        ),
      }
    })

    return orphaned
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
