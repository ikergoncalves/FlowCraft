import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { useGesture } from '@use-gesture/react'
import { useDiagramStore, type DiagramState } from '../store/diagramStore'
import type { AnchorSide, Block, CanvasRect, Point } from '../types'
import { ANCHOR_SIDES } from '../types'
import {
  GRID_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  panByScreenDelta,
  screenDeltaToWorld,
  screenToWorld,
  zoomAtPoint,
  zoomFactorForWheel,
} from '../utils/coords'
import {
  RESIZE_HANDLES,
  normalizeRect,
  rectContainsPoint,
  rectsIntersect,
  resizeRect,
  type Rect,
  type ResizeHandle,
} from '../utils/geometry'
import { snapPoint } from '../utils/snap'
import type { ConnectDraft } from '../components/GhostConnection'

/** `PointerEvent.button` — which button changed state, not a bitmask. */
const BUTTON_LEFT = 0
const BUTTON_MIDDLE = 1

/**
 * Pixels the pointer must travel before a press counts as a drag rather than
 * a click.
 *
 * It is a deadzone and nothing more: once crossed, gestures work from the
 * pointer's full travel, so the threshold is never subtracted from what the
 * user sees moving. Exported because it is a visible part of the gesture
 * contract, and tests assert against it.
 */
export const DRAG_TAP_THRESHOLD = 3

/**
 * Everything a gesture needs to remember from the instant it began.
 *
 * Each mode works from this snapshot plus the pointer's *accumulated* screen
 * delta, never from the live store. That keeps floating point error from
 * compounding frame by frame, and — more importantly — leaves Phase 4 with a
 * clean "state before → state after" pair, so one drag becomes one reversible
 * Command instead of one per animation frame.
 */
type DragSession =
  | { mode: 'none' }
  | { mode: 'pan' }
  /** `anchorId` is the block the pointer actually grabbed — the one snap follows. */
  | { mode: 'move'; origin: Record<string, Point>; anchorId: string }
  | { mode: 'resize'; id: string; handle: ResizeHandle; rect: Rect }
  | { mode: 'marquee'; originWorld: Point; additive: boolean }
  | { mode: 'connect'; sourceId: string; sourceAnchor: AnchorSide }

/** The mode kept in the session ref and consulted on every later frame. */
export type DragMode = DragSession['mode']

const IDLE: DragSession = { mode: 'none' }

export interface CanvasGestures {
  /** Wire to the `<svg>`'s `onPointerDown`; decides the mode for the gesture. */
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void
  /** The live marquee box in world space, or `null` when none is being drawn. */
  marquee: Rect | null
  /** The connection being dragged out of a port, or `null` when none is. */
  connectDraft: ConnectDraft | null
  /** True while a gesture is actually moving — drives the grabbing cursor. */
  dragging: boolean
  /**
   * Whether the click now being dispatched merely ended a drag, in which case
   * the canvas must not also create a block or clear the selection. Reading
   * it consumes the flag.
   */
  consumeDragClick: () => boolean
}

