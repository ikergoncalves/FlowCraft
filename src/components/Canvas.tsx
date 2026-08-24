import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useBlockList, useConnectionList, useDiagramStore } from '../store/diagramStore'
import { useCanvasGestures } from '../hooks/useCanvasGestures'
import { useCanvasRect } from '../hooks/useCanvasRect'
import { useSpaceKey } from '../hooks/useSpaceKey'
import type { CanvasRect } from '../types'
import { GRID_SIZE, gridStepForZoom, screenToWorld, viewBoxFor } from '../utils/coords'
import { makeBlockAt } from '../utils/blocks'
import { commitBlockText, createBlock } from '../history/actions'
import { snapPoint } from '../utils/snap'
import { BlockPorts } from './BlockPorts'
import { BlockView } from './BlockView'
import { ConnectionDefs } from './ConnectionDefs'
import { ConnectionView } from './ConnectionView'
import { GhostConnection } from './GhostConnection'
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
  const selectedConnectionIds = useDiagramStore((state) => state.selectedConnectionIds)
  const blocks = useBlockList()
  const connections = useConnectionList()

  const [editingId, setEditingId] = useState<string | null>(null)
  // Which block the pointer is over, so its ports can appear. Ephemeral UI
  // state, so it stays local rather than going through the store.
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const { pressed: spacePressed, pressedRef: spacePressedRef } = useSpaceKey()

  const measure = useCallback(() => readRect(containerRef.current, rect), [rect])
  const { onPointerDown, marquee, connectDraft, dragging, consumeDragClick } =
    useCanvasGestures(svgRef, measure, spacePressedRef)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedBlocks = useMemo(
    () => blocks.filter((block) => selectedSet.has(block.id)),
    [blocks, selectedSet],
  )
  const selectedConnectionSet = useMemo(
    () => new Set(selectedConnectionIds),
    [selectedConnectionIds],
  )
  const blockById = useMemo(
    () => new Map(blocks.map((block) => [block.id, block])),
    [blocks],
  )

  /**
   * Tracks the hovered block from `pointerover`, which bubbles and fires only
   * when the pointer crosses into a different element — far cheaper than
   * hit-testing on every `pointermove`.
   */
  const handlePointerOver = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target
    const id =
      target instanceof Element
        ? (target.closest('[data-block-id]')?.getAttribute('data-block-id') ??
          target.closest('[data-port-block]')?.getAttribute('data-port-block') ??
          null)
        : null
    setHoveredId(id)
  }

  // Ports belong to direct manipulation, so they stay out of the way while a
  // creation tool is active or another gesture is already running.
  const portsBlock =
    tool === 'select' && !dragging && hoveredId !== null
      ? (blockById.get(hoveredId) ?? null)
      : null

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    // The click that ends a drag is not a click on the canvas.
    if (consumeDragClick()) return

    const { tool: activeTool, setTool, clearSelection } = useDiagramStore.getState()

    if (activeTool === 'select') {
      // Anything over a block, a connection or the handles was already settled
      // on pointer down; only bare canvas clears, and a modified click never
      // does.
      const target = event.target
      const onChrome =
        target instanceof Element &&
        target.closest(
          '[data-block-id], [data-resize-handle], [data-connection-id], [data-port-side]',
        ) !== null
      if (onChrome || isAdditiveClick(event)) return
      clearSelection()
      return
    }

    const world = screenToWorld(
      { x: event.clientX, y: event.clientY },
      useDiagramStore.getState().viewport,
      measure(),
    )
    const draft = makeBlockAt(activeTool, world)
    // Snap the new block's own corner, so a freshly created block sits on the
    // grid rather than wherever the click happened to land. Alt inverts, the
    // same way it does mid-drag.
    const { snapToGrid } = useDiagramStore.getState()
    const position =
      snapToGrid !== event.altKey
        ? snapPoint({ x: draft.x, y: draft.y }, GRID_SIZE)
        : { x: draft.x, y: draft.y }

    // Through the history layer rather than the store, so creation is one undo
    // entry that also puts the selection back where it was.
    createBlock({ ...draft, ...position })
    // Creation is one-shot: drop straight back into Select. The tool is UI
    // state, so it stays out of the history — undoing the block must not also
    // hand the user back a tool they have already moved on from.
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
        onPointerOver={handlePointerOver}
        onPointerLeave={() => {
          setHoveredId(null)
        }}
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

          <ConnectionDefs zoom={viewport.zoom} />
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

        {/* Under the blocks, so an arrow never covers the box it points at. */}
        {connections.map((connection) => {
          const source = blockById.get(connection.sourceId)
          const target = blockById.get(connection.targetId)
          // A dangling connection cannot happen — removing a block cascades —
          // but rendering nothing is cheaper than trusting that at paint time.
          if (!source || !target) return null
          return (
            <ConnectionView
              key={connection.id}
              connection={connection}
              source={source}
              target={target}
              selected={selectedConnectionSet.has(connection.id)}
              zoom={viewport.zoom}
            />
          )
        })}

        {blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            selected={selectedSet.has(block.id)}
            onEdit={setEditingId}
          />
        ))}

        {/* Highlights the block a released connection would land on. Drawn as
            an overlay rather than as a BlockView prop so the block component
            stays free of gesture state. */}
        {connectDraft?.target && (
          <rect
            className="connect-target"
            data-testid="connect-target"
            data-connect-target-id={connectDraft.target.id}
            x={connectDraft.target.x}
            y={connectDraft.target.y}
            width={connectDraft.target.width}
            height={connectDraft.target.height}
            rx={4}
            fill="none"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}

        {connectDraft && <GhostConnection draft={connectDraft} />}

        {portsBlock && <BlockPorts block={portsBlock} zoom={viewport.zoom} />}

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
            // One entry per edit, not per keystroke: the draft never touched
            // the store, so this is the first and only value the history sees.
            commitBlockText(editingBlock.id, text)
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
