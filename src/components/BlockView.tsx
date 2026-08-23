import { memo } from 'react'
import type { Block } from '../types'

/** World-unit font size. Phase 5 will let each block override it. */
const FONT_SIZE = 14

interface BlockViewProps {
  block: Block
  selected: boolean
  onEdit: (id: string) => void
}

/**
 * One block, and nothing else.
 *
 * Selecting and dragging are not handled here on purpose: the canvas owns a
 * single pointer-down handler that hit-tests via `data-block-id`, so a diagram
 * with a thousand blocks still has one listener rather than a thousand.
 */
function BlockViewImpl({ block, selected, onEdit }: BlockViewProps) {
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
        onEdit(block.id)
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
