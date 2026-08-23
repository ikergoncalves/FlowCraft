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
import type { CanvasRect, Point } from '../types'
import {
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
  rectsIntersect,
  resizeRect,
  type Rect,
  type ResizeHandle,
} from '../utils/geometry'

/** `PointerEvent.button` — which button changed state, not a bitmask. */
const BUTTON_LEFT = 0
const BUTTON_MIDDLE = 1

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
  | { mode: 'move'; origin: Record<string, Point> }
  | { mode: 'resize'; id: string; handle: ResizeHandle; rect: Rect }
  | { mode: 'marquee'; originWorld: Point; additive: boolean }

/** The mode kept in the session ref and consulted on every later frame. */
export type DragMode = DragSession['mode']

const IDLE: DragSession = { mode: 'none' }

export interface CanvasGestures {
  /** Wire to the `<svg>`'s `onPointerDown`; decides the mode for the gesture. */
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void
  /** The live marquee box in world space, or `null` when none is being drawn. */
  marquee: Rect | null
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
  const [dragging, setDragging] = useState(false)
  // Set once a gesture actually moves, so the click that ends it is ignored.
  const movedRef = useRef(false)

  const showMarquee = useCallback((rect: Rect | null) => {
    marqueeRef.current = rect
    setMarquee(rect)
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
      return { mode: 'move', origin: positionSnapshot(useDiagramStore.getState()) }
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

  /** Applies the marquee to the selection and tears the gesture down. */
  function endSession(shiftKey: boolean): void {
    const session = sessionRef.current
    const rect = marqueeRef.current
    sessionRef.current = IDLE
    setDragging(false)
    showMarquee(null)

    // A marquee that never moved is a plain click; the click handler owns it.
    if (session.mode !== 'marquee' || rect === null) return

    const state = useDiagramStore.getState()
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

    const state = useDiagramStore.getState()
    if (session.mode === 'move') {
      state.setBlockPositions(session.origin)
    } else if (session.mode === 'resize') {
      state.updateBlock(session.id, session.rect)
    }
    // A pan has nothing to rewind: the viewport is view state, not document
    // state, and restoring it would also undo any zoom done mid-pan.
  }, [showMarquee])

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
        movement: [mx, my],
        delta: [dx, dy],
        xy: [px, py],
        active,
        first,
        shiftKey,
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

        switch (session.mode) {
          case 'pan': {
            // The only mode driven by the per-frame delta rather than a
            // snapshot: a pan has no start state worth preserving, and
            // integrating deltas keeps it correct if the zoom changes mid-pan.
            if (dx === 0 && dy === 0) return
            useDiagramStore.getState().setViewport(panByScreenDelta(viewport, dx, dy))
            return
          }

          case 'move': {
            const delta = screenDeltaToWorld({ x: mx, y: my }, viewport.zoom)
            const positions: Record<string, Point> = {}
            for (const [id, start] of Object.entries(session.origin)) {
              positions[id] = { x: start.x + delta.x, y: start.y + delta.y }
            }
            useDiagramStore.getState().setBlockPositions(positions)
            return
          }

          case 'resize': {
            const delta = screenDeltaToWorld({ x: mx, y: my }, viewport.zoom)
            useDiagramStore.getState().updateBlock(
              session.id,
              resizeRect(session.rect, session.handle, delta, {
                preserveAspect: shiftKey,
              }),
            )
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

  return { onPointerDown, marquee, dragging, consumeDragClick }
}
