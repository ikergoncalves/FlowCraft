import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useDiagramStore } from '../store/diagramStore'
import { DRAG_TAP_THRESHOLD } from '../hooks/useCanvasGestures'
import type { Block } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { MIN_BLOCK_SIZE } from '../utils/geometry'

/*
 * Direct manipulation: moving, multi-select, marquee and resize.
 *
 * jsdom does no hit testing, so a pointer event lands on whichever element the
 * test names — which is exactly what the canvas's `closest()` hit test reads.
 * These therefore drive the real gesture handler rather than a stand-in.
 */

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

const CANVAS_BOX: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: CANVAS_WIDTH,
  bottom: CANVAS_HEIGHT,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  toJSON: () => ({}),
}

beforeAll(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    // These tests are about how a gesture tracks the pointer, so snapping is
    // off: with it on, every expected coordinate would be rounded to the grid
    // and the assertions would stop measuring tracking at all. Snapping has
    // its own suite in Connections.test.tsx.
    snapToGrid: false,
  })
})

const getCanvas = () => screen.getByTestId('canvas')

interface BlockSpec {
  x: number
  y: number
  width?: number
  height?: number
}

/** Seeds blocks straight through the store, for exact geometry. */
const seed = (...specs: BlockSpec[]): Block[] => {
  let created: Block[] = []
  act(() => {
    created = specs.map((spec) =>
      useDiagramStore.getState().addBlock({
        type: 'rect',
        x: spec.x,
        y: spec.y,
        width: spec.width ?? 100,
        height: spec.height ?? 60,
        text: 'Block',
      }),
    )
  })
  return created
}

const required = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`missing ${what}`)
  return value
}

const blockElement = (id: string): Element =>
  required(
    getCanvas().querySelector(`[data-block-id="${id}"]`) ?? undefined,
    `rendered block ${id}`,
  )

const handleElement = (handle: string): Element =>
  required(
    getCanvas().querySelector(`[data-resize-handle="${handle}"]`) ?? undefined,
    `${handle} resize handle`,
  )

const blockAt = (id: string) => useDiagramStore.getState().blocks[id]
const selection = () => useDiagramStore.getState().selectedIds

interface DragOptions {
  shiftKey?: boolean
  ctrlKey?: boolean
  button?: number
  /** Runs after the move but before the release. */
  midDrag?: () => void
  /** Leaves the gesture in flight instead of releasing. */
  hold?: boolean
}

const dragFrom = (
  target: Element,
  from: { x: number; y: number },
  by: { x: number; y: number },
  options: DragOptions = {},
) => {
  const modifiers = {
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
  }
  const to = { x: from.x + by.x, y: from.y + by.y }

  fireEvent.pointerDown(target, {
    clientX: from.x,
    clientY: from.y,
    button: options.button ?? 0,
    buttons: 1,
    ...modifiers,
  })
  fireEvent.pointerMove(getCanvas(), {
    clientX: to.x,
    clientY: to.y,
    buttons: 1,
    ...modifiers,
  })
  options.midDrag?.()
  if (options.hold) return
  fireEvent.pointerUp(getCanvas(), {
    clientX: to.x,
    clientY: to.y,
    buttons: 0,
    ...modifiers,
  })
}

/**
 * How far the diagram actually moves for a given pointer travel.
 *
 * `DRAG_TAP_THRESHOLD` is a deadzone: travel under it is a click and moves
 * nothing, and anything past it moves the *full* distance rather than the
 * distance less the threshold. See the drag-tracking tests below.
 */
const applied = (screenDelta: number, zoom = 1) => {
  if (Math.abs(screenDelta) < DRAG_TAP_THRESHOLD) return 0
  return screenDelta / zoom
}

