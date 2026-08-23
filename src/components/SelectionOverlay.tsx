import type { Block } from '../types'
import {
  HANDLE_CURSORS,
  RESIZE_HANDLES,
  boundingBox,
  handlePositions,
} from '../utils/geometry'

/**
 * Handle side length in *screen* pixels. The SVG is in world units, so it is
 * divided by the zoom to keep the grab targets the same physical size however
 * far in or out the user is.
 */
const HANDLE_SIZE_PX = 9

interface SelectionOverlayProps {
  /** The selected blocks, in paint order. */
  blocks: readonly Block[]
  zoom: number
}

/**
 * Chrome drawn on top of the selection: resize handles for a single block, a
 * bounding box for several.
 *
 * Multi-block resize is out of scope for Phase 2, so handles deliberately
 * disappear the moment a second block joins the selection rather than
 * pretending to work.
 */
export function SelectionOverlay({ blocks, zoom }: SelectionOverlayProps) {
  const bounds = boundingBox(blocks)
  if (bounds === null) return null

  if (blocks.length > 1) {
    return (
      <rect
        className="selection__bounds"
        data-testid="selection-bounds"
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="none"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    )
  }

  const size = HANDLE_SIZE_PX / zoom
  const positions = handlePositions(bounds)

  return (
    <g className="selection__handles" data-testid="resize-handles">
      {RESIZE_HANDLES.map((handle) => {
        const point = positions[handle]
        return (
          <rect
            key={handle}
            className="selection__handle"
            data-testid="resize-handle"
            data-resize-handle={handle}
            x={point.x - size / 2}
            y={point.y - size / 2}
            width={size}
            height={size}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: HANDLE_CURSORS[handle] }}
          />
        )
      })}
    </g>
  )
}
