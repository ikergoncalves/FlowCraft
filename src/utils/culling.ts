import type { Block, Connection, Viewport } from '../types'
import type { CanvasRect } from '../types'
import { clampZoom } from './coords'
import { rectsIntersect, type Rect } from './geometry'
import { ANCHOR_STUB } from './routing'

/**
 * Which elements are worth putting in the DOM, in world space and entirely
 * pure.
 *
 * **Why this exists.** Phase 7 measured a 5000-block diagram and found the
 * editor rendering all 5000 while a 1280x900 window at zoom 1 can show about
 * thirty. Every one of the other 4970 costs a React element, a handful of SVG
 * nodes and a slot in every reconciliation — and none of them is a pixel
 * anybody sees.
 *
 * **What culling is allowed to mean.** Only "not in the DOM this frame".
 * Nothing here touches the store, so a culled element is still in the
 * document, still exported, still saved, still selectable by Select All, and
 * still swept up by a marquee — the marquee reads `blockOrder`, not the DOM.
 * The single thing that goes away is the rendered node, and it comes back the
 * moment the camera moves. That distinction is the whole safety argument, and
 * it is why the store was kept as the only source of truth in Phase 2.
 *
 * **Two rules keep it from ever hiding something that matters.**
 *
 *  1. *A generous margin.* The visible world rect is grown by
 *     `CULL_MARGIN_PX` screen pixels on every side, so a block does not pop in
 *     exactly as its edge crosses the boundary and a pan of less than the
 *     margin never shows a bare patch before React catches up.
 *  2. *The selection is never culled.* Whatever the user has hold of stays
 *     rendered wherever it goes. Without this, dragging a block off the edge
 *     of the window would make it vanish mid-gesture, which is the single most
 *     alarming thing a culling bug can do, and nudging a selection off screen
 *     with the arrow keys would lose its outline. The selection is bounded by
 *     what the user selected, so this cannot reintroduce the cost it removes.
 *
 * Connections are culled against a *conservative* bound rather than their
 * actual route: every point `routeConnection` produces lies within the union
 * of the two block rects grown by the anchor stub, so the union is never
 * smaller than the path. Over-approximating renders the occasional arrow
 * nobody can see; under-approximating erases one somebody is looking at.
 */

/**
 * How far past the window's edge to keep rendering, in *screen* pixels.
 *
 * Screen rather than world, so the margin is a constant band of real estate at
 * every zoom instead of shrinking to nothing when zoomed out.
 */
export const CULL_MARGIN_PX = 400

/**
 * The world-space rectangle the canvas is showing, grown by the margin.
 *
 * A degenerate canvas — 0x0, which is what the first paint and any test
 * without layout sees — is treated as one pixel, matching `viewBoxFor`. That
 * keeps the two functions telling the same story about what is on screen.
 */
export function visibleWorldRect(
  viewport: Viewport,
  rect: CanvasRect,
  marginPx = CULL_MARGIN_PX,
): Rect {
  const zoom = clampZoom(viewport.zoom)
  const margin = marginPx / zoom
  return {
    x: viewport.x - margin,
    y: viewport.y - margin,
    width: Math.max(rect.width, 1) / zoom + margin * 2,
    height: Math.max(rect.height, 1) / zoom + margin * 2,
  }
}

/**
 * A box guaranteed to contain the drawn route between two blocks.
 *
 * `routeConnection` starts and ends on an edge anchor and never travels
 * further out than one `ANCHOR_STUB` before turning back in, and its middle
 * vertices are componentwise averages of points already inside that band. So
 * the union of the two rects, inflated by the stub, contains the path.
 */
export function connectionBounds(source: Rect, target: Rect, stub = ANCHOR_STUB): Rect {
  const minX = Math.min(source.x, target.x) - stub
  const minY = Math.min(source.y, target.y) - stub
  const maxX = Math.max(source.x + source.width, target.x + target.width) + stub
  const maxY = Math.max(source.y + source.height, target.y + target.height) + stub
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * The blocks to render: everything touching `view`, plus everything selected.
 *
 * Paint order is preserved — this filters, it never reorders. Returns the
 * input array unchanged when nothing is culled, so a small diagram costs one
 * pass and no allocation downstream.
 */
export function visibleBlocks(
  blocks: readonly Block[],
  view: Rect,
  selected: ReadonlySet<string>,
): readonly Block[] {
  const kept = blocks.filter(
    (block) => selected.has(block.id) || rectsIntersect(view, block),
  )
  return kept.length === blocks.length ? blocks : kept
}

/**
 * The connections to render.
 *
 * A connection whose endpoints are missing is dropped here rather than left
 * for the renderer, which matches what `Canvas` did before culling existed: a
 * dangling arrow cannot happen, but rendering nothing is cheaper than trusting
 * that at paint time.
 *
 * Selected connections are kept for the same reason selected blocks are, and
 * so is any connection touching a selected block — an arrow attached to the
 * block being dragged has to follow it out of the window rather than snap off
 * at the edge.
 */
export function visibleConnections(
  connections: readonly Connection[],
  blockById: ReadonlyMap<string, Block>,
  view: Rect,
  selectedBlocks: ReadonlySet<string>,
  selectedConnections: ReadonlySet<string>,
): readonly Connection[] {
  const kept = connections.filter((connection) => {
    const source = blockById.get(connection.sourceId)
    const target = blockById.get(connection.targetId)
    if (!source || !target) return false
    if (
      selectedConnections.has(connection.id) ||
      selectedBlocks.has(connection.sourceId) ||
      selectedBlocks.has(connection.targetId)
    ) {
      return true
    }
    return rectsIntersect(view, connectionBounds(source, target))
  })
  return kept.length === connections.length ? connections : kept
}
