import { useMemo } from 'react'
import { create } from 'zustand'
import type { Block, Point, Tool, Viewport } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { createId } from '../utils/id'

/**
 * A block without its id. An explicit `id` may be supplied so that Phase 4's
 * undo/redo can re-create a removed block under its original identity.
 */
export type BlockInit = Omit<Block, 'id'> & { id?: string }

export type BlockPatch = Partial<Omit<Block, 'id'>>

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
  viewport: Viewport
  selectedIds: string[]
  /**
   * Active tool. UI state rather than document state: Phase 4's undo history
   * will record the block/viewport mutations below, not this.
   */
  tool: Tool

  addBlock: (init: BlockInit) => Block
  updateBlock: (id: string, patch: BlockPatch) => void
  updateBlocks: (patches: Record<string, BlockPatch>) => void
  setBlockPositions: (positions: Record<string, Point>) => void
  removeBlock: (id: string) => void
  removeBlocks: (ids: readonly string[]) => void
  setViewport: (viewport: Viewport) => void
  select: (ids: string | readonly string[]) => void
  addToSelection: (ids: string | readonly string[]) => void
  toggleSelection: (id: string) => void
  selectAll: () => void
  clearSelection: () => void
  setTool: (tool: Tool) => void
  resetView: () => void
}

const toIdList = (ids: string | readonly string[]): string[] =>
  typeof ids === 'string' ? [ids] : [...ids]

/**
 * Every diagram mutation is a named action here — no inline `set()` in
 * components. Phase 4 wraps these in reversible Commands, which only works if
 * the mutation surface stays this narrow.
 */
export const useDiagramStore = create<DiagramState>()((set) => ({
  blocks: {},
  blockOrder: [],
  viewport: DEFAULT_VIEWPORT,
  selectedIds: [],
  tool: 'select',

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
    useDiagramStore.getState().updateBlocks(positions)
  },

  removeBlock: (id) => {
    useDiagramStore.getState().removeBlocks([id])
  },

  removeBlocks: (ids) =>
    set((state) => {
      const doomed = new Set(ids)
      if (![...doomed].some((id) => id in state.blocks)) return state

      const blocks: Record<string, Block> = {}
      for (const id of state.blockOrder) {
        if (doomed.has(id)) continue
        const block = state.blocks[id]
        if (block) blocks[id] = block
      }

      return {
        blocks,
        blockOrder: state.blockOrder.filter((id) => !doomed.has(id)),
        selectedIds: state.selectedIds.filter((id) => !doomed.has(id)),
      }
    }),

  setViewport: (viewport) => set({ viewport }),

  select: (ids) => set({ selectedIds: toIdList(ids) }),

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

  selectAll: () =>
    set((state) => ({
      // blockOrder is already every live id, in paint order.
      selectedIds: [...state.blockOrder],
    })),

  clearSelection: () =>
    set((state) => (state.selectedIds.length ? { selectedIds: [] } : state)),

  setTool: (tool) => set({ tool }),

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
