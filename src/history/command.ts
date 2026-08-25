import type { Block, Connection, Group } from '../types'

/**
 * Undo/redo, form (A): every command carries the data it needs to apply and
 * to revert itself, and does both by calling named store actions.
 *
 * The alternative considered was (B), snapshotting the whole document slice
 * before and after each edit and swapping the two back. (A) won on three
 * counts, all of which are consequences of decisions taken in Phases 2 and 3:
 *
 *  - `setBlockPositions` is absolute and idempotent, so a move's "inverse" is
 *    just replaying the earlier snapshot through the same action. There is no
 *    separate inverse operation that could disagree with the forward one.
 *  - `removeBlocks` returns the connections it cascaded away, so a delete can
 *    capture precisely the rows it destroyed instead of diffing two documents
 *    to work out what changed.
 *  - A command that names what it touched can label itself honestly ("Move 3
 *    blocks"), and can merge with its neighbour — which is what makes a held
 *    arrow key one history entry. Two opaque snapshots can do neither.
 *
 * (B)'s advantage is that it cannot get an inverse wrong, but it pays for that
 * by copying the whole document per edit and by losing every bit of intent. On
 * a diagram of any size that is the wrong trade, and the paste command below
 * shows why intent matters: pasting is *not* "the document, but bigger" — it
 * is a specific set of new ids that undo must remove and redo must reinstate
 * unchanged.
 *
 * The two forms are never mixed. Every command here is form (A).
 */

/**
 * The selection at a moment in time, both kinds of it.
 *
 * Selection changes are deliberately *not* commands of their own: clicking
 * around would otherwise flood the history with entries that change nothing a
 * user would call an edit, and undo would spend most of its presses walking
 * back through clicks. But every command does carry the selection from either
 * side of itself, and undo/redo restore it. Undoing a delete that did not also
 * re-select the restored blocks would put them back somewhere off screen with
 * no visual anchor at all.
 */
export interface SelectionSnapshot {
  blockIds: readonly string[]
  connectionIds: readonly string[]
}

export const EMPTY_SELECTION: SelectionSnapshot = { blockIds: [], connectionIds: [] }

/**
 * One reversible edit.
 *
 * `apply` and `revert` must both be idempotent: applying twice then reverting
 * twice has to land on the state you started from. That is not a theoretical
 * nicety — a gesture applies its result live and *then* records the command,
 * so the first `apply` a command ever sees is a replay of work already done.
 */
export interface Command {
  /** Shown in the toolbar's tooltip and asserted in tests. */
  readonly label: string
  /** The selection to restore when this command is undone. */
  readonly selectionBefore: SelectionSnapshot
  /** The selection to restore when it is redone. */
  readonly selectionAfter: SelectionSnapshot
  apply: () => void
  revert: () => void
  /**
   * Folds `next` into this command, or returns `null` to decline.
   *
   * The command owns the whole decision — including how long it stays open to
   * merging — so the history stack does not have to know that nudges coalesce
   * and drags do not. `now` is passed in rather than read from `Date.now()`
   * here so tests can drive the clock.
   */
  mergeWith?: (next: Command, now: number) => Command | null
}

/**
 * `"block"` for one, `"3 blocks"` for several.
 *
 * The singular drops the count on purpose: "Undo: Move 1 block" reads like a
 * machine talking, "Undo: Move block" reads like a label.
 */
export function describeCount(count: number, noun: string): string {
  return count === 1 ? noun : `${count} ${noun}s`
}

/** `"2 blocks and 1 connection"`, skipping whichever half is empty. */
export function describeElements(blockCount: number, connectionCount: number): string {
  const parts: string[] = []
  if (blockCount > 0) parts.push(describeCount(blockCount, 'block'))
  if (connectionCount > 0) parts.push(describeCount(connectionCount, 'connection'))
  return parts.join(' and ') || 'nothing'
}

/**
 * Copies a block deeply enough that the command owns every field it holds.
 *
 * A command must never point at an object that still lives in the store: the
 * store replaces block objects wholesale on every patch, so a captured
 * reference either goes stale or — worse, if some later code mutates in place
 * — silently rewrites the history's idea of the past. `style` is copied a
 * level deeper for the same reason: Phase 5's panel patches it in place of the
 * whole block, so a shared style object would be the exact leak this guards.
 */
export function cloneBlock(block: Block): Block {
  return { ...block, ...(block.style ? { style: { ...block.style } } : {}) }
}

/** `cloneBlock` for connections, and for the same reason. */
export function cloneConnection(connection: Connection): Connection {
  return {
    ...connection,
    ...(connection.style ? { style: { ...connection.style } } : {}),
  }
}

/**
 * `cloneBlock` for groups. The member list is copied, not shared — a command
 * that held the store's own array would watch its record of the past change
 * every time a delete pruned a member out of it.
 */
export function cloneGroup(group: Group): Group {
  return { ...group, blockIds: [...group.blockIds] }
}
