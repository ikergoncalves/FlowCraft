import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useGesture } from '@use-gesture/react'
import { useBlockList, useDiagramStore } from '../store/diagramStore'
import { useCanvasRect } from '../hooks/useCanvasRect'
import { useSpaceKey } from '../hooks/useSpaceKey'
import type { CanvasRect } from '../types'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  gridStepForZoom,
  panByScreenDelta,
  screenToWorld,
  viewBoxFor,
  zoomAtPoint,
  zoomFactorForWheel,
} from '../utils/coords'
import { makeBlockAt } from '../utils/blocks'
import { BlockView } from './BlockView'
import { TextEditor } from './TextEditor'
import { ZoomIndicator } from './ZoomIndicator'

const GRID_PATTERN_ID = 'flowcraft-grid'

/** Bitmask values of `PointerEvent.buttons`. */
const BUTTON_LEFT = 1
const BUTTON_MIDDLE = 4

function readRect(element: Element | null, fallback: CanvasRect): CanvasRect {
  if (!element) return fallback
  const box = element.getBoundingClientRect()
  return { left: box.left, top: box.top, width: box.width, height: box.height }
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rect = useCanvasRect(containerRef)

  const viewport = useDiagramStore((state) => state.viewport)
  const tool = useDiagramStore((state) => state.tool)
  const selectedIds = useDiagramStore((state) => state.selectedIds)
  const select = useDiagramStore((state) => state.select)
  const blocks = useBlockList()

  const [editingId, setEditingId] = useState<string | null>(null)
  const { pressed: spacePressed, pressedRef: spacePressedRef } = useSpaceKey()

  // Set while a pan actually moves the camera, so the click that ends the
  // drag does not also create a block or clear the selection.
  const pannedRef = useRef(false)
  // Decided once at drag start; consulted on every subsequent move.
  const panAllowedRef = useRef(false)

  const measure = useCallback(() => readRect(containerRef.current, rect), [rect])

  useGesture(
    {
      onWheel: ({ event }) => {
        // A trackpad pinch arrives as ctrl+wheel and is handled by onPinch.
        if (event.ctrlKey) return
        event.preventDefault()

        const { viewport: current, setViewport } = useDiagramStore.getState()
        const factor = zoomFactorForWheel(event.deltaY, event.deltaMode)
        setViewport(
          zoomAtPoint(
            current,
            { x: event.clientX, y: event.clientY },
            measure(),
            current.zoom * factor,
          ),
        )
      },

      onPinch: ({ origin: [originX, originY], offset: [scale], event }) => {
        event.preventDefault()
        const { viewport: current, setViewport } = useDiagramStore.getState()
        setViewport(zoomAtPoint(current, { x: originX, y: originY }, measure(), scale))
      },

      // Panning: middle-drag anywhere, space + left-drag anywhere, or a plain
      // left-drag over empty canvas while the Select tool is active.
      onDrag: ({ delta: [dx, dy], buttons, first, event }) => {
        if (first) {
          pannedRef.current = false
          const onBlock =
            event.target instanceof Element &&
            event.target.closest('[data-block-id]') !== null
          panAllowedRef.current =
            (buttons & BUTTON_MIDDLE) !== 0 ||
            ((buttons & BUTTON_LEFT) !== 0 &&
              (spacePressedRef.current ||
                (useDiagramStore.getState().tool === 'select' && !onBlock)))
          return
        }

        if (!panAllowedRef.current) return
        if (dx === 0 && dy === 0) return

        pannedRef.current = true
        const { viewport: current, setViewport } = useDiagramStore.getState()
        setViewport(panByScreenDelta(current, dx, dy))
      },
    },
    {
      target: svgRef,
      eventOptions: { passive: false },
      drag: {
        // Allow middle-button drags, not just the left button.
        pointer: { buttons: -1 },
        filterTaps: true,
      },
      pinch: {
        scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM },
        from: () => [useDiagramStore.getState().viewport.zoom, 0],
      },
    },
  )

  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (pannedRef.current) {
      pannedRef.current = false
      return
    }

    const {
      tool: activeTool,
      addBlock,
      setTool,
      clearSelection,
    } = useDiagramStore.getState()

    if (activeTool === 'select') {
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

  const cursor = spacePressed ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div className="canvas" ref={containerRef}>
      <svg
        ref={svgRef}
        className="canvas__svg"
        data-testid="canvas"
        role="application"
        aria-label="Diagram canvas"
        viewBox={viewBoxFor(viewport, rect)}
        style={{ cursor, touchAction: 'none' }}
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
            selected={selectedIds.includes(block.id)}
            interactive={tool === 'select'}
            onSelect={select}
            onEdit={setEditingId}
          />
        ))}
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
