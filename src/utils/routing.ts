import type { AnchorSide, Point } from '../types'
import type { Rect } from './geometry'

/**
 * Orthogonal connection routing, in world space and entirely pure.
 *
 * Nothing here knows about React, the store, or the current zoom. A connection
 * stores only block ids, so every point below is recomputed from the blocks'
 * live rects on each render — which is exactly why arrows follow their blocks
 * with no synchronising code anywhere.
 */

/**
 * How far a route runs straight out of an edge before it is allowed to turn,
 * in world units.
 *
 * Without it a route would leave the block diagonally the instant it needed to
 * change axis, and the arrowhead would sit askew against the border. Leaving
 * perpendicular is what makes the diagram read as a wiring schematic.
 */
export const ANCHOR_STUB = 16

/** The outward unit normal of each side, in a y-down coordinate system. */
const SIDE_NORMALS: Record<AnchorSide, Point> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
}

/** Whether a side faces along the x axis; the other two face along y. */
function isHorizontal(side: AnchorSide): boolean {
  return side === 'e' || side === 'w'
}

export interface AnchorPair {
  source: AnchorSide
  target: AnchorSide
}

/** The midpoint of one edge of `rect`. A zero-sized rect collapses to a point. */
export function anchorPoint(rect: Rect, side: AnchorSide): Point {
  const midX = rect.x + rect.width / 2
  const midY = rect.y + rect.height / 2

  switch (side) {
    case 'n':
      return { x: midX, y: rect.y }
    case 's':
      return { x: midX, y: rect.y + rect.height }
    case 'w':
      return { x: rect.x, y: midY }
    case 'e':
      return { x: rect.x + rect.width, y: midY }
  }
}

/**
 * Which sides a connection should leave and arrive by, from the blocks'
 * relative positions.
 *
 * The rule is the centre-to-centre offset: whichever axis separates the two
 * blocks more wins, and the sides are the two that face each other along it.
 * Centre-based rather than gap-based because it is stable — the answer changes
 * only when a block crosses the diagonal, not every time an edge grazes past
 * another, so an arrow does not flap between sides during a drag.
 *
 * Ties go to the horizontal axis, which also settles the fully degenerate case
 * of two concentric blocks. That one case is not antisymmetric: with no offset
 * at all there is no "other side" to swap to, and e/w is as good an answer as
 * any. Every non-degenerate pair does invert when source and target swap.
 */
export function chooseAnchors(source: Rect, target: Rect): AnchorPair {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: 'e', target: 'w' } : { source: 'w', target: 'e' }
  }
  return dy >= 0 ? { source: 's', target: 'n' } : { source: 'n', target: 's' }
}

/**
 * Fills in whichever anchors were left unspecified.
 *
 * An explicitly pinned side always wins; the rest come from `chooseAnchors`
 * against the blocks' current rects, which is what lets an un-pinned arrow
 * re-route itself when a block is dragged around to the other side of its
 * partner.
 */
export function resolveAnchors(
  pinned: { sourceAnchor?: AnchorSide; targetAnchor?: AnchorSide },
  source: Rect,
  target: Rect,
): AnchorPair {
  const automatic = chooseAnchors(source, target)
  return {
    source: pinned.sourceAnchor ?? automatic.source,
    target: pinned.targetAnchor ?? automatic.target,
  }
}

/** Two points that are the same to within floating-point noise. */
function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
}

/**
 * Drops duplicate and redundant vertices.
 *
 * Consecutive duplicates appear whenever a degenerate case makes two
 * construction points coincide; collinear middle vertices appear whenever a
 * route happens to need fewer bends than the general shape provides. Removing
 * both keeps the polyline minimal, so `pathFromPoints` never has to round a
 * corner that does not actually turn.
 */
function simplify(points: readonly Point[]): Point[] {
  const deduped: Point[] = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (last && samePoint(last, point)) continue
    deduped.push(point)
  }

  const result: Point[] = []
  for (let i = 0; i < deduped.length; i += 1) {
    const previous = result[result.length - 1]
    const current = deduped[i]
    const next = deduped[i + 1]
    if (!current) continue
    if (previous && next) {
      // Every segment here is axis-aligned, so "collinear" is just "all three
      // share an x, or all three share a y".
      const collinearX =
        Math.abs(previous.x - current.x) < 1e-9 && Math.abs(current.x - next.x) < 1e-9
      const collinearY =
        Math.abs(previous.y - current.y) < 1e-9 && Math.abs(current.y - next.y) < 1e-9
      if (collinearX || collinearY) continue
    }
    result.push(current)
  }
  return result
}

export interface RouteOptions {
  /** Length of the perpendicular run off each edge. Defaults to `ANCHOR_STUB`. */
  stub?: number
}