/** Modifier that means "add to / subtract from" rather than "replace". */
function isAdditive(event: {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey
}

function isResizeHandle(value: string): value is ResizeHandle {
  return (RESIZE_HANDLES as readonly string[]).includes(value)
}

function attributeOf(target: EventTarget | null, attribute: string): string | null {
  if (!(target instanceof Element)) return null
  return target.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null
}

function isAnchorSide(value: string): value is AnchorSide {
  return (ANCHOR_SIDES as readonly string[]).includes(value)
}

/** Where every selected block sits right now — the seed for a move. */
function positionSnapshot(state: DiagramState): Record<string, Point> {
  const origin: Record<string, Point> = {}
  for (const id of state.selectedIds) {
    const block = state.blocks[id]
    if (block) origin[id] = { x: block.x, y: block.y }
  }
  return origin
}

/**
 * The snap step this frame should use, or `null` for no snapping.
 *
 * Alt inverts whatever the toolbar says, for the duration of the gesture only.
 * It is read here, from the live gesture state, rather than through
 * `useEditorShortcuts` — that hook ignores `altKey` on purpose, so that held
 * modifiers never leak into the global shortcut table.
 */
function snapStepFor(altKey: boolean): number | null {
  const enabled = useDiagramStore.getState().snapToGrid !== altKey
  return enabled ? GRID_SIZE : null
}

/**
 * The topmost block containing `point`, by geometry rather than by `closest()`.
 *
 * Hit testing a drop target cannot go through `event.target`: once a drag
 * starts the pointer is captured by the `<svg>`, so every later event reports
 * the canvas itself no matter what is underneath. Walking `blockOrder`
 * backwards gives the block painted last, which is the one the user sees on
 * top.
 */
function blockUnder(state: DiagramState, point: Point): Block | null {
  for (let i = state.blockOrder.length - 1; i >= 0; i -= 1) {
    const id = state.blockOrder[i]
    const block = id === undefined ? undefined : state.blocks[id]
    if (block && rectContainsPoint(block, point)) return block
  }
  return null
}

/**
 * Every pointer gesture over the canvas, as a single handler on the `<svg>`.
 *
 * One listener decides the mode once, at the start of the gesture, and stores
 * it in a ref that later frames consult. Binding a `useGesture` per block
 * would mean hundreds of listeners on a real diagram, which is exactly what
 * Phase 7 would then have to undo.
 *
 * Handlers read the store through `getState()` rather than closing over it, so
 * they never see a stale snapshot and never need re-binding.
 */
export function useCanvasGestures(
  svgRef: RefObject<SVGSVGElement | null>,
  measure: () => CanvasRect,
  spacePressedRef: RefObject<boolean>,
): CanvasGestures {
  const sessionRef = useRef<DragSession>(IDLE)
  const marqueeRef = useRef<Rect | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const draftRef = useRef<ConnectDraft | null>(null)
  const [connectDraft, setConnectDraft] = useState<ConnectDraft | null>(null)
  const [dragging, setDragging] = useState(false)
  // Set once a gesture actually moves, so the click that ends it is ignored.
  const movedRef = useRef(false)

  const showMarquee = useCallback((rect: Rect | null) => {
    marqueeRef.current = rect
    setMarquee(rect)
  }, [])

  const showDraft = useCallback((draft: ConnectDraft | null) => {
    draftRef.current = draft
    setConnectDraft(draft)
  }, [])

  // Deliberately not memoised: it closes over `measure`, whose identity
  // changes whenever the canvas is re-measured, and a stale one would convert
  // the marquee origin against the wrong canvas box.
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    movedRef.current = false
    sessionRef.current = beginSession(event)
  }

  /**
   * Classifies the gesture and applies any selection change that belongs to
   * the press itself — clicking an unselected block selects it *before* the
   * snapshot is taken, so the drag moves what the user just grabbed.
   */
  function beginSession(event: ReactPointerEvent<SVGSVGElement>): DragSession {
    if (event.button === BUTTON_MIDDLE) return { mode: 'pan' }
    if (event.button !== BUTTON_LEFT) return IDLE
    if (spacePressedRef.current) return { mode: 'pan' }

    const state = useDiagramStore.getState()
    // With a creation tool there is nothing to select or move, so a drag over
    // the canvas keeps its Phase 1 meaning.
    if (state.tool !== 'select') return { mode: 'pan' }

    // Ports are checked before anything else: they sit on a block's edge, so
    // any later test would happily claim the same press.
    const portSide = attributeOf(event.target, 'data-port-side')
    const portBlock = attributeOf(event.target, 'data-port-block')
    if (portSide !== null && isAnchorSide(portSide) && portBlock !== null) {
      if (portBlock in state.blocks) {
        return { mode: 'connect', sourceId: portBlock, sourceAnchor: portSide }
      }
    }

    const connectionId = attributeOf(event.target, 'data-connection-id')
    if (connectionId !== null && connectionId in state.connections) {
      // Selecting an arrow is the whole gesture — arrows are not draggable,
      // their geometry belongs to the blocks they join.
      if (isAdditive(event)) state.toggleConnectionSelection(connectionId)
      else state.selectConnections(connectionId)
      return IDLE
    }

    const handle = attributeOf(event.target, 'data-resize-handle')
    if (handle !== null && isResizeHandle(handle)) {
      const id = state.selectedIds[0]
      const block = id === undefined ? undefined : state.blocks[id]
      // Handles only render for a single selection, so this is that block.
      if (block && state.selectedIds.length === 1) {
        return {
          mode: 'resize',
          id: block.id,
          handle,
          rect: { x: block.x, y: block.y, width: block.width, height: block.height },
        }
      }
    }

    const blockId = attributeOf(event.target, 'data-block-id')
    if (blockId !== null && blockId in state.blocks) {
      if (isAdditive(event)) {
        // A modified click edits the selection and stops there; dragging a
        // block in or out of a selection at the same time reads as a slip.
        state.toggleSelection(blockId)
        return IDLE
      }
      // Grabbing an unselected block replaces the selection with it; grabbing
      // one that is already selected moves the whole selection.
      if (!state.selectedIds.includes(blockId)) state.select(blockId)
      return {
        mode: 'move',
        origin: positionSnapshot(useDiagramStore.getState()),
        anchorId: blockId,
      }
    }

    return {
      mode: 'marquee',
      originWorld: screenToWorld(
        { x: event.clientX, y: event.clientY },
        state.viewport,
        measure(),
      ),
      additive: isAdditive(event),
    }
  }

  /**
   * Commits whatever the gesture was building and tears it down.
   *
   * This is the one place a gesture's result reaches the store as a finished
   * thing, which makes it Phase 4's hook for emitting a single Command per
   * gesture rather than one per frame.
   */
  function endSession(shiftKey: boolean): void {
    const session = sessionRef.current
    const rect = marqueeRef.current
    const draft = draftRef.current
    sessionRef.current = IDLE
    setDragging(false)
    showMarquee(null)
    showDraft(null)

    if (session.mode === 'connect') {
      // Released over empty canvas, or over the source itself: no connection,
      // no complaint. The store rejects a self-link anyway; bailing here keeps
      // the intent explicit.
      const target = draft?.target
      if (!target || target.id === session.sourceId) return
      useDiagramStore.getState().addConnection({
        sourceId: session.sourceId,
        targetId: target.id,
        sourceAnchor: session.sourceAnchor,
      })
      return
    }

    // A marquee that never moved is a plain click; the click handler owns it.
    if (session.mode !== 'marquee' || rect === null) return

    const state = useDiagramStore.getState()
    // Blocks only. A marquee that also swept up every arrow crossing it would
    // make Delete unpredictable, and connections have no geometry of their own
    // to move or resize once selected.
    const hits = state.blockOrder.filter((id) => {
      const block = state.blocks[id]
      return block !== undefined && rectsIntersect(rect, block)
    })

    // Additive keeps what was there — so an empty additive marquee is a
    // no-op, while an empty plain one clears.
    if (session.additive || shiftKey) state.addToSelection(hits)
    else state.select(hits)
  }

  /**
   * Puts a cancelled gesture back exactly where it started.
   *
   * Touches nothing but refs, stable setters and `getState()`, which is what
   * lets the Escape listener below bind once and still be correct.
   */
  const cancelSession = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = IDLE
    setDragging(false)
    showMarquee(null)
    // A cancelled connect drag has nothing to undo — the connection was never
    // created — so dropping the ghost is the whole rewind.
    showDraft(null)

    const state = useDiagramStore.getState()
    if (session.mode === 'move') {
      state.setBlockPositions(session.origin)
    } else if (session.mode === 'resize') {
      state.updateBlock(session.id, session.rect)
    }
    // A pan has nothing to rewind: the viewport is view state, not document
    // state, and restoring it would also undo any zoom done mid-pan.
  }, [showMarquee, showDraft])

  useGesture(
    {
      onWheel: ({ event }) => {
        // A trackpad pinch arrives as ctrl+wheel and is handled by onPinch.
        if (event.ctrlKey) return
        event.preventDefault()

        const { viewport, setViewport } = useDiagramStore.getState()
        const factor = zoomFactorForWheel(event.deltaY, event.deltaMode)
        setViewport(
          zoomAtPoint(
            viewport,
            { x: event.clientX, y: event.clientY },
            measure(),
            viewport.zoom * factor,
          ),
        )
      },

      onPinch: ({ origin: [originX, originY], offset: [scale], event }) => {
        event.preventDefault()
        const { viewport, setViewport } = useDiagramStore.getState()
        setViewport(zoomAtPoint(viewport, { x: originX, y: originY }, measure(), scale))
      },

      onDrag: ({
        delta: [dx, dy],
        xy: [px, py],
        initial: [ix, iy],
        active,
        first,
        shiftKey,
        altKey,
      }) => {
        if (!active) {
          endSession(shiftKey)
          return
        }

        const session = sessionRef.current
        if (session.mode === 'none') return
        if (first) setDragging(true)
        movedRef.current = true

        const { viewport } = useDiagramStore.getState()

        // The pointer's true travel since the press, *not* `movement`.
        //
        // @use-gesture latches the tap threshold the moment a drag turns
        // intentional and subtracts it from `movement` for the rest of the
        // gesture, so a block would trail the cursor by DRAG_TAP_THRESHOLD
        // pixels forever — measured at a constant 3px in Chrome, and it never
        // catches up, not even after the drag reverses. `xy - initial` is the
        // uncompensated travel, so the grabbed thing stays glued to the
        // cursor. Taps are still filtered: this handler only runs once the
        // gesture has already crossed the threshold.
        const travel = { x: px - ix, y: py - iy }

        switch (session.mode) {
          case 'pan': {
            // The only mode driven by the per-frame delta rather than a
            // snapshot: a pan has no start state worth preserving, and
            // integrating deltas keeps it correct if the zoom changes mid-pan.
            // The very first frame uses the raw travel instead, because that
            // is the one frame whose delta is short by the tap threshold.
            const panX = first ? travel.x : dx
            const panY = first ? travel.y : dy
            if (panX === 0 && panY === 0) return
            useDiagramStore.getState().setViewport(panByScreenDelta(viewport, panX, panY))
            return
          }

          case 'move': {
            const delta = screenDeltaToWorld(travel, viewport.zoom)
            const step = snapStepFor(altKey)
            const anchorStart = session.origin[session.anchorId]

            /*
             * Snap the block the user grabbed, then shift the rest of the
             * selection by that same corrected delta.
             *
             * Snapping each block on its own would pull them all onto the
             * lattice independently and quietly collapse the gaps between
             * them — a selection of blocks 30 units apart would end up 20 or
             * 40 apart. Deriving one delta from one block keeps the whole
             * selection rigid, which is what a move is supposed to be.
             */
            let effective = delta
            if (step !== null && anchorStart) {
              const snapped = snapPoint(
                { x: anchorStart.x + delta.x, y: anchorStart.y + delta.y },
                step,
              )
              effective = { x: snapped.x - anchorStart.x, y: snapped.y - anchorStart.y }
            }

            const positions: Record<string, Point> = {}
            for (const [id, start] of Object.entries(session.origin)) {
              positions[id] = { x: start.x + effective.x, y: start.y + effective.y }
            }
            useDiagramStore.getState().setBlockPositions(positions)
            return
          }

          case 'resize': {
            const delta = screenDeltaToWorld(travel, viewport.zoom)
            const step = snapStepFor(altKey)
            useDiagramStore.getState().updateBlock(
              session.id,
              resizeRect(session.rect, session.handle, delta, {
                preserveAspect: shiftKey,
                // Shift means "exact ratio"; snapping both edges would break
                // it, so the two modifiers do not stack.
                ...(step !== null && !shiftKey ? { snapStep: step } : {}),
              }),
            )
            return
          }

          case 'connect': {
            const state = useDiagramStore.getState()
            const source = state.blocks[session.sourceId]
            if (!source) return

            const pointer = screenToWorld({ x: px, y: py }, viewport, measure())
            const hovered = blockUnder(state, pointer)
            showDraft({
              source,
              sourceAnchor: session.sourceAnchor,
              pointer,
              // The source is not a legal target, so it never highlights.
              target: hovered && hovered.id !== session.sourceId ? hovered : null,
            })
            return
          }

          case 'marquee': {
            // Tracks the raw pointer rather than the deadzone-corrected
            // movement, so the box lands exactly under the cursor.
            const corner = screenToWorld({ x: px, y: py }, viewport, measure())
            showMarquee(normalizeRect(session.originWorld, corner))
            return
          }
        }
      },
    },
    {
      target: svgRef,
      eventOptions: { passive: false },
      drag: {
        // Accept middle-button drags, not just the left button; which button
        // means what is decided in `beginSession`.
        pointer: { buttons: -1 },
        filterTaps: true,
        tapsThreshold: DRAG_TAP_THRESHOLD,
      },
      pinch: {
        scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM },
        from: () => [useDiagramStore.getState().viewport.zoom, 0],
      },
    },
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (sessionRef.current.mode === 'none') return
      // Capture phase plus stopPropagation: the global Escape shortcut clears
      // the selection, which is the last thing a cancelled drag wants.
      event.preventDefault()
      event.stopPropagation()
      cancelSession()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [cancelSession])

  const consumeDragClick = useCallback(() => {
    const moved = movedRef.current
    movedRef.current = false
    return moved
  }, [])

  return { onPointerDown, marquee, connectDraft, dragging, consumeDragClick }
}