describe('moving blocks', () => {
  it('drags a block and writes the new position to the store', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    dragFrom(blockElement(block.id), { x: 150, y: 130 }, { x: 80, y: -40 })

    expect(blockAt(block.id)?.x).toBeCloseTo(100 + applied(80), 6)
    expect(blockAt(block.id)?.y).toBeCloseTo(100 + applied(-40), 6)
  })

  it('keeps the block exactly under the cursor, with no threshold lag', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    // Grabbed dead centre, so the block's centre must stay on the pointer for
    // the whole drag rather than trailing it by DRAG_TAP_THRESHOLD.
    dragFrom(blockElement(block.id), { x: 150, y: 130 }, { x: 200, y: 140 })

    const moved = required(blockAt(block.id), 'moved')
    expect(moved.x + moved.width / 2).toBeCloseTo(350, 6)
    expect(moved.y + moved.height / 2).toBeCloseTo(270, 6)
  })

  it('does not overshoot when the drag reverses past its starting point', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    // Out to the right first — latching the threshold — then well back to the
    // left. A latched threshold would leave the block 3px off in world units.
    fireEvent.pointerDown(blockElement(block.id), {
      clientX: 150,
      clientY: 130,
      button: 0,
      buttons: 1,
    })
    fireEvent.pointerMove(getCanvas(), { clientX: 250, clientY: 130, buttons: 1 })
    fireEvent.pointerMove(getCanvas(), { clientX: 70, clientY: 130, buttons: 1 })
    fireEvent.pointerUp(getCanvas(), { clientX: 70, clientY: 130, buttons: 0 })

    // Pointer travelled -80px, so the block must sit at exactly 100 - 80.
    expect(blockAt(block.id)?.x).toBeCloseTo(20, 6)
  })

  it('treats travel under the threshold as a click that moves nothing', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    dragFrom(blockElement(block.id), { x: 150, y: 130 }, { x: 2, y: 2 })

    expect(blockAt(block.id)).toMatchObject({ x: 100, y: 100 })
  })

  it('leaves the block size untouched while moving', () => {
    render(<App />)
    const block = required(seed({ x: 0, y: 0, width: 140, height: 70 })[0], 'block')

    dragFrom(blockElement(block.id), { x: 50, y: 20 }, { x: 60, y: 60 })

    expect(blockAt(block.id)).toMatchObject({ width: 140, height: 70 })
  })

  it('selects an unselected block before moving it, replacing the selection', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 300, y: 0 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    act(() => {
      useDiagramStore.getState().select(first.id)
    })

    dragFrom(blockElement(second.id), { x: 350, y: 30 }, { x: 40, y: 0 })

    expect(selection()).toEqual([second.id])
    expect(blockAt(first.id)?.x).toBe(0)
    expect(blockAt(second.id)?.x).toBeCloseTo(300 + applied(40), 6)
  })

  it('moves the whole selection and preserves the gaps between blocks', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 250, y: 120 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    act(() => {
      useDiagramStore.getState().select([first.id, second.id])
    })

    dragFrom(blockElement(first.id), { x: 50, y: 30 }, { x: 90, y: 45 })

    const movedA = required(blockAt(first.id), 'moved a')
    const movedB = required(blockAt(second.id), 'moved b')
    expect(movedA.x).toBeCloseTo(applied(90), 6)
    expect(movedB.x).toBeCloseTo(250 + applied(90), 6)
    expect(movedB.x - movedA.x).toBeCloseTo(250, 6)
    expect(movedB.y - movedA.y).toBeCloseTo(120, 6)
  })

  it('tracks the pointer one-for-one in world units when zoomed in', () => {
    render(<App />)
    const block = required(seed({ x: 0, y: 0 })[0], 'block')
    act(() => {
      useDiagramStore.getState().setViewport({ x: 0, y: 0, zoom: 2 })
    })

    dragFrom(blockElement(block.id), { x: 20, y: 20 }, { x: 100, y: 50 })

    // 100 screen px at 2x is 50 world units, one-for-one with the pointer.
    expect(blockAt(block.id)?.x).toBeCloseTo(applied(100, 2), 6)
    expect(blockAt(block.id)?.y).toBeCloseTo(applied(50, 2), 6)
  })

  it('restores the starting positions when Escape cancels the drag', () => {
    render(<App />)
    const [a, b] = seed({ x: 10, y: 20 }, { x: 200, y: 20 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    act(() => {
      useDiagramStore.getState().select([first.id, second.id])
    })

    dragFrom(
      blockElement(first.id),
      { x: 50, y: 40 },
      { x: 120, y: 90 },
      {
        hold: true,
        midDrag: () => {
          // The drag really did move things before the cancel.
          expect(blockAt(first.id)?.x).not.toBe(10)
          fireEvent.keyDown(document.body, { key: 'Escape' })
        },
      },
    )
    fireEvent.pointerUp(getCanvas(), { clientX: 170, clientY: 130, buttons: 0 })

    expect(blockAt(first.id)).toMatchObject({ x: 10, y: 20 })
    expect(blockAt(second.id)).toMatchObject({ x: 200, y: 20 })
    // Escape was consumed by the gesture rather than falling through to the
    // global shortcut, so the selection survives the cancel.
    expect(selection()).toEqual([first.id, second.id])
  })

  it('ignores further pointer movement after a cancel', () => {
    render(<App />)
    const block = required(seed({ x: 10, y: 20 })[0], 'block')

    fireEvent.pointerDown(blockElement(block.id), {
      clientX: 50,
      clientY: 40,
      button: 0,
      buttons: 1,
    })
    fireEvent.pointerMove(getCanvas(), { clientX: 150, clientY: 140, buttons: 1 })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.pointerMove(getCanvas(), { clientX: 400, clientY: 400, buttons: 1 })
    fireEvent.pointerUp(getCanvas(), { clientX: 400, clientY: 400, buttons: 0 })

    expect(blockAt(block.id)).toMatchObject({ x: 10, y: 20 })
  })

  it('does not clear the selection on the click that ends a drag', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    dragFrom(blockElement(block.id), { x: 150, y: 130 }, { x: 60, y: 60 })
    // The browser fires a click after the pointer-up that ended the drag.
    fireEvent.click(getCanvas(), { clientX: 210, clientY: 190 })

    expect(selection()).toEqual([block.id])
  })
})

