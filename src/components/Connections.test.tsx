import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useDiagramStore } from '../store/diagramStore'
import type { Block } from '../types'
import { DEFAULT_VIEWPORT, GRID_SIZE } from '../utils/coords'

/*
 * Connections and snap-to-grid, driven through the real gesture handler.
 *
 * jsdom does no hit testing, so a pointer event lands on whichever element the
 * test names — which is exactly what the canvas's `closest()` hit test reads.
 * The drop target during a connect drag is resolved from store geometry rather
 * than from `event.target`, so that path is genuinely exercised here too.
 */

const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 800

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
    groups: {},
    groupOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    snapToGrid: true,
  })
})

const store = () => useDiagramStore.getState()
const getCanvas = () => screen.getByTestId('canvas')

const required = <T,>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`)
  return value
}

interface BlockSpec {
  x: number
  y: number
  width?: number
  height?: number
}

const seed = (...specs: BlockSpec[]): Block[] => {
  let created: Block[] = []
  act(() => {
    created = specs.map((spec) =>
      store().addBlock({
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

const blockElement = (id: string): Element =>
  required(getCanvas().querySelector(`[data-block-id="${id}"]`), `block ${id}`)

/** Reveals a block's ports the way a pointer entering it would. */
const hover = (id: string) => {
  fireEvent.pointerOver(blockElement(id), { clientX: 0, clientY: 0 })
}

const portElement = (side: string): Element =>
  required(getCanvas().querySelector(`[data-port-side="${side}"]`), `${side} port`)

const centreOf = (block: Block) => ({
  x: block.x + block.width / 2,
  y: block.y + block.height / 2,
})

interface DragOptions {
  altKey?: boolean
  shiftKey?: boolean
  hold?: boolean
  midDrag?: () => void
}

/** A drag in screen pixels; the canvas sits at the origin at zoom 1. */
const drag = (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: DragOptions = {},
) => {
  const modifiers = {
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
  }

  fireEvent.pointerDown(target, {
    clientX: from.x,
    clientY: from.y,
    button: 0,
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

/** Drags from one of `source`'s ports to a point, revealing the ports first. */
const dragFromPort = (
  source: Block,
  side: string,
  to: { x: number; y: number },
  options: DragOptions = {},
) => {
  hover(source.id)
  const port = portElement(side)
  const centre = centreOf(source)
  drag(port, centre, to, options)
}

const connections = () => store().connectionOrder.map((id) => store().connections[id])
const pathD = () => screen.getByTestId('connection-line').getAttribute('d') ?? ''

describe('ports', () => {
  it('shows four ports when the pointer is over a block', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    expect(screen.queryAllByTestId('block-port')).toHaveLength(0)

    hover(block.id)

    const ports = screen.getAllByTestId('block-port')
    expect(ports).toHaveLength(4)
    expect(ports.map((port) => port.getAttribute('data-port-side'))).toEqual([
      'n',
      'e',
      's',
      'w',
    ])
  })

  it('hides the ports again when the pointer leaves the block', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    hover(block.id)
    expect(screen.getAllByTestId('block-port')).toHaveLength(4)

    fireEvent.pointerOver(screen.getByTestId('canvas-grid'), { clientX: 0, clientY: 0 })

    expect(screen.queryAllByTestId('block-port')).toHaveLength(0)
  })

  it('does not show ports while a creation tool is active', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    act(() => {
      store().setTool('rect')
    })

    hover(block.id)

    expect(screen.queryAllByTestId('block-port')).toHaveLength(0)
  })

  it('keeps the ports a constant size on screen at any zoom', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    hover(block.id)

    const radiusAt = (zoom: number) => {
      act(() => {
        store().setViewport({ x: 0, y: 0, zoom })
      })
      const dot = required(getCanvas().querySelector('.port__dot'), 'port dot')
      return Number(dot.getAttribute('r'))
    }

    const atOne = radiusAt(1)
    expect(radiusAt(2)).toBeCloseTo(atOne / 2, 6)
    expect(radiusAt(0.5)).toBeCloseTo(atOne * 2, 6)
  })
})

describe('creating connections', () => {
  it('creates a connection when a port is dragged onto another block', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')
    const target = required(b, 'b')

    dragFromPort(source, 'e', centreOf(target))

    expect(connections()).toHaveLength(1)
    expect(connections()[0]).toMatchObject({
      sourceId: source.id,
      targetId: target.id,
      sourceAnchor: 'e',
    })
  })

  it('records the port the drag started from as the source anchor', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')
    const target = required(b, 'b')

    dragFromPort(source, 's', centreOf(target))

    expect(connections()[0]?.sourceAnchor).toBe('s')
  })

  it('renders the new connection', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })

    dragFromPort(required(a, 'a'), 'e', centreOf(required(b, 'b')))

    expect(screen.getByTestId('connection')).toBeInTheDocument()
    expect(pathD()).not.toBe('')
    expect(pathD()).not.toMatch(/NaN/)
  })

  it('draws a ghost arrow while the drag is in flight', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })

    dragFromPort(required(a, 'a'), 'e', centreOf(required(b, 'b')), { hold: true })

    const ghost = screen.getByTestId('connection-ghost')
    expect(ghost.getAttribute('d')).not.toMatch(/NaN/)

    fireEvent.pointerUp(getCanvas(), { clientX: 650, clientY: 430, buttons: 0 })
    expect(screen.queryByTestId('connection-ghost')).not.toBeInTheDocument()
  })

  it('highlights the block under the pointer as a valid target', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const target = required(b, 'b')

    dragFromPort(required(a, 'a'), 'e', centreOf(target), { hold: true })

    expect(screen.getByTestId('connect-target')).toHaveAttribute(
      'data-connect-target-id',
      target.id,
    )

    fireEvent.pointerUp(getCanvas(), { clientX: 650, clientY: 430, buttons: 0 })
  })

  it('does not highlight anything over empty canvas', () => {
    render(<App />)
    const [a] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })

    dragFromPort(required(a, 'a'), 'e', { x: 900, y: 700 }, { hold: true })

    expect(screen.queryByTestId('connect-target')).not.toBeInTheDocument()

    fireEvent.pointerUp(getCanvas(), { clientX: 900, clientY: 700, buttons: 0 })
  })

  it('creates nothing when released over empty canvas', () => {
    render(<App />)
    const [a] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })

    dragFromPort(required(a, 'a'), 'e', { x: 900, y: 700 })

    expect(connections()).toHaveLength(0)
    expect(screen.queryAllByTestId('connection')).toHaveLength(0)
  })

  it('refuses to wire a block to itself', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100, width: 300, height: 200 })[0], 'block')

    // Released back over the source block.
    dragFromPort(block, 'e', centreOf(block))

    expect(connections()).toHaveLength(0)
  })

  it('refuses an exact duplicate', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')
    const target = required(b, 'b')

    dragFromPort(source, 'e', centreOf(target))
    dragFromPort(source, 'e', centreOf(target))

    expect(connections()).toHaveLength(1)
    expect(screen.getAllByTestId('connection')).toHaveLength(1)
  })

  it('allows a second connection from a different port', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')
    const target = required(b, 'b')

    dragFromPort(source, 'e', centreOf(target))
    dragFromPort(source, 's', centreOf(target))

    expect(connections()).toHaveLength(2)
  })

  it('does not move the source block while dragging from its port', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')

    dragFromPort(source, 'e', centreOf(required(b, 'b')))

    expect(store().blocks[source.id]).toMatchObject({ x: 100, y: 100 })
  })

  it('cancels on Escape without creating anything', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const target = required(b, 'b')

    dragFromPort(required(a, 'a'), 'e', centreOf(target), {
      hold: true,
      midDrag: () => {
        // The ghost really was in flight before the cancel.
        expect(screen.getByTestId('connection-ghost')).toBeInTheDocument()
        fireEvent.keyDown(document.body, { key: 'Escape' })
      },
    })
    fireEvent.pointerUp(getCanvas(), {
      clientX: centreOf(target).x,
      clientY: centreOf(target).y,
      buttons: 0,
    })

    expect(connections()).toHaveLength(0)
    expect(screen.queryAllByTestId('connection')).toHaveLength(0)
    expect(screen.queryByTestId('connection-ghost')).not.toBeInTheDocument()
  })

  it('does not start a marquee when the drag begins on a port', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })

    dragFromPort(required(a, 'a'), 'e', centreOf(required(b, 'b')), { hold: true })

    expect(screen.queryByTestId('marquee')).not.toBeInTheDocument()

    fireEvent.pointerUp(getCanvas(), { clientX: 650, clientY: 430, buttons: 0 })
  })
})

describe('derived geometry', () => {
  const wire = () => {
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')
    const target = required(b, 'b')
    act(() => {
      store().addConnection({ sourceId: source.id, targetId: target.id })
    })
    return { source, target }
  }

  it('re-routes the arrow when a block moves', () => {
    render(<App />)
    const { source } = wire()
    const before = pathD()

    act(() => {
      store().setBlockPositions({ [source.id]: { x: 200, y: 300 } })
    })

    // The connection stores only ids, so the only way `d` can change is if the
    // geometry is being derived from the blocks at render time.
    expect(pathD()).not.toBe(before)
    expect(pathD()).not.toMatch(/NaN/)
  })

  it('re-routes the arrow when a block is dragged', () => {
    render(<App />)
    const { source } = wire()
    const before = pathD()

    drag(blockElement(source.id), { x: 150, y: 130 }, { x: 250, y: 330 })

    expect(pathD()).not.toBe(before)
  })

  it('re-routes the arrow when a block is resized', () => {
    render(<App />)
    const { source } = wire()
    const before = pathD()

    act(() => {
      store().updateBlock(source.id, { width: 400, height: 300 })
    })

    expect(pathD()).not.toBe(before)
  })

  it('re-picks the anchors when a block crosses to the other side', () => {
    render(<App />)
    const { source } = wire()

    // Source starts left of the target and ends well to its right.
    act(() => {
      store().setBlockPositions({ [source.id]: { x: 1400, y: 400 } })
    })

    const d = pathD()
    expect(d).not.toMatch(/NaN/)
    // The route now leaves the source's west edge, so its first point is the
    // left edge midpoint at x = 1400.
    expect(d.startsWith('M 1400 ')).toBe(true)
  })

  it('stores no coordinates on the connection itself', () => {
    render(<App />)
    wire()

    const connection = required(connections()[0], 'connection')
    expect(Object.keys(connection).sort()).toEqual(['id', 'sourceId', 'targetId'])
  })
})

describe('selecting and removing connections', () => {
  const wire = () => {
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    const source = required(a, 'a')
    const target = required(b, 'b')
    let id = ''
    act(() => {
      id = required(
        store().addConnection({ sourceId: source.id, targetId: target.id }),
        'connection',
      ).id
    })
    return { source, target, id }
  }

  const connectionHit = () => screen.getByTestId('connection-hit')

  it('selects a connection when it is clicked', () => {
    render(<App />)
    const { id } = wire()

    fireEvent.pointerDown(connectionHit(), { clientX: 400, clientY: 300, button: 0 })

    expect(store().selectedConnectionIds).toEqual([id])
    // `className` on an SVG element is an SVGAnimatedString, not a string.
    expect(screen.getByTestId('connection').getAttribute('class')).toContain(
      'connection--selected',
    )
  })

  it('does not mark an unselected connection', () => {
    render(<App />)
    wire()

    expect(screen.getByTestId('connection').getAttribute('class')).not.toContain(
      'connection--selected',
    )
  })

  it('clears any block selection when a connection is clicked', () => {
    render(<App />)
    const { source } = wire()
    act(() => {
      store().select(source.id)
    })

    fireEvent.pointerDown(connectionHit(), { clientX: 400, clientY: 300, button: 0 })

    expect(store().selectedIds).toEqual([])
  })

  it('does not clear the selection on the click that follows', () => {
    render(<App />)
    const { id } = wire()

    fireEvent.pointerDown(connectionHit(), { clientX: 400, clientY: 300, button: 0 })
    fireEvent.click(connectionHit(), { clientX: 400, clientY: 300 })

    expect(store().selectedConnectionIds).toEqual([id])
  })

  it('adds a connection to the selection with shift + click', () => {
    render(<App />)
    const { source, id } = wire()
    act(() => {
      store().select(source.id)
    })

    fireEvent.pointerDown(connectionHit(), {
      clientX: 400,
      clientY: 300,
      button: 0,
      shiftKey: true,
    })

    expect(store().selectedIds).toEqual([source.id])
    expect(store().selectedConnectionIds).toEqual([id])
  })

  it('gives the connection a generous, invisible hit target', () => {
    render(<App />)
    wire()

    const hit = connectionHit()
    expect(hit).toHaveAttribute('stroke', 'transparent')
    expect(hit).toHaveAttribute('pointer-events', 'stroke')
    // Wider than the 1.75-unit visible line, and constant on screen.
    expect(Number(hit.getAttribute('stroke-width'))).toBeGreaterThan(8)
  })

  it('removes the selected connection with Delete, leaving the blocks', async () => {
    const user = userEvent.setup()
    render(<App />)
    const { source, target } = wire()

    fireEvent.pointerDown(connectionHit(), { clientX: 400, clientY: 300, button: 0 })
    await user.keyboard('{Delete}')

    expect(screen.queryAllByTestId('connection')).toHaveLength(0)
    expect(store().connectionOrder).toEqual([])
    expect(store().blocks[source.id]).toBeDefined()
    expect(store().blocks[target.id]).toBeDefined()
    expect(screen.getAllByTestId('block')).toHaveLength(2)
  })

  it('removes a block and its connections together', async () => {
    const user = userEvent.setup()
    render(<App />)
    const { source } = wire()
    act(() => {
      store().select(source.id)
    })

    await user.keyboard('{Delete}')

    expect(screen.queryAllByTestId('connection')).toHaveLength(0)
    expect(screen.getAllByTestId('block')).toHaveLength(1)
    // The store must really be rid of it, not merely unable to draw it: the
    // canvas skips any connection whose endpoints are missing, so the DOM
    // assertion above would pass even with the cascade removed.
    expect(store().connectionOrder).toEqual([])
    expect(store().connections).toEqual({})
  })

  it('deletes a mixed selection of blocks and connections in one go', async () => {
    const user = userEvent.setup()
    render(<App />)
    const [a, b, c] = seed({ x: 100, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 600 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    const third = required(c, 'c')
    act(() => {
      store().addConnection({ sourceId: first.id, targetId: second.id })
      const loose = store().addConnection({ sourceId: second.id, targetId: third.id })
      store().select(first.id)
      store().toggleConnectionSelection(required(loose, 'loose').id)
    })

    await user.keyboard('{Delete}')

    expect(store().connectionOrder).toEqual([])
    expect(store().blockOrder).toEqual([second.id, third.id])
  })

  it('leaves connections between surviving blocks alone', async () => {
    const user = userEvent.setup()
    render(<App />)
    const [a, b, c] = seed({ x: 100, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 600 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    const third = required(c, 'c')
    act(() => {
      store().addConnection({ sourceId: first.id, targetId: second.id })
      store().addConnection({ sourceId: second.id, targetId: third.id })
      store().select(first.id)
    })

    await user.keyboard('{Delete}')

    expect(screen.getAllByTestId('connection')).toHaveLength(1)
  })

  it('does not select connections with a marquee', () => {
    render(<App />)
    const { source, target } = wire()

    // A marquee spanning the whole diagram, arrow included.
    drag(getCanvas(), { x: 5, y: 5 }, { x: 900, y: 700 })

    expect(store().selectedIds).toEqual([source.id, target.id])
    expect(store().selectedConnectionIds).toEqual([])
  })
})

describe('snap to grid', () => {
  const onGrid = (value: number) => value % GRID_SIZE === 0

  it('is on by default and shown as pressed in the toolbar', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /snap/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('toggles from the toolbar', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /snap/i }))

    expect(store().snapToGrid).toBe(false)
    expect(screen.getByRole('button', { name: /snap/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('toggles with the G key', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.keyboard('g')
    expect(store().snapToGrid).toBe(false)

    await user.keyboard('g')
    expect(store().snapToGrid).toBe(true)
  })

  it('leaves a dragged block on the grid', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 183, y: 157 })

    const moved = required(store().blocks[block.id], 'moved')
    expect(onGrid(moved.x)).toBe(true)
    expect(onGrid(moved.y)).toBe(true)
    // 100 + 33 = 133, which rounds to 140.
    expect(moved).toMatchObject({ x: 140, y: 120 })
  })

  it('does not snap while it is switched off', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    act(() => {
      store().setSnapToGrid(false)
    })

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 183, y: 157 })

    expect(store().blocks[block.id]).toMatchObject({ x: 133, y: 127 })
  })

  it('preserves the gaps between blocks in a multi-selection', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 250, y: 120 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    act(() => {
      store().select([first.id, second.id])
    })

    drag(blockElement(first.id), { x: 50, y: 30 }, { x: 83, y: 57 })

    const movedA = required(store().blocks[first.id], 'a')
    const movedB = required(store().blocks[second.id], 'b')

    // The grabbed block lands on the grid...
    expect(onGrid(movedA.x)).toBe(true)
    expect(onGrid(movedA.y)).toBe(true)
    // ...and the other one moves by the very same delta, so the gap survives.
    // Snapping each block on its own would have collapsed 250 to 240 or 260.
    expect(movedB.x - movedA.x).toBe(250)
    expect(movedB.y - movedA.y).toBe(120)
  })

  it('keeps an off-grid companion off-grid, by design', () => {
    render(<App />)
    const [a, b] = seed({ x: 0, y: 0 }, { x: 253, y: 121 })
    const first = required(a, 'a')
    const second = required(b, 'b')
    act(() => {
      store().select([first.id, second.id])
    })

    drag(blockElement(first.id), { x: 50, y: 30 }, { x: 83, y: 57 })

    const movedB = required(store().blocks[second.id], 'b')
    // Rigid move: the companion keeps its exact offset rather than being
    // dragged onto the lattice behind the user's back.
    expect(movedB.x % GRID_SIZE).toBe(253 % GRID_SIZE)
  })

  it('snaps the edges a resize handle moves', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100, width: 200, height: 100 })[0], 'block')
    act(() => {
      store().select(block.id)
    })
    const handle = required(
      getCanvas().querySelector('[data-resize-handle="se"]'),
      'se handle',
    )

    drag(handle, { x: 300, y: 200 }, { x: 347, y: 233 })

    const resized = required(store().blocks[block.id], 'resized')
    // The anchored NW corner has not budged...
    expect(resized).toMatchObject({ x: 100, y: 100 })
    // ...and the moved edges landed on the grid.
    expect(onGrid(resized.x + resized.width)).toBe(true)
    expect(onGrid(resized.y + resized.height)).toBe(true)
    expect(resized.width).toBe(240)
    expect(resized.height).toBe(140)
  })

  it('snaps a resize that moves the origin, holding the far corner still', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100, width: 200, height: 100 })[0], 'block')
    act(() => {
      store().select(block.id)
    })
    const handle = required(
      getCanvas().querySelector('[data-resize-handle="nw"]'),
      'nw handle',
    )

    drag(handle, { x: 100, y: 100 }, { x: 133, y: 127 })

    const resized = required(store().blocks[block.id], 'resized')
    expect(onGrid(resized.x)).toBe(true)
    expect(onGrid(resized.y)).toBe(true)
    // The SE corner stayed exactly where it was.
    expect(resized.x + resized.width).toBe(300)
    expect(resized.y + resized.height).toBe(200)
  })

  it('still honours the minimum size after snapping', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100, width: 200, height: 100 })[0], 'block')
    act(() => {
      store().select(block.id)
    })
    const handle = required(
      getCanvas().querySelector('[data-resize-handle="se"]'),
      'se handle',
    )

    drag(handle, { x: 300, y: 200 }, { x: -400, y: -400 })

    const resized = required(store().blocks[block.id], 'resized')
    expect(resized.width).toBe(20)
    expect(resized.height).toBe(20)
  })

  it('snaps a newly created block', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /rectangle/i }))

    fireEvent.click(getCanvas(), { clientX: 313, clientY: 247 })

    const created = required(Object.values(store().blocks)[0], 'created')
    expect(onGrid(created.x)).toBe(true)
    expect(onGrid(created.y)).toBe(true)
  })

  describe('Alt inverts the snap for one gesture', () => {
    it('turns snapping off while it is on', () => {
      render(<App />)
      const block = required(seed({ x: 100, y: 100 })[0], 'block')

      drag(
        blockElement(block.id),
        { x: 150, y: 130 },
        { x: 183, y: 157 },
        {
          altKey: true,
        },
      )

      expect(store().blocks[block.id]).toMatchObject({ x: 133, y: 127 })
    })

    it('turns snapping on while it is off', () => {
      render(<App />)
      const block = required(seed({ x: 100, y: 100 })[0], 'block')
      act(() => {
        store().setSnapToGrid(false)
      })

      drag(
        blockElement(block.id),
        { x: 150, y: 130 },
        { x: 183, y: 157 },
        {
          altKey: true,
        },
      )

      expect(store().blocks[block.id]).toMatchObject({ x: 140, y: 120 })
    })

    it('applies to resizing too', () => {
      render(<App />)
      const block = required(
        seed({ x: 100, y: 100, width: 200, height: 100 })[0],
        'block',
      )
      act(() => {
        store().select(block.id)
      })
      const handle = required(
        getCanvas().querySelector('[data-resize-handle="se"]'),
        'se handle',
      )

      drag(handle, { x: 300, y: 200 }, { x: 347, y: 233 }, { altKey: true })

      expect(store().blocks[block.id]).toMatchObject({ width: 247, height: 133 })
    })

    it('does not leak into the toolbar state', () => {
      render(<App />)
      const block = required(seed({ x: 100, y: 100 })[0], 'block')

      drag(
        blockElement(block.id),
        { x: 150, y: 130 },
        { x: 183, y: 157 },
        {
          altKey: true,
        },
      )

      // Alt is a hold, not a toggle.
      expect(store().snapToGrid).toBe(true)
    })

    it('is ignored by the global shortcuts', async () => {
      const user = userEvent.setup()
      render(<App />)

      await user.keyboard('{Alt>}g{/Alt}')

      expect(store().snapToGrid).toBe(true)
    })
  })
})

describe('the arrowhead marker', () => {
  it('keeps a constant size on screen at any zoom', () => {
    render(<App />)

    const widthAt = (zoom: number) => {
      act(() => {
        store().setViewport({ x: 0, y: 0, zoom })
      })
      return Number(screen.getByTestId('arrow-marker').getAttribute('markerWidth'))
    }

    const atOne = widthAt(1)
    expect(widthAt(2)).toBeCloseTo(atOne / 2, 6)
    expect(widthAt(0.5)).toBeCloseTo(atOne * 2, 6)
  })

  it('is measured in user space, not stroke widths', () => {
    render(<App />)
    expect(screen.getByTestId('arrow-marker')).toHaveAttribute(
      'markerUnits',
      'userSpaceOnUse',
    )
  })

  it('is referenced by every connection', () => {
    render(<App />)
    const [a, b] = seed({ x: 100, y: 100 }, { x: 600, y: 400 })
    act(() => {
      store().addConnection({
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
    })

    expect(screen.getByTestId('connection-line')).toHaveAttribute(
      'marker-end',
      'url(#flowcraft-arrow)',
    )
  })
})
