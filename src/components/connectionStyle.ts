/**
 * Rendering constants shared by the real arrows, the drag preview and the
 * marker definition.
 *
 * A plain module rather than part of a component file: these are imported by
 * three components, and exporting non-components alongside components breaks
 * fast refresh.
 */

/** The id of the one arrowhead marker every connection points to. */
export const ARROW_MARKER_ID = 'flowcraft-arrow'

/**
 * Corner rounding in world units. Small enough that `pathFromPoints` rarely
 * has to shrink it, and the ghost uses the same value so the preview matches
 * the arrow it becomes.
 */
export const CONNECTION_CORNER_RADIUS = 8