describe('selecting blocks', () => {
  it('does not clear the selection when clicking a block with Select active', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    fireEvent.pointerDown(blockElement(block.id), { clientX: 150, clientY: 130 })
    // The click bubbles from the block up to the canvas handler; it must not
    // be mistaken for a click on empty canvas.
    fireEvent.click(blockElement(block.id), { clientX: 150, clientY: 130 })

    expect(selection()).toEqual([block.id])
    expect(screen.getByTestId('block-selection')).toBeInTheDocument()
  })

  it('adds a block with shift + click and removes it on a second shift + click', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 300, y: 0 })
    const first = required(a, 'a')
    const second = required(b, 'b')

    fireEvent.pointerDown(blockElement(first.id), { clientX: 50, clientY: 30 })
    expect(selection()).toEqual([first.id])

    const shiftClick = () => {
      fireEvent.pointerDown(blockElement(second.id), {
        clientX: 350,
        clientY: 30,
        shiftKey: true,
      })
    }

    shiftClick()
    expect(selection()).toEqual([first.id, second.id])

    shiftClick()
    expect(selection()).toEqual([first.id])
  })

  it('treats ctrl + click the same way, for the Windows habit', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 300, y: 0 })
    const first = required(a, 'a')
    const second = required(b, 'b')

    fireEvent.pointerDown(blockElement(first.id), { clientX: 50, clientY: 30 })
    fireEvent.pointerDown(blockElement(second.id), {
      clientX: 350,
      clientY: 30,
      ctrlKey: true,
    })

    expect(selection()).toEqual([first.id, second.id])
  })

  it('draws a bounding box once more than one block is selected', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 300, y: 200 })
    const first = required(a, 'a')
    const second = required(b, 'b')

    fireEvent.pointerDown(blockElement(first.id), { clientX: 50, clientY: 30 })
    expect(screen.queryByTestId('selection-bounds')).not.toBeInTheDocument()

    fireEvent.pointerDown(blockElement(second.id), {
      clientX: 350,
      clientY: 230,
      shiftKey: true,
    })

    const bounds = screen.getByTestId('selection-bounds')
    // Spans both blocks: (0,0) to (400,260).
    expect(bounds).toHaveAttribute('width', '400')
    expect(bounds).toHaveAttribute('height', '260')
    expect(bounds).toHaveAttribute('vector-effect', 'non-scaling-stroke')
  })

  it('selects everything with Ctrl + A', async () => {
    const user = userEvent.setup()
    render(<App />)
    const created = seed({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 })

    await user.keyboard('{Control>}a{/Control}')

    expect(selection()).toEqual(created.map((block) => block.id))
  })

  it('still ignores other modified keystrokes', async () => {
    const user = userEvent.setup()
    render(<App />)
    seed({ x: 0, y: 0 })

    await user.keyboard('{Control>}r{/Control}')

    expect(useDiagramStore.getState().tool).toBe('select')
  })

  it('deletes every selected block with Delete', async () => {
    const user = userEvent.setup()
    render(<App />)
    seed({ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 })
    act(() => {
      useDiagramStore.getState().selectAll()
    })
    expect(selection()).toHaveLength(3)

    await user.keyboard('{Delete}')

    expect(screen.queryAllByTestId('block')).toHaveLength(0)
    expect(selection()).toEqual([])
  })
})

