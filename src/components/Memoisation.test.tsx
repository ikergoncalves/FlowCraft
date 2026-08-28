import { act, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import * as style from '../utils/style'

/*
 * That the memos on `BlockView` and `ConnectionView` are load-bearing.
 *
 * Both have been `memo()` since the phase that introduced them, and one of
 * them spent four phases doing nothing at all: `BlockView`'s `onActivate` prop
 * was a fresh closure on every canvas render, so every block re-rendered
 * whenever any block moved. Nothing failed. The diagram was correct, the tests
 * were green, and the only symptom was a frame budget quietly spent on 4999
 * blocks that had not changed.
 *
 * A comment saying "keep this stable" would not have caught it, so this counts
 * renders instead. `blockShapeStyle` is called once per `BlockView` body and
 * `connectionLineStyle` once per `ConnectionView` body, which makes them exact
 * counters for how many of each actually re-rendered.
 */

const CANVAS_BOX: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
  toJSON: () => ({}),
}

vi.mock('../utils/style', async (importOriginal) => {
  const actual = await importOriginal<typeof style>()
  return {
    ...actual,
    blockShapeStyle: vi.fn(actual.blockShapeStyle),
    connectionLineStyle: vi.fn(actual.connectionLineStyle),
  }
})

const blockRenders = vi.mocked(style.blockShapeStyle)
const connectionRenders = vi.mocked(style.connectionLineStyle)

beforeAll(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

afterAll(() => {
  vi.restoreAllMocks()
})

/** Six blocks in a row, well inside the viewport, joined into a chain. */
const IDS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5']

beforeEach(() => {
  const blocks = Object.fromEntries(
    IDS.map((id, index) => [
      id,
      {
        id,
        type: 'rect' as const,
        x: index * 120,
        y: 100,
        width: 100,
        height: 50,
        text: id,
      },
    ]),
  )
  const connections = Object.fromEntries(
    IDS.slice(1).map((id, index) => [
      `c${String(index)}`,
      { id: `c${String(index)}`, sourceId: IDS[index] ?? '', targetId: id },
    ]),
  )
  useDiagramStore.setState({
    blocks,
    blockOrder: [...IDS],
    connections,
    connectionOrder: Object.keys(connections),
    groups: {},
    groupOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
  })
})

/** Renders, then forgets everything that happened during the first paint. */
function mountAndReset() {
  render(<App />)
  expect(screen.queryAllByTestId('block')).toHaveLength(IDS.length)
  blockRenders.mockClear()
  connectionRenders.mockClear()
}

const move = (id: string, x: number, y: number) => {
  act(() => {
    useDiagramStore.getState().setBlockPositions({ [id]: { x, y } })
  })
}

describe('memoisation', () => {
  it('re-renders only the block that moved', () => {
    mountAndReset()
    move('b0', 20, 140)
    expect(blockRenders).toHaveBeenCalledTimes(1)
  })

  it('re-renders only the arrows attached to the block that moved', () => {
    mountAndReset()
    // b2 sits in the middle of the chain, so exactly two arrows touch it.
    move('b2', 240, 180)
    expect(connectionRenders).toHaveBeenCalledTimes(2)
  })

  it('re-renders no blocks at all when the selection does not change', () => {
    mountAndReset()
    act(() => {
      useDiagramStore.getState().setTool('rect')
    })
    expect(blockRenders).toHaveBeenCalledTimes(0)
  })

  it('re-renders the two blocks whose selection state changed, and no others', () => {
    render(<App />)
    act(() => {
      useDiagramStore.getState().select('b0')
    })
    blockRenders.mockClear()
    act(() => {
      useDiagramStore.getState().select('b1')
    })
    // b0 loses its outline, b1 gains one. The other four are untouched.
    expect(blockRenders).toHaveBeenCalledTimes(2)
  })

  it('still re-renders the moved block when many move at once', () => {
    // The memo must not be so eager that a multi-block drag misses some.
    mountAndReset()
    act(() => {
      useDiagramStore.getState().setBlockPositions({
        b0: { x: 0, y: 300 },
        b1: { x: 120, y: 300 },
        b2: { x: 240, y: 300 },
      })
    })
    expect(blockRenders).toHaveBeenCalledTimes(3)
  })

  it('re-renders every visible arrow when the zoom changes', () => {
    // Zoom is a real ConnectionView prop — it sizes the hit path — so this one
    // genuinely has to invalidate them all.
    mountAndReset()
    act(() => {
      useDiagramStore.getState().setViewport({ x: 0, y: 0, zoom: 2 })
    })
    expect(connectionRenders).toHaveBeenCalledTimes(IDS.length - 1)
  })
})
