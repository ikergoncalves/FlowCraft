import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_BLOCK_SIZE } from '../utils/blocks'
import { DEFAULT_VIEWPORT } from '../utils/coords'

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
  // jsdom reports a 0x0 box for everything; the canvas needs a real size for
  // its viewBox and for screen -> world conversion to mean anything.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    groups: {},
    groupOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    tool: 'select',
  })
})

const getCanvas = () => screen.getByTestId('canvas')

const clickCanvasAt = (x: number, y: number) => {
  fireEvent.click(getCanvas(), { clientX: x, clientY: y })
}

describe('creating blocks', () => {
  it('renders a block after picking Rectangle and clicking the canvas', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.queryAllByTestId('block')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /rectangle/i }))
    clickCanvasAt(400, 300)

    const blocks = screen.getAllByTestId('block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toHaveAttribute('data-block-type', 'rect')
    expect(getCanvas().querySelector('rect.block__shape')).toBeInTheDocument()
  })

  it('places the new block centred on the clicked world point', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /rectangle/i }))
    clickCanvasAt(400, 300)

    const [block] = Object.values(useDiagramStore.getState().blocks)
    expect(block).toBeDefined()
    expect(block?.x).toBe(400 - DEFAULT_BLOCK_SIZE.rect.width / 2)
    expect(block?.y).toBe(300 - DEFAULT_BLOCK_SIZE.rect.height / 2)
  })

  it('accounts for pan and zoom when converting the click to world space', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => {
      useDiagramStore.getState().setViewport({ x: 100, y: 50, zoom: 2 })
    })

    await user.click(screen.getByRole('button', { name: /rectangle/i }))
    clickCanvasAt(400, 300)

    // world = viewport + screen / zoom  ->  (100 + 200, 50 + 150)
    const [block] = Object.values(useDiagramStore.getState().blocks)
    expect(block?.x).toBe(300 - DEFAULT_BLOCK_SIZE.rect.width / 2)
    expect(block?.y).toBe(200 - DEFAULT_BLOCK_SIZE.rect.height / 2)
  })

  it('renders a text block as bare text, with no visible shape', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /^text/i }))
    clickCanvasAt(200, 200)

    const block = screen.getByTestId('block')
    expect(block).toHaveAttribute('data-block-type', 'text')
    expect(block.querySelector('rect.block__shape')).toBeNull()
    expect(within(block).getByText('Text')).toBeInTheDocument()
  })

  it('returns to the Select tool and selects the new block', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /rectangle/i }))
    clickCanvasAt(400, 300)

    const state = useDiagramStore.getState()
    expect(state.tool).toBe('select')
    expect(state.selectedIds).toHaveLength(1)
    expect(screen.getByRole('button', { name: /select/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('does not create anything while the Select tool is active', () => {
    render(<App />)
    clickCanvasAt(400, 300)
    expect(screen.queryAllByTestId('block')).toHaveLength(0)
  })
})

describe('tool shortcuts', () => {
  it('switches tools with V, R and T', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.keyboard('r')
    expect(useDiagramStore.getState().tool).toBe('rect')

    await user.keyboard('t')
    expect(useDiagramStore.getState().tool).toBe('text')

    await user.keyboard('v')
    expect(useDiagramStore.getState().tool).toBe('select')
  })

  it('creates a block after choosing the tool by shortcut', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.keyboard('r')
    clickCanvasAt(100, 100)

    expect(screen.getAllByTestId('block')).toHaveLength(1)
  })
})

