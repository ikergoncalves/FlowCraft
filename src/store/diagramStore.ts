import { useMemo } from 'react'
import { create } from 'zustand'
import type { Block, Tool, Viewport } from '../types'
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
  removeBlock: (id: string) => void
  removeBlocks: (ids: readonly string[]) => void
  setViewport: (viewport: Viewport) => void
  select: (ids: string | readonly string[]) => void
  clearSelection: () => void
  setTool: (tool: Tool) => void
  resetView: () => void
}

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

  select: (ids) => set({ selectedIds: typeof ids === 'string' ? [ids] : [...ids] }),

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