describe('marquee selection', () => {
  const threeBlocks = () => seed({ x: 50, y: 50 }, { x: 200, y: 50 }, { x: 600, y: 400 })

  it('draws a marquee only once the drag is under way, and clears it on release', () => {
    render(<App />)
    threeBlocks()

    fireEvent.pointerDown(getCanvas(), {
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: 1,
    })
    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()

    fireEvent.pointerMove(getCanvas(), { clientX: 300, clientY: 200, buttons: 1 })
    expect(screen.getByTestId('marquee')).toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    )

    fireEvent.pointerUp(getCanvas(), { clientX: 300, clientY: 200, buttons: 0 })
    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
  })

  it('selects exactly the blocks the marquee crosses', () => {
    render(<App />)
    const [a, b] = threeBlocks()

    dragFrom(getCanvas(), { x: 10, y: 10 }, { x: 290, y: 190 })

    expect(selection()).toEqual([required(a, 'a').id, required(b, 'b').id])
  })

  it('selects on intersection, not containment', () => {
    render(<App />)
    const [a] = threeBlocks()

    // Clips the top-left corner of the first block and nothing else.
    dragFrom(getCanvas(), { x: 20, y: 20 }, { x: 60, y: 60 })

    expect(selection()).toEqual([required(a, 'a').id])
  })

  it('replaces the previous selection by default', () => {
    render(<App />)
    const [a, b, c] = threeBlocks()
    act(() => {
      useDiagramStore.getState().select(required(c, 'c').id)
    })

    dragFrom(getCanvas(), { x: 10, y: 10 }, { x: 290, y: 190 })

    expect(selection()).toEqual([required(a, 'a').id, required(b, 'b').id])
  })

  it('adds to the selection when shift is held', () => {
    render(<App />)
    const [a, b, c] = threeBlocks()
    act(() => {
      useDiagramStore.getState().select(required(c, 'c').id)
    })

    dragFrom(getCanvas(), { x: 10, y: 10 }, { x: 290, y: 190 }, { shiftKey: true })

    expect(selection()).toEqual([
      required(c, 'c').id,
      required(a, 'a').id,
      required(b, 'b').id,
    ])
  })

  it('clears the selection when it catches nothing', () => {
    render(<App />)
    const [a] = threeBlocks()
    act(() => {
      useDiagramStore.getState().select(required(a, 'a').id)
    })

    dragFrom(getCanvas(), { x: 400, y: 30 }, { x: 100, y: 100 })

    expect(selection()).toEqual([])
  })

  it('keeps the selection when an empty marquee is additive', () => {
    render(<App />)
    const [a] = threeBlocks()
    act(() => {
      useDiagramStore.getState().select(required(a, 'a').id)
    })

    dragFrom(getCanvas(), { x: 400, y: 30 }, { x: 100, y: 100 }, { shiftKey: true })

    expect(selection()).toEqual([required(a, 'a').id])
  })

  it('hit tests in world space, so pan and zoom are accounted for', () => {
    render(<App />)
    const [, , c] = threeBlocks()
    act(() => {
      useDiagramStore.getState().setViewport({ x: 500, y: 350, zoom: 2 })
    })

    // Screen (10,10)-(310,210) is world (505,355)-(655,455); only the third
    // block lives out there.
    dragFrom(getCanvas(), { x: 10, y: 10 }, { x: 300, y: 200 })

    expect(selection()).toEqual([required(c, 'c').id])
  })
})

