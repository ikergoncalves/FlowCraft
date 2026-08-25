import { memo } from 'react'
import type { Block, Connection } from '../types'
import { pathFromPoints, resolveAnchors, routeConnection } from '../utils/routing'
import { connectionLineStyle } from '../utils/style'
import { CONNECTION_CORNER_RADIUS, markerIdForStroke } from './connectionStyle'

/**
 * Click target width in *screen* pixels, divided by the zoom like every other
 * constant-size affordance. A 2px line is far too thin to hit reliably, so an
 * invisible fat path underneath does the hit testing.
 */
const HIT_WIDTH_PX = 14

interface ConnectionViewProps {
  connection: Connection
  source: Block
  target: Block
  selected: boolean
  zoom: number
}

/**
 * One arrow between two blocks.
 *
 * Every coordinate is derived here, on each render, from the two blocks' live
 * rects — the connection itself stores no geometry at all. Moving a block
 * therefore re-routes its arrows for free, with no listener and no cache to
 * invalidate.
 *
 * Like `BlockView`, this is purely presentational: selection and hit testing
 * are the canvas's single pointer handler's job, reached through the
 * `data-connection-id` attribute.
 */
function ConnectionViewImpl({
  connection,
  source,
  target,
  selected,
  zoom,
}: ConnectionViewProps) {
  const points = routeConnection(
    source,
    target,
    resolveAnchors(connection, source, target),
  )
  const d = pathFromPoints(points, CONNECTION_CORNER_RADIUS)

  return (
    <g
      data-connection-id={connection.id}
      data-testid="connection"
      className={`connection${selected ? ' connection--selected' : ''}`}
    >
      <path
        className="connection__hit"
        data-testid="connection-hit"
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_WIDTH_PX / zoom}
        pointerEvents="stroke"
      />
      {/*
        Selection is a halo *under* the line rather than a recolouring of it.
        Repainting the line accent-blue used to be fine, but a coloured arrow
        cannot be recoloured to show selection without either losing the colour
        the user chose or leaving its arrowhead — which is keyed on that colour
        — a different shade from its own line. A halo works at any colour.
      */}
      {selected && (
        <path
          className="connection__halo"
          data-testid="connection-halo"
          d={d}
          fill="none"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      <path
        className="connection__line"
        data-testid="connection-line"
        d={d}
        fill="none"
        vectorEffect="non-scaling-stroke"
        // Sparse: an unstyled arrow sets nothing and keeps the stylesheet's
        // colour, width and (absent) dash pattern.
        style={connectionLineStyle(connection.style)}
        markerEnd={`url(#${markerIdForStroke(connection.style?.stroke)})`}
        pointerEvents="none"
      />
    </g>
  )
}

export const ConnectionView = memo(ConnectionViewImpl)
