import { memo } from 'react'
import type { Block } from '../types'

/** World-unit font size. Phase 5 will let each block override it. */
const FONT_SIZE = 14

interface BlockViewProps {
  block: Block
  selected: boolean
  /** True while the Select tool is active; other tools click through to create. */
  interactive: boolean
  onSelect: (id: string) => void
  onEdit: (id: string) => void
}

function BlockViewImpl({
  block,
  selected,
  interactive,
  onSelect,
  onEdit,
}: BlockViewProps) {
  const centerX = block.x + block.width / 2
  const centerY = block.y + block.height / 2

  return (
    <g
      data-block-id={block.id}
      data-testid="block"
      data-block-type={block.type}
      className="block"
      onPointerDown={(event) => {
        if (!interactive) return
        event.stopPropagation()
        onSelect(block.id)
      }}
      onClick={(event) => {
        // Let the click reach the canvas when a creation tool is active, so
        // the user can drop a new block on top of an existing one.
        if (interactive) event.stopPropagation()
      }}
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