describe('resize handles', () => {
  const selectOne = (spec: BlockSpec): Block => {
    const block = required(seed(spec)[0], 'block')
    act(() => {
      useDiagramStore.getState().select(block.id)
    })
    return block
  }

  it('shows eight handles for a single selection', () => {
    render(<App />)
    selectOne({ x: 100, y: 100 })

    const handles = screen.getAllByTestId('resize-handle')
    expect(handles).toHaveLength(8)
    expect(handles.map((handle) => handle.getAttribute('data-resize-handle'))).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ])
  })

  it('hides the handles with nothing selected', () => {
    render(<App />)
    seed({ x: 100, y: 100 })

    expect(screen.queryAllByTestId('resize-handle')).toHaveLength(0)
  })

  it('hides the handles once a second block joins the selection', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 300, y: 200 })
    act(() => {
      useDiagramStore.getState().select(required(a, 'a').id)
    })
    expect(screen.getAllByTestId('resize-handle')).toHaveLength(8)

    act(() => {
      useDiagramStore.getState().addToSelection(required(b, 'b').id)
    })

    expect(screen.queryAllByTestId('resize-handle')).toHaveLength(0)
  })

  it('keeps the handles a constant size on screen at any zoom', () => {
    render(<App />)
    selectOne({ x: 100, y: 100 })

    const widthAt = (zoom: number) => {
      act(() => {
        useDiagramStore.getState().setViewport({ x: 0, y: 0, zoom })
      })
      return Number(handleElement('nw').getAttribute('width'))
    }

    // The world size halves as the zoom doubles, which is what keeps the
    // painted size the same.
    const atOne = widthAt(1)
    expect(widthAt(2)).toBeCloseTo(atOne / 2, 6)
    expect(widthAt(0.5)).toBeCloseTo(atOne * 2, 6)
  })

  it('resizes from the SE handle, holding the NW corner still', () => {
    render(<App />)
    const block = selectOne({ x: 100, y: 100, width: 200, height: 100 })

    dragFrom(handleElement('se'), { x: 300, y: 200 }, { x: 60, y: 40 })

    expect(blockAt(block.id)).toMatchObject({ x: 100, y: 100 })
    expect(blockAt(block.id)?.width).toBeCloseTo(200 + applied(60), 6)
    expect(blockAt(block.id)?.height).toBeCloseTo(100 + applied(40), 6)
  })

  it('resizes from the NW handle, holding the SE corner still', () => {
    render(<App />)
    const block = selectOne({ x: 100, y: 100, width: 200, height: 100 })

    dragFrom(handleElement('nw'), { x: 100, y: 100 }, { x: 40, y: 20 })

    const resized = required(blockAt(block.id), 'resized')
    expect(resized.x + resized.width).toBeCloseTo(300, 6)
    expect(resized.y + resized.height).toBeCloseTo(200, 6)
    expect(resized.x).toBeCloseTo(100 + applied(40), 6)
  })

  it('resizes only along its own axis from an edge handle', () => {
    render(<App />)
    const block = selectOne({ x: 100, y: 100, width: 200, height: 100 })

    dragFrom(handleElement('e'), { x: 300, y: 150 }, { x: 50, y: 80 })

    expect(blockAt(block.id)?.height).toBe(100)
    expect(blockAt(block.id)?.width).toBeCloseTo(200 + applied(50), 6)
  })

  it('stops at the minimum size instead of inverting the block', () => {
    render(<App />)
    const block = selectOne({ x: 100, y: 100, width: 200, height: 100 })

    dragFrom(handleElement('se'), { x: 300, y: 200 }, { x: -600, y: -600 })

    expect(blockAt(block.id)).toMatchObject({
      x: 100,
      y: 100,
      width: MIN_BLOCK_SIZE,
      height: MIN_BLOCK_SIZE,
    })
  })

  it('preserves the aspect ratio while shift is held', () => {
    render(<App />)
    const block = selectOne({ x: 0, y: 0, width: 200, height: 100 })

    dragFrom(
      handleElement('se'),
      { x: 200, y: 100 },
      { x: 100, y: 3 },
      { shiftKey: true },
    )

    const resized = required(blockAt(block.id), 'resized')
    expect(resized.width).toBeGreaterThan(200)
    expect(resized.width / resized.height).toBeCloseTo(2, 6)
  })

  it('restores the original box when Escape cancels the resize', () => {
    render(<App />)
    const block = selectOne({ x: 100, y: 100, width: 200, height: 100 })

    dragFrom(
      handleElement('se'),
      { x: 300, y: 200 },
      { x: 90, y: 90 },
      {
        hold: true,
        midDrag: () => {
          expect(blockAt(block.id)?.width).not.toBe(200)
          fireEvent.keyDown(document.body, { key: 'Escape' })
        },
      },
    )
    fireEvent.pointerUp(getCanvas(), { clientX: 390, clientY: 290, buttons: 0 })

    expect(blockAt(block.id)).toMatchObject({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    })
    expect(selection()).toEqual([block.id])
  })

  it('does not start a marquee when the drag begins on a handle', () => {
    render(<App />)
    selectOne({ x: 100, y: 100 })

    fireEvent.pointerDown(handleElement('e'), {
      clientX: 200,
      clientY: 130,
      button: 0,
      buttons: 1,
    })
    fireEvent.pointerMove(getCanvas(), { clientX: 260, clientY: 130, buttons: 1 })

    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
  })
})

