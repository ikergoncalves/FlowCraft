import type { Connection } from '../types'

/**
 * Rendering constants shared by the real arrows, the drag preview and the
 * marker definition.
 *
 * A plain module rather than part of a component file: these are imported by
 * three components, and exporting non-components alongside components breaks
 * fast refresh.
 */

/**
 * The id of the default arrowhead marker — the one an unstyled connection
 * points to, whose colour comes from `.connection__arrow` in the stylesheet.
 */
export const ARROW_MARKER_ID = 'flowcraft-arrow'

/**
 * Corner rounding in world units. Small enough that `pathFromPoints` rarely
 * has to shrink it, and the ghost uses the same value so the preview matches
 * the arrow it becomes.
 */
export const CONNECTION_CORNER_RADIUS = 8

/**
 * A marker id for one stroke colour.
 *
 * SVG `<marker>` has no way to inherit the colour of the path it caps: the
 * portable mechanism would be `context-stroke`, which is still not supported
 * widely enough to rely on, and `currentColor` inside a marker resolves
 * against the marker's own context rather than the referencing path's. So the
 * colour has to be baked into the marker.
 *
 * Baking it **per colour, not per connection**, is the whole point. Ids derive
 * from the colour string, so a hundred red arrows share one marker and the
 * `<defs>` grows with the size of the palette rather than with the size of the
 * diagram. `arrowMarkerStrokes` collects the distinct set actually in use.
 *
 * The slug keeps only characters that are safe in an id — `#4c8dff` becomes
 * `flowcraft-arrow-4c8dff`, `rgb(1, 2, 3)` becomes `flowcraft-arrow-rgb-1-2-3`
 * — and distinct colours cannot collide onto one id because the substitution
 * is injective on the character classes CSS colours actually use.
 */
export function markerIdForStroke(stroke?: string): string {
  if (stroke === undefined) return ARROW_MARKER_ID
  const slug = stroke
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? `${ARROW_MARKER_ID}-${slug}` : ARROW_MARKER_ID
}

/**
 * Every distinct stroke colour the given connections ask for, sorted.
 *
 * Sorted so the rendered `<defs>` is stable across re-renders — an unstable
 * order would rebuild the marker elements on every paint for no reason.
 * Connections with no stroke override are absent: they use the default marker,
 * which is always defined.
 */
export function arrowMarkerStrokes(connections: readonly Connection[]): string[] {
  const strokes = new Set<string>()
  for (const connection of connections) {
    const stroke = connection.style?.stroke
    if (stroke !== undefined) strokes.add(stroke)
  }
  return [...strokes].sort()
}
