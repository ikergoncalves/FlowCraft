import type { AnchorSide, Block, Point } from '../types'
import { chooseAnchors, pathFromPoints, routeConnection } from '../utils/routing'
import { ARROW_MARKER_ID, CONNECTION_CORNER_RADIUS } from './connectionStyle'

export interface ConnectDraft {
  source: Block
  sourceAnchor: AnchorSide
  /** Where the pointer is, in world space. */
  pointer: Point
  /** The block under the pointer, when it is a legal drop target. */
  target: Block | null
}

interface GhostConnectionProps {
  draft: ConnectDraft
}

/**
 * The arrow being dragged out of a port, before it exists.
 *
 * Routed through exactly the same functions as a real connection, so what the
 * user is shown mid-drag is what they get on release. With no block under the
 * pointer, the cursor stands in as a zero-sized rect — `routeConnection`
 * already handles degenerate rects, so no special case is needed here.
 */
export function GhostConnection({ draft }: GhostConnectionProps) {
  const targetRect = draft.target ?? {
    x: draft.pointer.x,
    y: draft.pointer.y,
    width: 0,
    height: 0,
  }

  const targetAnchor = chooseAnchors(draft.source, targetRect).target
  const points = routeConnection(draft.source, targetRect, {
    source: draft.sourceAnchor,
    target: targetAnchor,
  })

  return (
    <path
      className="connection__ghost"
      data-testid="connection-ghost"
      d={pathFromPoints(points, CONNECTION_CORNER_RADIUS)}
      fill="none"
      vectorEffect="non-scaling-stroke"
      markerEnd={`url(#${ARROW_MARKER_ID})`}
      pointerEvents="none"
    />
  )
}