describe('panning', () => {
  it('pans on a middle-button drag even with the Select tool active', () => {
    render(<App />)
    seed({ x: 0, y: 0 })

    dragFrom(getCanvas(), { x: 400, y: 300 }, { x: 50, y: 30 }, { button: 1 })

    const { viewport } = useDiagramStore.getState()
    expect(viewport.x).toBeCloseTo(-applied(50), 6)
    expect(viewport.y).toBeCloseTo(-applied(30), 6)
    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
  })

  it('pans rather than marqueeing while a creation tool is active', async () => {
    const user = userEvent.setup()
    render(<App />)
    seed({ x: 50, y: 50 })
    await user.click(screen.getByRole('button', { name: /rectangle/i }))

    dragFrom(getCanvas(), { x: 10, y: 10 }, { x: 200, y: 150 })

    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
    expect(useDiagramStore.getState().viewport.x).toBeCloseTo(-applied(200), 6)
    expect(selection()).toEqual([])
  })

  it('does not create a block on the click that ends a pan', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /rectangle/i }))

    dragFrom(getCanvas(), { x: 10, y: 10 }, { x: 200, y: 150 })
    fireEvent.click(getCanvas(), { clientX: 210, clientY: 160 })

    expect(screen.queryAllByTestId('block')).toHaveLength(0)
  })
})

describe('gesture precedence', () => {
  it('pans instead of marqueeing while space is held', () => {
    render(<App />)
    seed({ x: 50, y: 50 })
    fireEvent.keyDown(document.body, { code: 'Space' })

    dragFrom(getCanvas(), { x: 400, y: 300 }, { x: 60, y: 40 })

    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()
    expect(useDiagramStore.getState().viewport.x).toBeCloseTo(-applied(60), 6)

    fireEvent.keyUp(document.body, { code: 'Space' })
  })

  it('pans instead of moving when space is held over a block', () => {
    render(<App />)
    const block = required(seed({ x: 50, y: 50 })[0], 'block')
    fireEvent.keyDown(document.body, { code: 'Space' })

    dragFrom(blockElement(block.id), { x: 80, y: 70 }, { x: 60, y: 40 })

    expect(blockAt(block.id)).toMatchObject({ x: 50, y: 50 })
    expect(useDiagramStore.getState().viewport.x).toBeCloseTo(-applied(60), 6)

    fireEvent.keyUp(document.body, { code: 'Space' })
  })

  it('still clears the selection with Escape when no drag is in flight', () => {
    render(<App />)
    seed({ x: 0, y: 0 }, { x: 200, y: 0 })
    act(() => {
      useDiagramStore.getState().selectAll()
    })

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(selection()).toEqual([])
  })
})
