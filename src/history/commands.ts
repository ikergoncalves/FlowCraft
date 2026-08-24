import {
  useDiagramStore,
  type BlockPatch,
  type BlockPlacement,
  type ConnectionPlacement,
  type DiagramState,
} from '../store/diagramStore'
import type { Point } from '../types'
import {
  cloneBlock,
  cloneConnection,
  type Command,
  type SelectionSnapshot,
} from './command'

/**
 * How long a mergeable command stays open to absorbing its successor.
 *
 * Long enough that a held arrow key — which repeats every ~30ms once the
 * initial delay passes — never falls out of the window, short enough that two
 * deliberate presses a second apart stay two separate entries. The window is
 * measured from the *last* merge rather than the first, so a run of nudges
 * keeps extending it and collapses into one entry however long it goes on.
 */
export const MERGE_WINDOW_MS = 500

/** A set of blocks and connections, each with the slot it occupied. */
export interface ElementPlacements {
  blocks: BlockPlacement[]
  connections: ConnectionPlacement[]
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

  return { blocks, connections }
}

function insertElements(placements: ElementPlacements): void {
  const store = useDiagramStore.getState()
  // Blocks first: an arrow whose endpoints are missing would render as
  // nothing, and for one frame that is exactly what it would be.
  store.insertBlocks(placements.blocks)
  store.insertConnections(placements.connections)
}

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

export interface MoveCommandSpec {
  label: string
  /** Where the blocks were, keyed by id. Absolute world coordinates. */
  before: Record<string, Point>
  /** Where they ended up. */
  after: Record<string, Point>
  selectionBefore: SelectionSnapshot
  selectionAfter: SelectionSnapshot
  /**
   * Commands sharing a merge key, arriving inside `MERGE_WINDOW_MS`, collapse
   * into one entry. `null` — the default — never merges, which is what a drag
   * wants: two drags are two edits however fast they follow each other.
   */
  mergeKey?: string | null
  mergeWindowMs?: number
  /** Injectable clock, so the merge window is testable without waiting. */
  now?: number
}

interface MoveCommand extends Command {
  readonly kind: 'move'
  readonly mergeKey: string | null
  readonly after: Record<string, Point>
}

function isMoveCommand(command: Command): command is MoveCommand {
  return (command as { kind?: unknown }).kind === 'move'
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
  const mergeKey = spec.mergeKey ?? null
  const window = spec.mergeWindowMs ?? MERGE_WINDOW_MS
  const openUntil = (spec.now ?? Date.now()) + window

  const command: MoveCommand = {
    kind: 'move',
    label: spec.label,
    mergeKey,
    after,
    selectionBefore: spec.selectionBefore,
    selectionAfter: spec.selectionAfter,
    apply: () => {
      useDiagramStore.getState().setBlockPositions(after)
    },
    revert: () => {
      useDiagramStore.getState().setBlockPositions(before)
    },
    mergeWith: (next, now) => {
      if (mergeKey === null) return null
      if (!isMoveCommand(next) || next.mergeKey !== mergeKey) return null
      if (now > openUntil) return null

      // The merged entry keeps *this* command's starting point and the new
      // one's destination, so one undo walks the whole run back at once.
      return createMoveCommand({
        ...spec,
        before,
        after: next.after,
        selectionAfter: next.selectionAfter,
        mergeKey,
        mergeWindowMs: window,
        now,
      })
    },
  }

  return command
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
