import { nextPasteOrdinal, readClipboard, writeClipboard } from '../store/clipboard'
import { useDiagramStore, type BlockInit, type DiagramState } from '../store/diagramStore'
import type { AnchorSide, Block, Connection, Point } from '../types'
import { GRID_SIZE } from '../utils/coords'
import { cloneElements, collectElements, type ElementSet } from '../utils/clone'
import type { Rect } from '../utils/geometry'
import {
  describeCount,
  describeElements,
  EMPTY_SELECTION,
  type SelectionSnapshot,
} from './command'
import {
  capturePlacements,
  cascadeConnectionIds,
  createAddCommand,
  createMoveCommand,
  createPatchCommand,
  createRemoveCommand,
  type ElementPlacements,
} from './commands'
import { useHistoryStore } from './historyStore'

/**
 * Every editor operation that belongs in the history, in one place.
 *
 * Components and the shortcut hook call these rather than the store directly,
 * so "which edits are undoable" is answerable by reading one file instead of
 * grepping for store actions. Each function is also plain TypeScript with no
 * React in it, which is what lets the invariant tests drive whole sessions
 * without rendering anything.
 */

/** The selection as it stands, copied out of the store. */
export function captureSelection(state: DiagramState): SelectionSnapshot {
  return {
    blockIds: [...state.selectedIds],
    connectionIds: [...state.selectedConnectionIds],
  }
}

const history = () => useHistoryStore.getState()

/* -- Creation ------------------------------------------------------------- */

/** Adds a block, selects it, and records the pair as one entry. */
export function createBlock(init: BlockInit): Block {
  const store = useDiagramStore.getState()
  const selectionBefore = captureSelection(store)

  const block = store.addBlock(init)
  store.select(block.id)

  history().record(
    createAddCommand({
      label: 'Add block',
      placements: capturePlacements(useDiagramStore.getState(), [block.id], []),
      selectionBefore,
      selectionAfter: { blockIds: [block.id], connectionIds: [] },
    }),
  )
  return block
}

/**
 * Draws a connection, if the diagram accepts one, and records it.
 *
 * Returns whatever `addConnection` decided, so the caller can tell a refused
 * link (self-connection, exact duplicate) from a drawn one. A refusal records
 * nothing: there is no edit to undo.
 */
export function createConnection(
  sourceId: string,
  targetId: string,
  sourceAnchor: AnchorSide,
): Connection | null {
  const store = useDiagramStore.getState()
  const selectionBefore = captureSelection(store)

  const connection = store.addConnection({ sourceId, targetId, sourceAnchor })
  if (!connection) return null

  history().record(
    createAddCommand({
      label: 'Add connection',
      placements: capturePlacements(useDiagramStore.getState(), [], [connection.id]),
      selectionBefore,
      selectionAfter: selectionBefore,
    }),
  )
  return connection
}

/* -- Gesture commits ------------------------------------------------------ */

/**
 * Records a finished drag by comparing the gesture's opening snapshot with
 * where the blocks actually ended up.
 *
 * The store has been updated live all along, for feedback, so this only
 * records — see `HistoryState.record`. A drag that moved nothing (a click, a
 * gesture nudged below the tap threshold) records nothing at all.
 */
export function commitMove(origin: Record<string, Point>): void {
  const state = useDiagramStore.getState()
  const before: Record<string, Point> = {}
  const after: Record<string, Point> = {}
  let moved = false

  for (const [id, start] of Object.entries(origin)) {
    const block = state.blocks[id]
    if (!block) continue
    before[id] = { x: start.x, y: start.y }
    after[id] = { x: block.x, y: block.y }
    if (block.x !== start.x || block.y !== start.y) moved = true
  }

  if (!moved) return
  const selection = captureSelection(state)
  history().record(
    createMoveCommand({
      label: `Move ${describeCount(Object.keys(after).length, 'block')}`,
      before,
      after,
      selectionBefore: selection,
      selectionAfter: selection,
    }),
  )
}

/** The resize counterpart of `commitMove`. A zero-pixel resize records nothing. */
export function commitResize(id: string, before: Rect): void {
  const state = useDiagramStore.getState()
  const block = state.blocks[id]
  if (!block) return

  const after: Rect = {
    x: block.x,
    y: block.y,
    width: block.width,
    height: block.height,
  }
  const unchanged =
    after.x === before.x &&
    after.y === before.y &&
    after.width === before.width &&
    after.height === before.height
  if (unchanged) return

  const selection = captureSelection(state)
  history().record(
    createPatchCommand({
      label: 'Resize block',
      id,
      before: { ...before },
      after,
      selectionBefore: selection,
      selectionAfter: selection,
    }),
  )
}

/**
 * Commits a text edit as a single entry.
 *
 * Unlike the gesture commits this *runs* the command, because the editor's
 * draft never reached the store: the input holds it in local React state and
 * hands over the finished string, which is precisely why a ten-character edit
 * is one undo and not ten.
 */