describe('selection', () => {
  it('selects a block on pointer down and draws an outline', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('r')
    clickCanvasAt(400, 300)
    act(() => {
      useDiagramStore.getState().clearSelection()
    })

    fireEvent.pointerDown(screen.getByTestId('block'))

    expect(useDiagramStore.getState().selectedIds).toHaveLength(1)
    expect(screen.getByTestId('block-selection')).toBeInTheDocument()
  })

  it('clears the selection when clicking empty canvas', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('r')
    clickCanvasAt(400, 300)
    expect(useDiagramStore.getState().selectedIds).toHaveLength(1)

    clickCanvasAt(50, 50)

    expect(useDiagramStore.getState().selectedIds).toEqual([])
  })

  it('deletes the selected block with Delete', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('r')
    clickCanvasAt(400, 300)

    await user.keyboard('{Delete}')

    expect(screen.queryAllByTestId('block')).toHaveLength(0)
    expect(useDiagramStore.getState().selectedIds).toEqual([])
  })

  it('deletes the selected block with Backspace', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('r')
    clickCanvasAt(400, 300)

    await user.keyboard('{Backspace}')

    expect(screen.queryAllByTestId('block')).toHaveLength(0)
  })
})

describe('text editing', () => {
  const createBlockAndOpenEditor = async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('r')
    clickCanvasAt(400, 300)
    fireEvent.doubleClick(screen.getByTestId('block'))
    return { user, input: screen.getByRole('textbox', { name: /block text/i }) }
  }

  it('opens an input seeded with the current text on double click', async () => {
    const { input } = await createBlockAndOpenEditor()
    expect(input).toHaveValue('Block')
  })

  it('commits the new text on Enter', async () => {
    const { user, input } = await createBlockAndOpenEditor()

    await user.clear(input)
    await user.type(input, 'Start{Enter}')

    expect(screen.queryByRole('textbox', { name: /block text/i })).not.toBeInTheDocument()
    const [block] = Object.values(useDiagramStore.getState().blocks)
    expect(block?.text).toBe('Start')
  })

  it('discards the edit on Escape', async () => {
    const { user, input } = await createBlockAndOpenEditor()

    await user.clear(input)
    await user.type(input, 'Discarded{Escape}')

    expect(screen.queryByRole('textbox', { name: /block text/i })).not.toBeInTheDocument()
    const [block] = Object.values(useDiagramStore.getState().blocks)
    expect(block?.text).toBe('Block')
  })

  it('keeps editor keystrokes away from the global shortcuts', async () => {
    const { user, input } = await createBlockAndOpenEditor()

    await user.clear(input)
    await user.type(input, 'rvt')

    expect(useDiagramStore.getState().tool).toBe('select')
    expect(screen.getAllByTestId('block')).toHaveLength(1)
  })
})

describe('viewport chrome', () => {
  it('shows the zoom level and resets the view on demand', async () => {
    const user = userEvent.setup()
    render(<App />)

    act(() => {
      useDiagramStore.getState().setViewport({ x: 250, y: -100, zoom: 2.5 })
    })
    expect(await screen.findByTestId('zoom-value')).toHaveTextContent('250%')

    await user.click(screen.getByRole('button', { name: /reset view/i }))

    expect(useDiagramStore.getState().viewport).toEqual(DEFAULT_VIEWPORT)
    expect(screen.getByTestId('zoom-value')).toHaveTextContent('100%')
  })

  it('resets the view with the 0 shortcut', async () => {
    const user = userEvent.setup()
    render(<App />)
    act(() => {
      useDiagramStore.getState().setViewport({ x: 250, y: -100, zoom: 2.5 })
    })

    await user.keyboard('0')

    expect(useDiagramStore.getState().viewport).toEqual(DEFAULT_VIEWPORT)
  })

  it('derives the svg viewBox from the viewport and canvas size', () => {
    render(<App />)
    expect(getCanvas()).toHaveAttribute('viewBox', '0 0 800 600')

    act(() => {
      useDiagramStore.getState().setViewport({ x: 40, y: 20, zoom: 2 })
    })
    expect(getCanvas()).toHaveAttribute('viewBox', '40 20 400 300')
  })

  it('draws a grid backdrop', () => {
    render(<App />)
    expect(screen.getByTestId('canvas-grid')).toBeInTheDocument()
  })
})
