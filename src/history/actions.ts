import { nextPasteOrdinal, readClipboard, writeClipboard } from '../store/clipboard'
import { useDiagramStore, type BlockInit, type DiagramState } from '../store/diagramStore'
import type {
  AnchorSide,
  Block,
  BlockStyle,
  Connection,
  ConnectionStyle,
  Group,
  Point,
} from '../types'
import { GRID_SIZE } from '../utils/coords'
import { cloneElements, collectElements, type ElementSet } from '../utils/clone'
import type { Rect } from '../utils/geometry'
import { MIN_GROUP_SIZE, selectedGroups } from '../utils/groups'
import { createId } from '../utils/id'
import {
  cloneGroup,
  describeCount,
  describeElements,
  EMPTY_SELECTION,
  type SelectionSnapshot,
} from './command'
import {
  capturePlacements,
  cascadeConnectionIds,
  cascadeGroupIds,
  createAddCommand,
  createMoveCommand,
  createPatchCommand,
  createRegroupCommand,
  createRemoveCommand,
  createStyleCommand,
  type ElementPlacements,
  type StyleMap,
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

/**
 * Deletes the selection — blocks, arrows, the arrow cascade and the group
 * memberships — as one entry.
 *
 * Deleting a group deletes its members, and that needs no special case:
 * selecting any member widens the selection to the whole group, so by the time
 * Delete is pressed the members *are* the selection. What does need care is
 * the third cascade — a group that loses a member either shrinks or dissolves,
 * and `cascadeGroupIds` captures both so undo can put the membership back
 * exactly as it stood.
 */
export function deleteSelection(): void {
  const state = useDiagramStore.getState()
  if (state.selectedIds.length === 0 && state.selectedConnectionIds.length === 0) return

  const connectionIds = cascadeConnectionIds(
    state,
    state.selectedIds,
    state.selectedConnectionIds,
  )
  const groupIds = cascadeGroupIds(state, state.selectedIds)
  const placements = capturePlacements(state, state.selectedIds, connectionIds, groupIds)
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

  const groupBase = state.groupOrder.length

  const placements: ElementPlacements = {
    blocks: clone.blocks.map((block, offset) => ({ block, index: blockBase + offset })),
    connections: clone.connections.map((connection, offset) => ({
      connection,
      index: connectionBase + offset,
    })),
    groups: clone.groups.map((group, offset) => ({ group, index: groupBase + offset })),
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

/* -- Styling -------------------------------------------------------------- */

/**
 * Whether a style patch would actually change anything.
 *
 * A style edit that changes nothing must not reach the history: the panel is a
 * controlled component, so a re-render that echoes the current value back
 * would otherwise leave an entry per render.
 */
function differs(before: StyleMap, after: StyleMap): boolean {
  return Object.keys(after).some(
    (id) => JSON.stringify(before[id] ?? null) !== JSON.stringify(after[id] ?? null),
  )
}

/**
 * Applies a style patch to every selected block as one entry.
 *
 * `field` names the property being edited and does two jobs: it labels the
 * entry, and it keys the merge — so sweeping the fill picker collapses into
 * one entry while fill-then-stroke stays two. `label` is the human wording,
 * because "Set strokeWidth" reads like a variable name.
 */
export function styleBlocks(
  patch: BlockStyle,
  field: keyof BlockStyle,
  label: string,
): void {
  const state = useDiagramStore.getState()
  const ids = state.selectedIds.filter((id) => id in state.blocks)
  if (ids.length === 0) return

  const before: StyleMap = {}
  const after: StyleMap = {}
  for (const id of ids) {
    const block = state.blocks[id]
    if (!block) continue
    before[id] = block.style ? { ...block.style } : undefined
    after[id] = { ...block.style, ...patch }
  }
  if (!differs(before, after)) return

  const selection = captureSelection(state)
  history().run(
    createStyleCommand({
      label: `Set ${label}`,
      target: 'blocks',
      before,
      after,
      selectionBefore: selection,
      selectionAfter: selection,
      mergeKey: `style:blocks:${field}:${[...ids].sort().join(',')}`,
    }),
  )
}

/** `styleBlocks` for the selected connections. */
export function styleConnections(
  patch: ConnectionStyle,
  field: keyof ConnectionStyle,
  label: string,
): void {
  const state = useDiagramStore.getState()
  const ids = state.selectedConnectionIds.filter((id) => id in state.connections)
  if (ids.length === 0) return

  const before: StyleMap = {}
  const after: StyleMap = {}
  for (const id of ids) {
    const connection = state.connections[id]
    if (!connection) continue
    before[id] = connection.style ? { ...connection.style } : undefined
    after[id] = { ...connection.style, ...patch }
  }
  if (!differs(before, after)) return

  const selection = captureSelection(state)
  history().run(
    createStyleCommand({
      label: `Set ${label}`,
      target: 'connections',
      before,
      after,
      selectionBefore: selection,
      selectionAfter: selection,
      mergeKey: `style:connections:${field}:${[...ids].sort().join(',')}`,
    }),
  )
}

/* -- Grouping ------------------------------------------------------------- */

/** Every group with at least one member among `blockIds`, with its slot. */
function groupPlacementsFor(state: DiagramState, blockIds: readonly string[]) {
  return capturePlacements(state, [], [], cascadeGroupIds(state, blockIds)).groups
}

/**
 * Groups the selected blocks and records one entry.
 *
 * Returns the new group, or `null` when the selection is too small to group.
 * A selection spanning an existing group *absorbs* it — see the note on
 * `Group` for why flattening beats nesting — and a group that is only partly
 * absorbed keeps whatever members are left, or dissolves if that is fewer than
 * two. The whole rearrangement is one command, so undo restores the previous
 * arrangement of groups exactly rather than leaving the remains of one behind.
 */
export function groupSelection(): Group | null {
  const state = useDiagramStore.getState()
  const wanted = new Set(state.selectedIds.filter((id) => id in state.blocks))
  if (wanted.size < MIN_GROUP_SIZE) return null

  // Paint order, not click order: a group's member list is the same kind of
  // list as `blockOrder`, and keeping them consistent means a restored group
  // reads the same however its members were selected.
  const blockIds = state.blockOrder.filter((id) => wanted.has(id))
  const group: Group = { id: createId(), blockIds }

  const before = groupPlacementsFor(state, blockIds)
  const survivors = before
    .map(({ group: existing, index }) => ({
      group: {
        ...existing,
        blockIds: existing.blockIds.filter((id) => !wanted.has(id)),
      },
      index,
    }))
    .filter(({ group: shrunk }) => shrunk.blockIds.length >= MIN_GROUP_SIZE)

  const selection = captureSelection(state)
  history().run(
    createRegroupCommand({
      label: `Group ${describeCount(blockIds.length, 'block')}`,
      before,
      after: [...survivors, { group, index: state.groupOrder.length }],
      selectionBefore: selection,
      selectionAfter: { blockIds, connectionIds: [] },
    }),
  )
  return group
}

/**
 * Dissolves every group whose members are all selected, as one entry.
 *
 * "Fully selected" rather than "touched by the selection": a group is selected
 * as a whole or not at all, so this is the exact set the user sees outlined.
 * Returns whether anything was ungrouped.
 */
export function ungroupSelection(): boolean {
  const state = useDiagramStore.getState()
  const doomed = selectedGroups(state, state.selectedIds)
  if (doomed.length === 0) return false

  const ids = new Set(doomed.map((group) => group.id))
  const before = state.groupOrder
    .map((id, index) => ({ id, index }))
    .filter(({ id }) => ids.has(id))
    .map(({ id, index }) => {
      const group = state.groups[id]
      if (!group) throw new Error(`no group ${id}`)
      return { group: cloneGroup(group), index }
    })

  const selection = captureSelection(state)
  history().run(
    createRegroupCommand({
      label: `Ungroup ${describeCount(before.length, 'group')}`,
      before,
      after: [],
      selectionBefore: selection,
      selectionAfter: selection,
    }),
  )
  return true
}
