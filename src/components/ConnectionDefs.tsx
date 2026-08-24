import { ARROW_MARKER_ID } from './connectionStyle'

/** Arrowhead size in screen pixels: length along the line, then across it. */
const ARROW_LENGTH_PX = 10
const ARROW_WIDTH_PX = 8

interface ConnectionDefsProps {
  zoom: number
}

/**
 * The shared arrowhead marker.
 *
 * Sizing a marker so it neither balloons nor vanishes as the canvas zooms is
 * the fiddly part. The usual `markerUnits="strokeWidth"` is no help here: the
 * lines use `vector-effect="non-scaling-stroke"`, and browsers scale markers
 * by the *declared* stroke width rather than the rendered one, so the head
 * would grow with the world while the line it caps stayed put. Instead the
 * marker is measured in user space and its box is divided by the zoom, the
 * same trick the resize handles use. The `viewBox` then lets the arrow shape
 * itself stay in fixed coordinates and be scaled to fit that box.
 *
 * One marker serves every connection, so this costs one `<defs>` entry rather
 * than one per arrow.
 */
export function ConnectionDefs({ zoom }: ConnectionDefsProps) {
  return (
    <marker
      id={ARROW_MARKER_ID}
      data-testid="arrow-marker"
      viewBox={`0 0 ${ARROW_LENGTH_PX} ${ARROW_WIDTH_PX}`}
      markerUnits="userSpaceOnUse"
      markerWidth={ARROW_LENGTH_PX / zoom}
      markerHeight={ARROW_WIDTH_PX / zoom}
      // In viewBox coordinates: the tip, so it lands on the route's last point.
      refX={ARROW_LENGTH_PX}
      refY={ARROW_WIDTH_PX / 2}
      orient="auto"
    >
      <path
        className="connection__arrow"
        d={`M 0 0 L ${ARROW_LENGTH_PX} ${ARROW_WIDTH_PX / 2} L 0 ${ARROW_WIDTH_PX} z`}
      />
    </marker>
  )
}
