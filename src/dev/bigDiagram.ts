import type { DocumentSlice } from '../persistence/document'
import type { Block, Connection } from '../types'
import { DEFAULT_BLOCK_SIZE } from '../utils/blocks'

/**
 * A deterministic diagram of arbitrary size, for measuring instead of guessing.
 *
 * Phase 7 opens with "measure before optimising", and measuring needs a
 * diagram far larger than anything a test can reasonably click into
 * existence — 500 blocks at one click each is a five-minute harness run. So
 * the generator lives here, in the app rather than in a script: the E2E specs
 * and the performance harness both drive it through the debug bridge, and a
 * unit test can check its output without a browser at all.
 *
 * **Deterministic ids on purpose.** `createId` is random, and a measurement
 * you cannot re-run against the same document is a measurement you cannot
 * compare. Ids are positional (`perf-b-0007`), so a probe can name a specific
 * block — "the one at column 3, row 0" — from outside the page.
 *
 * The layout is a grid and the connections join near neighbours, which is what
 * a real flowchart looks like when it gets big: locally dense, globally
 * spread. That shape matters for viewport culling, because a diagram whose
 * arrows all span the full width would have nothing to cull.
 */

/** Gap between block boxes, in world units. */
export const BIG_DIAGRAM_GAP = { x: 100, y: 60 }

export interface BigDiagramOptions {
  /** How many blocks to make. Clamped at zero. */
  blocks: number
  /**
   * How many connections to make. Capped by how many neighbour pairs the grid
   * actually has — a request for more is satisfied as far as it goes rather
   * than by inventing long-range arrows the layout does not contain.
   */
  connections: number
  /** Grid width. Defaults to a roughly square grid. */
  columns?: number
}

/** The grid width used when the caller does not pick one. */
export function defaultColumns(blocks: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(blocks, 1))))
}

/** The world-space position of the `index`th cell of the grid. */
export function cellPosition(
  index: number,
  columns: number,
): { x: number; y: number; column: number; row: number } {
  const column = index % columns
  const row = Math.floor(index / columns)
  const size = DEFAULT_BLOCK_SIZE.rect
  return {
    column,
    row,
    x: column * (size.width + BIG_DIAGRAM_GAP.x),
    y: row * (size.height + BIG_DIAGRAM_GAP.y),
  }
}

/** The id a block at `index` gets. Zero-padded so ids sort like their index. */
export function bigBlockId(index: number): string {
  return `perf-b-${String(index).padStart(5, '0')}`
}

/**
 * Neighbour pairs of the grid, right-hand first and then downward.
 *
 * Right before down so that a truncated request still produces a connected
 * diagram rather than a set of disjoint columns.
 */
function neighbourPairs(blocks: number, columns: number): [number, number][] {
  const pairs: [number, number][] = []
  for (let index = 0; index + 1 < blocks; index += 1) {
    if ((index + 1) % columns !== 0) pairs.push([index, index + 1])
  }
  for (let index = 0; index + columns < blocks; index += 1) {
    pairs.push([index, index + columns])
  }
  return pairs
}

/**
 * Builds the document. Pure: it touches no store and no clock, so the same
 * options always give byte-identical output.
 */
export function makeBigDiagram({
  blocks: blockCount,
  connections: connectionCount,
  columns: requestedColumns,
}: BigDiagramOptions): DocumentSlice {
  const total = Math.max(0, Math.floor(blockCount))
  const columns = requestedColumns ?? defaultColumns(total)

  const blocks: Record<string, Block> = {}
  const blockOrder: string[] = []
  const size = DEFAULT_BLOCK_SIZE.rect

  for (let index = 0; index < total; index += 1) {
    const id = bigBlockId(index)
    const { x, y, column, row } = cellPosition(index, columns)
    blocks[id] = {
      id,
      type: 'rect',
      x,
      y,
      width: size.width,
      height: size.height,
      text: `${column},${row}`,
    }
    blockOrder.push(id)
  }

  const pairs = neighbourPairs(total, columns).slice(
    0,
    Math.max(0, Math.floor(connectionCount)),
  )
  const connections: Record<string, Connection> = {}
  const connectionOrder: string[] = []

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]
    if (!pair) continue
    const id = `perf-c-${String(index).padStart(5, '0')}`
    connections[id] = { id, sourceId: bigBlockId(pair[0]), targetId: bigBlockId(pair[1]) }
    connectionOrder.push(id)
  }

  return {
    blocks,
    blockOrder,
    connections,
    connectionOrder,
    groups: {},
    groupOrder: [],
  }
}
