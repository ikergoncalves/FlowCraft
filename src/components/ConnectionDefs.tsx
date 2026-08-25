import { ARROW_MARKER_ID, markerIdForStroke } from './connectionStyle'

/** Arrowhead size in screen pixels: length along the line, then across it. */
const ARROW_LENGTH_PX = 10
const ARROW_WIDTH_PX = 8

interface ArrowMarkerProps {
  id: string
  zoom: number
  /** Explicit colour, or `undefined` to let the stylesheet decide. */
  stroke?: string
}

/**
 * One arrowhead marker.
 *
 * Sizing a marker so it neither balloons nor vanishes as the canvas zooms is
 * the fiddly part. The usual `markerUnits="strokeWidth"` is no help here: the
 * lines use `vector-effect="non-scaling-stroke"`, and browsers scale markers
 * by the *declared* stroke width rather than the rendered one, so the head
 * would grow with the world while the line it caps stayed put. Instead the
 * marker is measured in user space and its box is divided by the zoom, the
 * same trick the resize handles use. The `viewBox` then lets the arrow shape
 * itself stay in fixed coordinates and be scaled to fit that box.
 */
function ArrowMarker({ id, zoom, stroke }: ArrowMarkerProps) {
  return (
    <marker
      id={id}
      data-testid="arrow-marker"
      data-arrow-stroke={stroke}
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
        // Inline style, and for the same reason the block's fill is: a `fill`
        // *attribute* sits below every author rule in the SVG cascade, so
        // `.connection__arrow` would win and every arrowhead would come out
        // the default grey however the line was coloured. Without an explicit
        // colour nothing is set at all and the stylesheet keeps control.
        style={stroke === undefined ? undefined : { fill: stroke }}
        d={`M 0 0 L ${ARROW_LENGTH_PX} ${ARROW_WIDTH_PX / 2} L 0 ${ARROW_WIDTH_PX} z`}
      />
    </marker>
  )
}

interface ConnectionDefsProps {
  zoom: number
  /** The distinct stroke colours in use — see `arrowMarkerStrokes`. */
  strokes: readonly string[]
}

/**
 * The arrowhead markers: the default one, plus one per colour in use.
 *
 * Phase 3 shipped a single shared marker, which was right until connections
 * could be coloured — a red arrow with a grey head reads as a rendering bug.
 * The alternative, a marker per *connection*, would put an element in `<defs>`
 * for every arrow in the document and re-create it on every render; keying by
 * colour means a diagram of five hundred arrows in six colours defines seven
 * markers.
 *
 * Selection is deliberately not part of the key. A selected arrow is already
 * brighter and thicker, and doubling the marker count to tint the head as well
 * would buy very little for a permanent factor of two.
 */
export function ConnectionDefs({ zoom, strokes }: ConnectionDefsProps) {
  return (
    <>
      <ArrowMarker id={ARROW_MARKER_ID} zoom={zoom} />
      {strokes.map((stroke) => (
        <ArrowMarker
          key={stroke}
          id={markerIdForStroke(stroke)}
          zoom={zoom}
          stroke={stroke}
        />
      ))}
    </>
  )
}
