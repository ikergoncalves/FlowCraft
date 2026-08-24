import type { Point } from '../types'
import { snapValue } from './snap'

/**
 * An axis-aligned box in world space, `x`/`y` being its top-left corner.
 *
 * `Block` is structurally a `Rect` plus its own fields, so blocks can be
 * passed straight into everything here without a conversion step.
 */
export interface Rect extends Point {
  width: number
  height: number
}

/** Smallest a block may be dragged down to, in world units. */
export const MIN_BLOCK_SIZE = 20

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Clockwise from the top-left corner, which is also the paint order. */
export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

/**
 * Which edge each handle drags, per axis: `-1` the min edge (left / top), `1`
 * the max edge (right / bottom), `0` neither — that axis stays untouched.
 * The opposite edge is the anchor and never moves, which is what makes
 * dragging NW hold the SE corner still.
 */
const HANDLE_EDGES: Record<ResizeHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
}

/** CSS cursor for each handle, so the affordance matches the axis it moves. */
export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

/** The box spanned by two opposite corners, whichever way they were dragged. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/**
 * Whether two boxes overlap.
 *
 * Touching edges count as an overlap: a marquee dragged exactly up to a block
 * should catch it, and a perfectly straight drag — a zero-width marquee —
 * should still catch what it crosses rather than selecting nothing.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  )
}

/** Whether `point` falls inside `rect`, edges included. */
export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** The smallest box enclosing every input box; `null` for an empty list. */
export function boundingBox(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export interface ResizeOptions {
  /** Floor for either dimension. Defaults to `MIN_BLOCK_SIZE`. */
  minSize?: number
  /** Keep the original aspect ratio. Only meaningful for corner handles. */
  preserveAspect?: boolean
  /**
   * Round the edges this handle moves onto a lattice of this size. Omit — or
   * pass `undefined` — for no snapping.
   *
   * Only the moving edges are snapped; the anchored edge stays exactly where
   * it was, so a resize never shifts the corner the user is holding still.
   * Ignored alongside `preserveAspect`, since rounding both axes would destroy
   * the ratio that option exists to protect.
   */
  snapStep?: number
}

/**
 * Rewrites a resize delta so the edges the handle moves land on the lattice.
 *
 * For each axis the handle actually drags, the moving edge's new position is
 * rounded to a multiple of `step` and the delta adjusted to match. Axes the
 * handle leaves alone keep a delta of whatever they had, which `resizeRect`
 * then ignores anyway.
 */
function snapDelta(
  rect: Rect,
  edge: { x: -1 | 0 | 1; y: -1 | 0 | 1 },
  deltaWorld: Point,
  step: number,
): Point {
  const snapAxis = (
    direction: -1 | 0 | 1,
    min: number,
    size: number,
    delta: number,
  ): number => {
    if (direction === 0) return delta
    const movingEdge = direction === 1 ? min + size : min
    return snapValue(movingEdge + delta, step) - movingEdge
  }

  return {
    x: snapAxis(edge.x, rect.x, rect.width, deltaWorld.x),
    y: snapAxis(edge.y, rect.y, rect.height, deltaWorld.y),
  }
}

/**
 * `rect` resized by dragging `handle` through `deltaWorld`, holding the
 * opposite edge or corner fixed.
 *
 * Shrinking stops at `minSize` instead of flipping the box inside out, so a
 * handle dragged well past its anchor leaves the box pinned at the minimum,
 * still on the anchor's side.
 */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  deltaWorld: Point,
  options: ResizeOptions = {},
): Rect {
  const minSize = options.minSize ?? MIN_BLOCK_SIZE
  const edge = HANDLE_EDGES[handle]
  const isCorner = edge.x !== 0 && edge.y !== 0

  /*
   * Snapping is applied to the *edge positions*, not to the delta or the
   * resulting size, and then fed back in as a corrected delta.
   *
   * Rounding the width instead would leave a block whose left edge started off
   * the lattice still off it, only now a round number wide — the opposite of
   * what the user sees. Correcting the delta means the rest of the function,
   * including the minimum-size clamp below, carries on unchanged; the clamp
   * therefore still wins over the grid, and a block dragged to its floor stays
   * at exactly MIN_BLOCK_SIZE rather than a grid multiple.
   */
  const snapStep = options.preserveAspect ? undefined : options.snapStep
  const delta =
    snapStep === undefined ? deltaWorld : snapDelta(rect, edge, deltaWorld, snapStep)

  let width = rect.width + edge.x * delta.x
  let height = rect.height + edge.y * delta.y

  if (options.preserveAspect && isCorner && rect.width > 0 && rect.height > 0) {
    // Follow whichever axis the pointer pushed proportionally further and
    // derive the other from it, so the ratio is exact rather than drifting.
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const scale = Math.max(
      Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY,
      // Clearing the minimum by scaling keeps the ratio; clamping per axis
      // would not.
      minSize / rect.width,
      minSize / rect.height,
    )
    width = rect.width * scale
    height = rect.height * scale
  } else {
    // Clamp only the axes the handle actually drags: an edge handle must not
    // quietly grow a box that was already below the minimum on the other one.
    width = edge.x === 0 ? rect.width : Math.max(minSize, width)
    height = edge.y === 0 ? rect.height : Math.max(minSize, height)
  }

  return {
    // A min-edge handle moves the origin; the max edge stays put.
    x: edge.x === -1 ? rect.x + rect.width - width : rect.x,
    y: edge.y === -1 ? rect.y + rect.height - height : rect.y,
    width,
    height,
  }
}

/** Where each handle sits on `rect`: the corners and the edge midpoints. */
export function handlePositions(rect: Rect): Record<ResizeHandle, Point> {
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height
  const midX = rect.x + rect.width / 2
  const midY = rect.y + rect.height / 2

  return {
    nw: { x: left, y: top },
    n: { x: midX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: midY },
  }
}