/**
 * The polyline joining two blocks, in world space.
 *
 * Starts exactly on the source anchor and ends exactly on the target anchor,
 * runs perpendicular out of each edge for `stub` units, and turns only at
 * right angles in between — every consecutive pair of points shares an x or a
 * y. The shape depends on whether the two sides face along the same axis: two
 * facing sides get a mid-line jog, a horizontal side meeting a vertical one
 * gets a single elbow.
 *
 * Nothing here can produce a `NaN` from finite input, including the degenerate
 * cases the callers can actually hit: overlapping blocks, blocks sharing a
 * centre line, blocks closer together than the stub, and a block routed to
 * itself. Those may look untidy, but they stay drawable.
 */
export function routeConnection(
  source: Rect,
  target: Rect,
  anchors: AnchorPair,
  options: RouteOptions = {},
): Point[] {
  const stub = options.stub ?? ANCHOR_STUB
  const start = anchorPoint(source, anchors.source)
  const end = anchorPoint(target, anchors.target)

  const startNormal = SIDE_NORMALS[anchors.source]
  const endNormal = SIDE_NORMALS[anchors.target]
  const afterStart: Point = {
    x: start.x + startNormal.x * stub,
    y: start.y + startNormal.y * stub,
  }
  const beforeEnd: Point = {
    x: end.x + endNormal.x * stub,
    y: end.y + endNormal.y * stub,
  }

  const startHorizontal = isHorizontal(anchors.source)
  const endHorizontal = isHorizontal(anchors.target)
  const middle: Point[] = []

  if (startHorizontal && endHorizontal) {
    // Both stubs run along x, so the route crosses over on a vertical line
    // halfway between their tips.
    const midX = (afterStart.x + beforeEnd.x) / 2
    middle.push({ x: midX, y: afterStart.y }, { x: midX, y: beforeEnd.y })
  } else if (!startHorizontal && !endHorizontal) {
    const midY = (afterStart.y + beforeEnd.y) / 2
    middle.push({ x: afterStart.x, y: midY }, { x: beforeEnd.x, y: midY })
  } else if (startHorizontal) {
    // One stub runs along x and the other along y: a single elbow joins them.
    middle.push({ x: beforeEnd.x, y: afterStart.y })
  } else {
    middle.push({ x: afterStart.x, y: beforeEnd.y })
  }

  return simplify([start, afterStart, ...middle, beforeEnd, end])
}

/** Trims a float to something short enough to read in a `d` attribute. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/**
 * An SVG `d` attribute for a polyline, optionally with rounded corners.
 *
 * With a radius, each interior vertex becomes a quarter-circle arc. The radius
 * is capped at half of the shorter of the two segments meeting there, so a
 * corner can never eat more than its share of a segment — without that cap,
 * two tight bends in a row would overrun each other and the path would fold
 * back on itself.
 *
 * Non-finite points are dropped rather than formatted, so a `d` string never
 * contains `NaN` even if a caller hands over a broken point.
 */
export function pathFromPoints(points: readonly Point[], cornerRadius = 0): string {
  const clean = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  )
  const first = clean[0]
  if (!first) return ''
  if (clean.length === 1) return `M ${fmt(first.x)} ${fmt(first.y)}`

  const parts = [`M ${fmt(first.x)} ${fmt(first.y)}`]
  const radius = Number.isFinite(cornerRadius) ? Math.max(0, cornerRadius) : 0

  for (let i = 1; i < clean.length; i += 1) {
    const current = clean[i]
    const next = clean[i + 1]
    if (!current) continue

    const previous = clean[i - 1]
    if (radius === 0 || !next || !previous) {
      parts.push(`L ${fmt(current.x)} ${fmt(current.y)}`)
      continue
    }

    const inX = current.x - previous.x
    const inY = current.y - previous.y
    const outX = next.x - current.x
    const outY = next.y - current.y
    const inLength = Math.hypot(inX, inY)
    const outLength = Math.hypot(outX, outY)

    // A zero-length side has no direction to round against.
    if (inLength === 0 || outLength === 0) {
      parts.push(`L ${fmt(current.x)} ${fmt(current.y)}`)
      continue
    }

    const r = Math.min(radius, inLength / 2, outLength / 2)
    if (r <= 0) {
      parts.push(`L ${fmt(current.x)} ${fmt(current.y)}`)
      continue
    }

    const enter: Point = {
      x: current.x - (inX / inLength) * r,
      y: current.y - (inY / inLength) * r,
    }
    const leave: Point = {
      x: current.x + (outX / outLength) * r,
      y: current.y + (outY / outLength) * r,
    }

    // Cross product sign gives the turn direction. y grows downward here, so a
    // positive cross is a clockwise turn, which is SVG's sweep flag 1.
    const cross = inX * outY - inY * outX
    const sweep = cross > 0 ? 1 : 0

    parts.push(`L ${fmt(enter.x)} ${fmt(enter.y)}`)
    parts.push(`A ${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(leave.x)} ${fmt(leave.y)}`)
  }

  return parts.join(' ')
}
