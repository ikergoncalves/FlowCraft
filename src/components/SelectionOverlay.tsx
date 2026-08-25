import type { Block, Group } from '../types'
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

/**
 * How far a group's outline sits outside its members, in screen pixels.
 *
 * A group box drawn flush with the bounding box would sit exactly on top of
 * the multi-selection box, and the two mean different things. The gap is in
 * screen pixels, like every other affordance, so it stays legible at any zoom.
 */
const GROUP_PADDING_PX = 6

interface SelectionOverlayProps {
  /** The selected blocks, in paint order. */
  blocks: readonly Block[]
  /** Groups every one of whose members is selected — see `selectedGroups`. */
  groups?: readonly Group[]
  zoom: number
}

/**
 * Chrome drawn on top of the selection: resize handles for a single block, a
 * group outline for each fully-selected group, and a bounding box for a
 * multi-selection that is not simply one group.
 *
 * Multi-block resize is out of scope, so handles deliberately disappear the
 * moment a second block joins the selection rather than pretending to work —
 * and resizing a group is out of scope for Phase 5 for the same reason, so a
 * selected group never shows them either.
 */
export function SelectionOverlay({ blocks, groups = [], zoom }: SelectionOverlayProps) {
  const bounds = boundingBox(blocks)
  if (bounds === null) return null

  const byId = new Map(blocks.map((block) => [block.id, block]))
  const padding = GROUP_PADDING_PX / zoom

  const groupBoxes = groups.map((group) => {
    const members = group.blockIds
      .map((id) => byId.get(id))
      .filter((block): block is Block => block !== undefined)
    return { id: group.id, box: boundingBox(members) }
  })

  /*
   * The plain multi-selection box is suppressed when the selection is exactly
   * one group: two nested dashed rectangles around the same blocks would say
   * "these are selected together" twice and "these are a group" not at all.
   */
  const selectionIsOneGroup =
    groups.length === 1 && groups[0]?.blockIds.length === blocks.length
  const showBounds = blocks.length > 1 && !selectionIsOneGroup

  const outlines = (
    <>
      {groupBoxes.map(({ id, box }) =>
        box === null ? null : (
          <rect
            key={id}
            className="selection__group"
            data-testid="group-bounds"
            data-group-id={id}
            x={box.x - padding}
            y={box.y - padding}
            width={box.width + padding * 2}
            height={box.height + padding * 2}
            rx={2}
            fill="none"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ),
      )}
      {showBounds && (
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
      )}
    </>
  )

  if (blocks.length > 1) return outlines

  const size = HANDLE_SIZE_PX / zoom
  const positions = handlePositions(bounds)

  return (
    <>
      {outlines}
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
    </>
  )
}
