import { memo } from 'react'
import type { Block } from '../types'
import { blockShapeStyle, blockTextStyle } from '../utils/style'

/**
 * World-unit font size when a block does not override it.
 *
 * Still a literal here rather than a CSS rule because `<text>` needs a real
 * `font-size` attribute for the label to be measured and centred at all; every
 * *colour* default stays in the stylesheet.
 */
const FONT_SIZE = 14

interface BlockViewProps {
  block: Block
  selected: boolean
  /**
   * Double-click. Named for the gesture rather than for one of its outcomes:
   * since Phase 5 it may open the text editor *or* step into a group, and the
   * canvas decides which — the block has no business knowing about groups.
   */
  onActivate: (id: string) => void
}

/**
 * One block, and nothing else.
 *
 * Selecting and dragging are not handled here on purpose: the canvas owns a
 * single pointer-down handler that hit-tests via `data-block-id`, so a diagram
 * with a thousand blocks still has one listener rather than a thousand.
 */
function BlockViewImpl({ block, selected, onActivate }: BlockViewProps) {
  const centerX = block.x + block.width / 2
  const centerY = block.y + block.height / 2

  return (
    <g
      data-block-id={block.id}
      data-testid="block"
      data-block-type={block.type}
      className="block"
      onDoubleClick={(event) => {
        event.stopPropagation()
        onActivate(block.id)
      }}
    >
      {block.type === 'rect' ? (
        <rect
          className="block__shape"
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          rx={4}
          // Sparse inline style: a block with no style sets no property at
          // all and renders entirely off `.block__shape`, exactly as before
          // Phase 5. Inline rather than presentation attributes because an
          // attribute loses to the class — see `blockShapeStyle`.
          style={blockShapeStyle(block.style)}
        />
      ) : (
        // Invisible hit area so a bare text block is still easy to grab.
        <rect
          className="block__hit"
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          fill="transparent"
        />
      )}

      <text
        className="block__text"
        x={centerX}
        y={centerY}
        fontSize={FONT_SIZE}
        textAnchor="middle"
        dominantBaseline="central"
        style={blockTextStyle(block.style)}
      >
        {block.text}
      </text>

      {selected && (
        <rect
          className="block__selection"
          data-testid="block-selection"
          x={block.x}
          y={block.y}
          width={block.width}
          height={block.height}
          rx={4}
          fill="none"
          // Keeps the outline a constant thickness on screen at any zoom.
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </g>
  )
}

export const BlockView = memo(BlockViewImpl)
