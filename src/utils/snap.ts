import type { Point } from '../types'
import { GRID_SIZE } from './coords'

/**
 * Snapping to the grid, in world space.
 *
 * These are deliberately a transformation of an already-computed result rather
 * than a change to the gesture layer: a drag still works out where the pointer
 * put things, and only then is that answer rounded onto the lattice. Keeping
 * the two apart is what lets Alt flip snapping mid-gesture without any of the
 * gesture maths knowing about it.
 *
 * The step is always the base `GRID_SIZE`. `gridStepForZoom` coarsens the grid
 * that gets *painted* when zoomed out, but snapping to a step the user cannot
 * see would make blocks jump by amounts that do not match the dots.
 */

/**
 * `value` rounded to the nearest multiple of `step`.
 *
 * Exact half-steps round up — toward positive infinity, `Math.round`'s own
 * convention — so 10 snaps to 20 and -10 snaps to -0, not to -20. Picking the
 * same direction for both signs keeps the function monotonic, which is what
 * stops a slow drag through a midpoint from stuttering back and forth.
 *
 * A non-finite value or a non-positive step is returned untouched: there is no
 * sensible lattice for either, and silently producing 0 would teleport a block
 * to the origin.
 */
export function snapValue(value: number, step: number = GRID_SIZE): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value
  // `+ 0` normalises the -0 that Math.round(-0.4) produces, so snapped
  // coordinates compare equal to the 0 a test or a later snap would produce.
  return Math.round(value / step) * step + 0
}

/** `snapValue` on both axes. */
export function snapPoint(point: Point, step: number = GRID_SIZE): Point {
  return { x: snapValue(point.x, step), y: snapValue(point.y, step) }
}
