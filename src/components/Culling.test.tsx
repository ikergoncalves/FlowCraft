import { act, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { makeBigDiagram } from '../dev/bigDiagram'
import { exportSvg } from '../export/svg'
import { toDocument } from '../persistence/document'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { CULL_MARGIN_PX } from '../utils/culling'

/*
 * What culling is not allowed to do.
 *
 * `utils/culling.test.ts` checks the arithmetic; this checks the promise. The
 * failure this guards against does not look like a crash — it looks like a
 * user opening their diagram, seeing part of it, saving, and losing the rest.
 * So every assertion here is of the form "the document still has it", asked of
 * a different consumer: the store, the export, the save, Select All, and the
 * canvas once the camera moves back.
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

/**
 * A grid wide enough that plenty of it is off screen at the default view.
 *
 * 12 columns of 260 world units is 3120 across, against an 800-wide canvas
 * plus a 400 margin on each side — so the right-hand columns are comfortably
 * outside, not marginally so.
 */
const COLUMNS = 12
const BLOCKS = 120
const CONNECTIONS = 200

beforeEach(() => {
  useDiagramStore.setState({
    ...makeBigDiagram({ blocks: BLOCKS, connections: CONNECTIONS, columns: COLUMNS }),
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
  })
})

const renderedBlockIds = () =>
  screen
    .queryAllByTestId('block')
    .map((node) => node.getAttribute('data-block-id'))
    .filter((id): id is string => id !== null)

const setViewport = (x: number, y: number, zoom = 1) => {
  act(() => {
    useDiagramStore.getState().setViewport({ x, y, zoom })
  })
}

describe('viewport culling', () => {
  it('renders far less than the whole diagram', () => {
    render(<App />)
    expect(renderedBlockIds().length).toBeGreaterThan(0)
    expect(renderedBlockIds().length).toBeLessThan(BLOCKS)
  })

  it('renders every block that is actually on screen', () => {
    render(<App />)
    const drawn = new Set(renderedBlockIds())
    const state = useDiagramStore.getState()
    for (const id of state.blockOrder) {
      const block = state.blocks[id]
      if (!block) continue
      const onScreen =
        block.x < CANVAS_WIDTH &&
        block.y < CANVAS_HEIGHT &&
        block.x + block.width > 0 &&
        block.y + block.height > 0
      if (onScreen) expect(drawn).toContain(id)
    }
  })

  it('leaves the document untouched — culling is a rendering decision', () => {
    render(<App />)
    const state = useDiagramStore.getState()
    expect(state.blockOrder).toHaveLength(BLOCKS)
    expect(state.connectionOrder).toHaveLength(CONNECTIONS)
  })

  it('exports every block, including the ones never rendered', () => {
    render(<App />)
    expect(renderedBlockIds().length).toBeLessThan(BLOCKS)

    // The export is built from the document, not scraped from the DOM. This is
    // the assertion that keeps it that way.
    const state = useDiagramStore.getState()
    const file = exportSvg(state, { theme: 'dark' })
    if (!file) throw new Error('the export refused a diagram that has content')

    // One <rect> per block, plus the background. If the export were scraped
    // from the DOM this count would be the handful that happened to be on
    // screen, which is exactly the bug this asserts against.
    const rects = file.markup.match(/<rect/g) ?? []
    expect(rects).toHaveLength(BLOCKS + 1)
    const paths = file.markup.match(/<path/g) ?? []
    expect(paths.length).toBeGreaterThanOrEqual(CONNECTIONS)
  })

  it('saves every block, including the ones never rendered', () => {
    render(<App />)
    const saved = toDocument(useDiagramStore.getState())
    expect(Object.keys(saved.blocks)).toHaveLength(BLOCKS)
    expect(Object.keys(saved.connections)).toHaveLength(CONNECTIONS)
  })

  it('selects every block on Select All, including the ones never rendered', () => {
    render(<App />)
    act(() => {
      useDiagramStore.getState().selectAll()
    })
    expect(useDiagramStore.getState().selectedIds).toHaveLength(BLOCKS)
  })

  it('brings a block back into the DOM when the camera reaches it', () => {
    render(<App />)
    const state = useDiagramStore.getState()
    const lastId = state.blockOrder[BLOCKS - 1]
    const last = lastId === undefined ? undefined : state.blocks[lastId]
    if (!last || lastId === undefined) throw new Error('no last block')

    expect(renderedBlockIds()).not.toContain(lastId)
    setViewport(last.x - 100, last.y - 100)
    expect(renderedBlockIds()).toContain(lastId)
  })

  it('takes it away again when the camera leaves', () => {
    render(<App />)
    const state = useDiagramStore.getState()
    const lastId = state.blockOrder[BLOCKS - 1]
    const last = lastId === undefined ? undefined : state.blocks[lastId]
    if (!last || lastId === undefined) throw new Error('no last block')

    setViewport(last.x - 100, last.y - 100)
    expect(renderedBlockIds()).toContain(lastId)
    setViewport(0, 0)
    expect(renderedBlockIds()).not.toContain(lastId)
  })

  it('shows the whole diagram when zoomed far enough out', () => {
    render(<App />)
    setViewport(0, 0, 0.1)
    expect(renderedBlockIds()).toHaveLength(BLOCKS)
  })

  it('keeps a selected block rendered after it is nudged out of view', () => {
    render(<App />)
    const id = useDiagramStore.getState().blockOrder[0]
    if (id === undefined) throw new Error('no first block')

    act(() => {
      useDiagramStore.getState().select(id)
      useDiagramStore.getState().setBlockPositions({ [id]: { x: 90000, y: 90000 } })
    })
    expect(renderedBlockIds()).toContain(id)
  })

  it('renders a block sitting just inside the margin', () => {
    render(<App />)
    act(() => {
      useDiagramStore.getState().addBlock({
        id: 'margin-in',
        type: 'rect',
        // Its right edge lands one unit inside the left margin boundary.
        x: -CULL_MARGIN_PX - 99,
        y: 100,
        width: 100,
        height: 50,
        text: 'in',
      })
    })
    expect(renderedBlockIds()).toContain('margin-in')
  })

  it('does not render a block sitting just outside it', () => {
    render(<App />)
    act(() => {
      useDiagramStore.getState().addBlock({
        id: 'margin-out',
        type: 'rect',
        x: -CULL_MARGIN_PX - 101,
        y: 100,
        width: 100,
        height: 50,
        text: 'out',
      })
    })
    expect(renderedBlockIds()).not.toContain('margin-out')
  })

  it('renders no more arrows than it has blocks to hang them on', () => {
    render(<App />)
    const drawn = new Set(renderedBlockIds())
    for (const node of screen.queryAllByTestId('connection')) {
      const id = node.getAttribute('data-connection-id')
      const connection =
        id === null ? undefined : useDiagramStore.getState().connections[id]
      if (!connection) continue
      // Every drawn arrow has at least one of its blocks drawn too. That
      // holds because this generator only joins grid neighbours: a view
      // boundary falling between two of them always leaves one on the inside.
      // A diagram with long-range arrows would legitimately draw an arrow
      // crossing the view with both ends outside it.
      expect(drawn.has(connection.sourceId) || drawn.has(connection.targetId)).toBe(true)
    }
  })
})