export function commitBlockText(id: string, text: string): void {
  const state = useDiagramStore.getState()
  const block = state.blocks[id]
  if (!block || block.text === text) return

  const selection = captureSelection(state)
  history().run(
    createPatchCommand({
      label: 'Edit text',
      id,
      before: { text: block.text },
      after: { text },
      selectionBefore: selection,
      selectionAfter: selection,
    }),
  )
}

/* -- Keyboard operations -------------------------------------------------- */

/** Deletes the selection — blocks, arrows, and the cascade — as one entry. */
export function deleteSelection(): void {
  const state = useDiagramStore.getState()
  if (state.selectedIds.length === 0 && state.selectedConnectionIds.length === 0) return

  const connectionIds = cascadeConnectionIds(
    state,
    state.selectedIds,
    state.selectedConnectionIds,
  )
  const placements = capturePlacements(state, state.selectedIds, connectionIds)
  if (placements.blocks.length === 0 && placements.connections.length === 0) return

  history().run(
    createRemoveCommand({
      label: `Delete ${describeElements(
        placements.blocks.length,
        placements.connections.length,
      )}`,
      placements,
      selectionBefore: captureSelection(state),
      selectionAfter: EMPTY_SELECTION,
    }),
  )
}

/**
 * Moves the selection by a fixed amount, merging with the nudges around it.
 *
 * The step is always literal — one world unit for a bare arrow key,
 * `GRID_SIZE` for a shifted one — and never "snap to the next grid line",
 * whatever the Snap toggle says. Two reasons: a nudge that jumps a whole cell
 * because snapping happened to be on is not a nudge, and a nudge that moves a
 * different distance each press depending on where the block already sits is
 * unpredictable to hold down. Snapping stays where it belongs, on the gestures
 * that place things.
 *
 * The merge key covers the selection, not the direction, so right-right-down
 * in quick succession is one entry. Undo is about intent, and that was one
 * intent.
 */
export function nudgeSelection(dx: number, dy: number): void {
  const state = useDiagramStore.getState()
  if (state.selectedIds.length === 0) return

  const before: Record<string, Point> = {}
  const after: Record<string, Point> = {}
  for (const id of state.selectedIds) {
    const block = state.blocks[id]
    if (!block) continue
    before[id] = { x: block.x, y: block.y }
    after[id] = { x: block.x + dx, y: block.y + dy }
  }

  const count = Object.keys(after).length
  if (count === 0) return

  const selection = captureSelection(state)
  history().run(
    createMoveCommand({
      label: `Move ${describeCount(count, 'block')}`,
      before,
      after,
      selectionBefore: selection,
      selectionAfter: selection,
      mergeKey: `nudge:${[...state.selectedIds].sort().join(',')}`,
    }),
  )
}

/**
 * Copies the selected blocks, and any arrow with both ends among them.
 *
 * Returns whether anything was copied, so an empty Ctrl+C can leave the
 * previous clipboard contents alone rather than silently emptying it.
 */
export function copySelection(): boolean {
  const state = useDiagramStore.getState()
  const contents = collectElements(state, state.selectedIds)
  if (contents.blocks.length === 0) return false

  writeClipboard(contents)
  return true
}

/**
 * Inserts a freshly cloned slice, selects it, and records one entry.
 *
 * New elements go on top — at the end of both order lists — which is what
 * pasting on top of an existing diagram should look like.
 */
function insertCopy(clone: ElementSet, verb: string): void {
  const state = useDiagramStore.getState()
  const blockBase = state.blockOrder.length
  const connectionBase = state.connectionOrder.length

  const placements: ElementPlacements = {
    blocks: clone.blocks.map((block, offset) => ({ block, index: blockBase + offset })),
    connections: clone.connections.map((connection, offset) => ({
      connection,
      index: connectionBase + offset,
    })),
  }

  history().run(
    createAddCommand({
      label: `${verb} ${describeElements(clone.blocks.length, clone.connections.length)}`,
      placements,
      selectionBefore: captureSelection(state),
      selectionAfter: {
        blockIds: clone.blocks.map((block) => block.id),
        connectionIds: [],
      },
    }),
  )
}

/**
 * Pastes the clipboard, staggered so successive pastes do not stack.
 *
 * The offset grows with the paste count rather than being fixed, because a
 * fixed one would put the second paste exactly on top of the first — three
 * pastes would look like one block until something was dragged off the pile.
 */
export function pasteClipboard(): void {
  const contents = readClipboard()
  if (!contents || contents.blocks.length === 0) return

  const ordinal = nextPasteOrdinal()
  insertCopy(
    cloneElements(contents, { x: GRID_SIZE * ordinal, y: GRID_SIZE * ordinal }),
    'Paste',
  )
}

/** Copy and paste in one press, without disturbing the clipboard. */
export function duplicateSelection(): void {
  const state = useDiagramStore.getState()
  const contents = collectElements(state, state.selectedIds)
  if (contents.blocks.length === 0) return

  insertCopy(cloneElements(contents, { x: GRID_SIZE, y: GRID_SIZE }), 'Duplicate')
}
