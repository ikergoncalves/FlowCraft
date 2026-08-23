import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useBlockList, useDiagramStore } from '../store/diagramStore'
import { useCanvasGestures } from '../hooks/useCanvasGestures'
import { useCanvasRect } from '../hooks/useCanvasRect'
import { useSpaceKey } from '../hooks/useSpaceKey'
import type { CanvasRect } from '../types'
import { gridStepForZoom, screenToWorld, viewBoxFor } from '../utils/coords'
import { makeBlockAt } from '../utils/blocks'
import { BlockView } from './BlockView'
import { SelectionOverlay } from './SelectionOverlay'
import { TextEditor } from './TextEditor'
import { ZoomIndicator } from './ZoomIndicator'

const GRID_PATTERN_ID = 'flowcraft-grid'

function readRect(element: Element | null, fallback: CanvasRect): CanvasRect {
  if (!element) return fallback
  const box = element.getBoundingClientRect()
  return { left: box.left, top: box.top, width: box.width, height: box.height }
}

/** True when the click carries a modifier that means "keep the selection". */
function isAdditiveClick(event: MouseEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rect = useCanvasRect(containerRef)

  const viewport = useDiagramStore((state) => state.viewport)
  const tool = useDiagramStore((state) => state.tool)
  const selectedIds = useDiagramStore((state) => state.selectedIds)
  const blocks = useBlockList()

  const [editingId, setEditingId] = useState<string | null>(null)
  const { pressed: spacePressed, pressedRef: spacePressedRef } = useSpaceKey()

  const measure = useCallback(() => readRect(containerRef.current, rect), [rect])
  const { onPointerDown, marquee, dragging, consumeDragClick } = useCanvasGestures(
    svgRef,
    measure,
    spacePressedRef,
  )

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedBlocks = useMemo(
    () => blocks.filter((block) => selectedSet.has(block.id)),
    [blocks, selectedSet],
  )

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    // The click that ends a drag is not a click on the canvas.
    if (consumeDragClick()) return

    const {
      tool: activeTool,
      addBlock,
      setTool,
      select,
      clearSelection,
    } = useDiagramStore.getState()

    if (activeTool === 'select') {
      // Anything over a block or its handles was already settled on pointer
      // down; only bare canvas clears, and a modified click never does.
      const target = event.target
      const onChrome =
        target instanceof Element &&
        target.closest('[data-block-id], [data-resize-handle]') !== null
      if (onChrome || isAdditiveClick(event)) return
      clearSelection()
      return
    }

    const world = screenToWorld(
      { x: event.clientX, y: event.clientY },
      useDiagramStore.getState().viewport,
      measure(),
    )
    const block = addBlock(makeBlockAt(activeTool, world))
    select(block.id)
    // Creation is one-shot: drop straight back into Select.
    setTool('select')
  }

  const editingBlock =
    editingId === null ? undefined : blocks.find((b) => b.id === editingId)
  const gridStep = gridStepForZoom(viewport.zoom)
  const dotRadius = 1 / viewport.zoom
  const worldWidth = Math.max(rect.width, 1) / viewport.zoom
  const worldHeight = Math.max(rect.height, 1) / viewport.zoom

  const cursor = dragging
    ? 'grabbing'
    : spacePressed
      ? 'grab'
      : tool === 'select'
        ? 'default'
        : 'crosshair'

  return (
    <div className="canvas" ref={containerRef}>
      <svg
        ref={svgRef}
        className={[
          'canvas__svg',
          tool === 'select' ? 'canvas__svg--select' : '',
          dragging ? 'canvas__svg--dragging' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-testid="canvas"
        role="application"
        aria-label="Diagram canvas"
        viewBox={viewBoxFor(viewport, rect)}
        style={{ cursor, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onClick={handleClick}
        onContextMenu={(event) => {
          event.preventDefault()
        }}
      >
        <defs>
          <pattern
            id={GRID_PATTERN_ID}
            // userSpaceOnUse means the pattern is measured in world units, so
            // the grid follows pan and zoom without any extra bookkeeping.
            patternUnits="userSpaceOnUse"
            width={gridStep}
            height={gridStep}
            x={0}
            y={0}
          >
            <circle className="grid__dot" cx={0} cy={0} r={dotRadius} />
            <circle className="grid__dot" cx={gridStep} cy={0} r={dotRadius} />
            <circle className="grid__dot" cx={0} cy={gridStep} r={dotRadius} />
            <circle className="grid__dot" cx={gridStep} cy={gridStep} r={dotRadius} />
          </pattern>
        </defs>

        <rect
          className="canvas__grid"
          data-testid="canvas-grid"
          x={viewport.x}
          y={viewport.y}
          width={worldWidth}
          height={worldHeight}
          fill={`url(#${GRID_PATTERN_ID})`}
        />

        {blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            selected={selectedSet.has(block.id)}
            onEdit={setEditingId}
          />
        ))}

        {marquee && (
          <rect
            className="marquee"
            data-testid="marquee"
            x={marquee.x}
            y={marquee.y}
            width={marquee.width}
            height={marquee.height}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}

        <SelectionOverlay blocks={selectedBlocks} zoom={viewport.zoom} />
      </svg>

      {editingBlock && (
        <TextEditor
          key={editingBlock.id}
          block={editingBlock}
          viewport={viewport}
          rect={rect}
          onCommit={(text) => {
            useDiagramStore.getState().updateBlock(editingBlock.id, { text })
            setEditingId(null)
          }}
          onCancel={() => {
            setEditingId(null)
          }}
        />
      )}

      <ZoomIndicator />
    </div>
  )
}
