import type { Block } from '../types'
import { ANCHOR_SIDES } from '../types'
import { anchorPoint } from '../utils/routing'

/** Port radius in screen pixels, kept constant by dividing through the zoom. */
const PORT_RADIUS_PX = 5

/**
 * Extra invisible radius around each port, so the 5px dot is not a 5px target.
 * Fitts's law: the visible affordance can stay small and tidy while the thing
 * the pointer has to hit is comfortably larger.
 */
const PORT_HIT_RADIUS_PX = 10

interface BlockPortsProps {
  block: Block
  zoom: number
  /** The port the pointer is currently over, if any. */
  activeSide?: string | null
}

/**
 * The four connection ports revealed when the pointer is over a block.
 *
 * Rendered as a sibling of the blocks rather than inside `BlockView`, and
 * deliberately *without* a `data-block-id`: the canvas hit test looks for
 * `data-port-side` first, and keeping the two attributes on separate elements
 * means dragging a port can never be mistaken for dragging the block.
 */
export function BlockPorts({ block, zoom, activeSide = null }: BlockPortsProps) {
  const radius = PORT_RADIUS_PX / zoom
  const hitRadius = PORT_HIT_RADIUS_PX / zoom

  return (
    <g className="ports" data-testid="block-ports" data-ports-block={block.id}>
      {ANCHOR_SIDES.map((side) => {
        const point = anchorPoint(block, side)
        return (
          <g
            key={side}
            data-port-side={side}
            data-port-block={block.id}
            data-testid="block-port"
            className={`port${activeSide === side ? ' port--active' : ''}`}
          >
            <circle cx={point.x} cy={point.y} r={hitRadius} fill="transparent" />
            <circle
              className="port__dot"
              cx={point.x}
              cy={point.y}
              r={radius}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        )
      })}
    </g>
  )
}
