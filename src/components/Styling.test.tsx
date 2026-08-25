import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useHistoryStore } from '../history/historyStore'
import { clearClipboard } from '../store/clipboard'
import { useDiagramStore } from '../store/diagramStore'
import type { Block } from '../types'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { DEFAULT_BLOCK_STYLE } from '../utils/style'

/*
 * Styling and grouping as the user meets them: a real panel, real clicks, real
 * keystrokes.
 *
 * Assertions land on the store wherever the behaviour is about state. Phase 3
 * had a test pass with the delete cascade turned off because a DOM assertion
 * was masked by a defensive guard in the canvas; a styling bug hides in the
 * same gap, because the picture can look right while the document is wrong.
 * The DOM is asserted only where the DOM *is* the behaviour — which controls
 * the panel shows, and whether it is there at all.
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
    snapToGrid: false,
  })
  useHistoryStore.getState().clear()
  clearClipboard()
})

const store = () => useDiagramStore.getState()
const history = () => useHistoryStore.getState()
const getCanvas = () => screen.getByTestId('canvas')

const required = <T,>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`)
  return value
}

/** Seeds blocks straight through the store, then empties the history. */
const seed = (count: number): Block[] => {
  let created: Block[] = []
  act(() => {
    created = Array.from({ length: count }, (_, index) =>
      store().addBlock({
        type: 'rect',
        x: index * 200,
        y: 100,
        width: 100,
        height: 60,
        text: `b${index}`,
      }),
    )
    useHistoryStore.getState().clear()
  })
  return created
}

const select = (...ids: string[]) => {
  act(() => {
    store().select(ids)
  })
}

const blockElement = (id: string): Element =>
  required(getCanvas().querySelector(`[data-block-id="${id}"]`), `block ${id}`)

const blockAt = (id: string) => required(store().blocks[id], `block ${id} in the store`)

const press = (key: string, modifiers: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyDown(document.body, { key, ...modifiers })
}

/** Clicks a block the way the canvas's single pointer handler sees it. */
const clickBlock = (id: string) => {
  const block = blockAt(id)
  const point = { x: block.x + block.width / 2, y: block.y + block.height / 2 }
  const element = blockElement(id)
  fireEvent.pointerDown(element, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons: 1,
  })
  fireEvent.pointerUp(getCanvas(), { clientX: point.x, clientY: point.y, buttons: 0 })
  fireEvent.click(element, { clientX: point.x, clientY: point.y })
}

const dragBlock = (id: string, dx: number, dy: number) => {
  const block = blockAt(id)
  const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 }
  const to = { x: from.x + dx, y: from.y + dy }
  const element = blockElement(id)

  fireEvent.pointerDown(element, {
    clientX: from.x,
    clientY: from.y,
    button: 0,
    buttons: 1,
  })
  fireEvent.pointerMove(getCanvas(), { clientX: to.x, clientY: to.y, buttons: 1 })
  fireEvent.pointerUp(getCanvas(), { clientX: to.x, clientY: to.y, buttons: 0 })
}

/** The swatch button for one colour inside a labelled field. */
const swatch = (label: string, colour: string): HTMLElement =>
  screen.getByRole('button', { name: `${label}: ${colour}` })

const picker = (testId: string): HTMLInputElement => screen.getByTestId(testId)

const undoLabels = () => history().undoStack.map((command) => command.label)

describe('the properties panel appears with the selection', () => {
  it('is absent when nothing is selected', () => {
    seed(2)
    render(<App />)
    expect(screen.queryByTestId('properties-panel')).toBeNull()
  })

  it('appears when a block is selected', () => {
    const [a] = seed(2)
    render(<App />)
    select(required(a, 'block').id)

    expect(screen.getByTestId('properties-panel')).toBeInTheDocument()
    expect(screen.getByTestId('block-properties')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-properties')).toBeNull()
  })

  it('goes away again when the selection is cleared', () => {
    const [a] = seed(2)
    render(<App />)
    select(required(a, 'block').id)
    act(() => {
      store().clearSelection()
    })

    expect(screen.queryByTestId('properties-panel')).toBeNull()
  })

  it('shows a connection section for a selected arrow', () => {
    const [a, b] = seed(2)
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
    })
    render(<App />)
    act(() => {
      store().selectConnections('ab')
    })

    expect(screen.getByTestId('connection-properties')).toBeInTheDocument()
    expect(screen.queryByTestId('block-properties')).toBeNull()
  })

  it('shows both sections, separately, for a mixed selection', () => {
    // The deliberate choice: one section per kind rather than an intersection.
    // A block's border and an arrow's line are not the same property.
    const [a, b] = seed(2)
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
      store().setSelection([required(a, 'a').id], ['ab'])
    })
    render(<App />)

    expect(screen.getByTestId('block-properties')).toBeInTheDocument()
    expect(screen.getByTestId('connection-properties')).toBeInTheDocument()
  })
})

describe('editing a style across a selection', () => {
  it('applies a swatch to every selected block', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))

    fireEvent.click(swatch('Fill', '#4c8dff'))

    for (const block of blocks) {
      expect(blockAt(block.id).style?.fill).toBe('#4c8dff')
    }
  })

  it('records one entry, whatever the selection size', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))

    fireEvent.click(swatch('Fill', '#4c8dff'))
    expect(undoLabels()).toEqual(['Set fill'])
  })

  it('undo gives each block back its own original colour', () => {
    // The mutation this catches: a command storing one shared "before" value
    // would repaint all three the same on undo.
    const [a, b, c] = seed(3)
    const ids = [required(a, 'a').id, required(b, 'b').id, required(c, 'c').id]
    act(() => {
      store().updateBlocks({
        [ids[0] as string]: { style: { fill: '#111111' } },
        [ids[1] as string]: { style: { fill: '#222222' } },
      })
      useHistoryStore.getState().clear()
    })
    render(<App />)
    select(...ids)

    fireEvent.click(swatch('Fill', '#4c8dff'))
    act(() => {
      history().undo()
    })

    expect(blockAt(ids[0] as string).style?.fill).toBe('#111111')
    expect(blockAt(ids[1] as string).style?.fill).toBe('#222222')
    // The third had no style at all, and must go back to having none.
    expect(blockAt(ids[2] as string).style).toBeUndefined()
  })

  it('leaves an unselected block alone', () => {
    const [a, , c] = seed(3)
    render(<App />)
    select(required(a, 'a').id)

    fireEvent.click(swatch('Fill', '#4c8dff'))
    expect(blockAt(required(c, 'c').id).style).toBeUndefined()
  })

  it('edits a number field', () => {
    const [a] = seed(1)
    render(<App />)
    select(required(a, 'a').id)

    fireEvent.change(screen.getByTestId('number-text-size'), { target: { value: '28' } })
    expect(blockAt(required(a, 'a').id).style?.fontSize).toBe(28)
    expect(undoLabels()).toEqual(['Set text size'])
  })

  it('clamps a number field to its range', () => {
    const [a] = seed(1)
    render(<App />)
    select(required(a, 'a').id)

    fireEvent.change(screen.getByTestId('number-text-size'), { target: { value: '900' } })
    expect(blockAt(required(a, 'a').id).style?.fontSize).toBe(96)
  })

  it('styles a connection, dashes and all', () => {
    const [a, b] = seed(2)
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
    })
    render(<App />)
    act(() => {
      store().selectConnections('ab')
    })

    fireEvent.click(swatch('Line', '#e2683c'))
    fireEvent.click(screen.getByTestId('check-dashed'))

    expect(store().connections.ab?.style).toEqual({ stroke: '#e2683c', dashed: true })
    expect(undoLabels()).toEqual(['Set line colour', 'Set dashes'])
  })
})

describe('the mixed state', () => {
  it('shows a mixed badge when the fills disagree', () => {
    const [a, b] = seed(2)
    act(() => {
      store().updateBlocks({
        [required(a, 'a').id]: { style: { fill: '#111111' } },
        [required(b, 'b').id]: { style: { fill: '#222222' } },
      })
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    expect(screen.getAllByTestId('mixed-indicator').length).toBeGreaterThan(0)
  })

  it('shows no badge when they agree', () => {
    const [a, b] = seed(2)
    act(() => {
      store().updateBlocks({
        [required(a, 'a').id]: { style: { fill: '#111111' } },
        [required(b, 'b').id]: { style: { fill: '#111111' } },
      })
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    expect(screen.queryByTestId('mixed-indicator')).toBeNull()
  })

  it('marks no swatch active while the values are mixed', () => {
    // Marking the first block's swatch would speak for the rest of them.
    const [a, b] = seed(2)
    act(() => {
      store().updateBlocks({
        [required(a, 'a').id]: { style: { fill: '#4c8dff' } },
        [required(b, 'b').id]: { style: { fill: '#3fb984' } },
      })
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    expect(swatch('Fill', '#4c8dff')).toHaveAttribute('aria-pressed', 'false')
    expect(swatch('Fill', '#3fb984')).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the shared swatch active when the values agree', () => {
    const [a, b] = seed(2)
    act(() => {
      store().updateBlocks({
        [required(a, 'a').id]: { style: { fill: '#4c8dff' } },
        [required(b, 'b').id]: { style: { fill: '#4c8dff' } },
      })
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    expect(swatch('Fill', '#4c8dff')).toHaveAttribute('aria-pressed', 'true')
  })

  it('empties the number field and offers a Mixed placeholder', () => {
    const [a, b] = seed(2)
    act(() => {
      store().updateBlocks({
        [required(a, 'a').id]: { style: { fontSize: 12 } },
        [required(b, 'b').id]: { style: { fontSize: 30 } },
      })
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    const field: HTMLInputElement = screen.getByTestId('number-text-size')
    expect(field.value).toBe('')
    expect(field).toHaveAttribute('placeholder', 'Mixed')
  })

  it('shows the resolved default for blocks that set nothing', () => {
    const [a, b] = seed(2)
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    expect(screen.queryByTestId('mixed-indicator')).toBeNull()
    expect(picker('picker-fill').value).toBe(DEFAULT_BLOCK_STYLE.fill)
  })

  it('applies one value to all of a divergent selection when asked', () => {
    const [a, b] = seed(2)
    act(() => {
      store().updateBlocks({
        [required(a, 'a').id]: { style: { fill: '#111111' } },
        [required(b, 'b').id]: { style: { fill: '#222222' } },
      })
      useHistoryStore.getState().clear()
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)

    fireEvent.click(swatch('Fill', '#4c8dff'))
    expect(blockAt(required(a, 'a').id).style?.fill).toBe('#4c8dff')
    expect(blockAt(required(b, 'b').id).style?.fill).toBe('#4c8dff')
    expect(screen.queryByTestId('mixed-indicator')).toBeNull()
  })
})

describe('dragging the colour picker', () => {
  it('leaves exactly one history entry', () => {
    // A colour input fires `change` on every pointer move while it is open.
    // Without merging this run would be one entry per frame, and undo would
    // crawl back through the whole gradient the user swept.
    const [a] = seed(1)
    render(<App />)
    select(required(a, 'a').id)

    const input = picker('picker-fill')
    for (const value of ['#111111', '#222222', '#333333', '#444444', '#555555']) {
      fireEvent.change(input, { target: { value } })
    }

    expect(undoLabels()).toEqual(['Set fill'])
    expect(blockAt(required(a, 'a').id).style?.fill).toBe('#555555')
  })

  it('one undo walks the whole sweep back', () => {
    const [a] = seed(1)
    render(<App />)
    select(required(a, 'a').id)

    const input = picker('picker-fill')
    for (const value of ['#111111', '#222222', '#333333']) {
      fireEvent.change(input, { target: { value } })
    }
    act(() => {
      history().undo()
    })

    expect(blockAt(required(a, 'a').id).style).toBeUndefined()
  })

  it('keeps a different field as its own entry', () => {
    const [a] = seed(1)
    render(<App />)
    select(required(a, 'a').id)

    fireEvent.change(picker('picker-fill'), { target: { value: '#111111' } })
    fireEvent.change(picker('picker-border'), { target: { value: '#222222' } })

    expect(undoLabels()).toEqual(['Set fill', 'Set border colour'])
  })
})

describe('what a styled element renders', () => {
  it('sets no colour at all on an unstyled block', () => {
    // The rule that keeps Phase 6's themes able to repaint it.
    seed(1)
    render(<App />)
    const shape = required(
      getCanvas().querySelector<SVGRectElement>('.block__shape'),
      'block shape',
    )

    expect(shape.style.fill).toBe('')
    expect(shape.style.stroke).toBe('')
  })

  it('sets an inline fill once one is chosen', () => {
    // Inline, not a presentation attribute: an attribute sits below every
    // author rule in the SVG cascade, so `.block__shape` would win and the
    // block would render in the default colour with the attribute set.
    const [a] = seed(1)
    render(<App />)
    select(required(a, 'a').id)
    fireEvent.click(swatch('Fill', '#4c8dff'))

    const shape = required(
      getCanvas().querySelector<SVGRectElement>('.block__shape'),
      'block shape',
    )
    expect(shape.style.fill).toBe('rgb(76, 141, 255)')
    expect(shape.hasAttribute('fill')).toBe(false)
  })

  it('draws a halo under a selected arrow instead of recolouring it', () => {
    const [a, b] = seed(2)
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
        style: { stroke: '#e2683c' },
      })
    })
    render(<App />)
    act(() => {
      store().selectConnections('ab')
    })

    const line = required(
      getCanvas().querySelector<SVGPathElement>('.connection__line'),
      'line',
    )
    expect(getCanvas().querySelector('[data-testid="connection-halo"]')).not.toBeNull()
    // The chosen colour survives being selected, so the line and its
    // colour-keyed arrowhead cannot drift apart.
    expect(line.style.stroke).toBe('rgb(226, 104, 60)')
  })

  it('points a coloured arrow at the marker for its colour', () => {
    const [a, b] = seed(2)
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
    })
    render(<App />)
    act(() => {
      store().selectConnections('ab')
    })
    fireEvent.click(swatch('Line', '#e2683c'))

    const line = required(getCanvas().querySelector('.connection__line'), 'line')
    expect(line.getAttribute('marker-end')).toBe('url(#flowcraft-arrow-e2683c)')
    expect(getCanvas().querySelector('#flowcraft-arrow-e2683c')).not.toBeNull()
  })

  it('defines one marker per colour, not one per arrow', () => {
    const blocks = seed(4)
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(blocks[0], 'a').id,
        targetId: required(blocks[1], 'b').id,
        style: { stroke: '#e2683c' },
      })
      store().addConnection({
        id: 'cd',
        sourceId: required(blocks[2], 'c').id,
        targetId: required(blocks[3], 'd').id,
        style: { stroke: '#e2683c' },
      })
    })
    render(<App />)

    // Two arrows, one colour: the default marker plus one derived marker.
    expect(getCanvas().querySelectorAll('[data-testid="arrow-marker"]')).toHaveLength(2)
  })
})

describe('grouping', () => {
  const groupIds = () => store().groupOrder

  it('Ctrl+G groups the selection', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))

    press('g', { ctrlKey: true })

    expect(groupIds()).toHaveLength(1)
    expect(store().groups[groupIds()[0] ?? '']?.blockIds).toEqual(
      blocks.map((block) => block.id),
    )
    expect(undoLabels()).toEqual(['Group 3 blocks'])
  })

  it('refuses to group a single block', () => {
    const [a] = seed(2)
    render(<App />)
    select(required(a, 'a').id)

    press('g', { ctrlKey: true })
    expect(groupIds()).toEqual([])
    expect(undoLabels()).toEqual([])
  })

  it('Ctrl+Shift+G ungroups again', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))

    press('g', { ctrlKey: true })
    press('g', { ctrlKey: true, shiftKey: true })

    expect(groupIds()).toEqual([])
    expect(store().blockOrder).toHaveLength(2)
  })

  it('undoing a group puts it back on redo', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    act(() => {
      history().undo()
    })
    expect(groupIds()).toEqual([])

    act(() => {
      history().redo()
    })
    expect(groupIds()).toHaveLength(1)
  })

  it('clicking one member selects the whole group', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    act(() => {
      store().clearSelection()
    })

    clickBlock(required(blocks[1], 'b').id)

    expect([...store().selectedIds].sort()).toEqual(
      blocks.map((block) => block.id).sort(),
    )
  })

  it('clicking a member of no group still selects only that block', () => {
    const blocks = seed(3)
    render(<App />)
    select(required(blocks[0], 'a').id, required(blocks[1], 'b').id)
    press('g', { ctrlKey: true })
    act(() => {
      store().clearSelection()
    })

    clickBlock(required(blocks[2], 'c').id)
    expect(store().selectedIds).toEqual([required(blocks[2], 'c').id])
  })

  it('after ungrouping, clicking a member selects only that block', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    press('g', { ctrlKey: true, shiftKey: true })
    act(() => {
      store().clearSelection()
    })

    clickBlock(required(blocks[0], 'a').id)
    expect(store().selectedIds).toEqual([required(blocks[0], 'a').id])
  })

  it('double-clicking a member steps into the group', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    fireEvent.doubleClick(blockElement(required(blocks[0], 'a').id))
    expect(store().selectedIds).toEqual([required(blocks[0], 'a').id])
    // Stepping in must not open the editor as well.
    expect(screen.queryByLabelText('Block text')).toBeNull()
  })

  it('a second double-click inside the group edits the text', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    const element = blockElement(required(blocks[0], 'a').id)
    fireEvent.doubleClick(element)
    fireEvent.doubleClick(element)

    expect(screen.getByLabelText('Block text')).toBeInTheDocument()
  })

  it('double-clicking an ungrouped block edits it straight away', () => {
    const blocks = seed(2)
    render(<App />)

    fireEvent.doubleClick(blockElement(required(blocks[0], 'a').id))
    expect(screen.getByLabelText('Block text')).toBeInTheDocument()
  })

  it('draws a group outline distinct from the multi-selection box', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    expect(screen.getByTestId('group-bounds')).toBeInTheDocument()
    // The plain envelope is suppressed: two boxes round the same blocks would
    // say "selected together" twice and "grouped" not at all.
    expect(screen.queryByTestId('selection-bounds')).toBeNull()
  })

  it('shows both boxes when the selection is a group plus a loose block', () => {
    const blocks = seed(3)
    render(<App />)
    select(required(blocks[0], 'a').id, required(blocks[1], 'b').id)
    press('g', { ctrlKey: true })
    select(...blocks.map((block) => block.id))

    expect(screen.getByTestId('group-bounds')).toBeInTheDocument()
    expect(screen.getByTestId('selection-bounds')).toBeInTheDocument()
  })

  it('shows no group outline while only one member is selected', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    select(required(blocks[0], 'a').id)

    expect(screen.queryByTestId('group-bounds')).toBeNull()
  })
})

describe('moving a group', () => {
  it('moves every member, preserving the distances between them', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    act(() => {
      store().clearSelection()
    })

    const before = blocks.map((block) => ({ ...blockAt(block.id) }))
    // Grab one member; the whole group must come.
    dragBlock(required(blocks[1], 'b').id, 70, 40)

    for (const original of before) {
      const moved = blockAt(original.id)
      expect(moved.x).toBeCloseTo(original.x + 70, 5)
      expect(moved.y).toBeCloseTo(original.y + 40, 5)
    }
  })

  it('records the move as one entry naming every member', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    act(() => {
      store().clearSelection()
    })

    dragBlock(required(blocks[0], 'a').id, 50, 0)
    expect(undoLabels()).toEqual(['Group 3 blocks', 'Move 3 blocks'])
  })

  it('undo puts the whole group back', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    const before = blocks.map((block) => ({ ...blockAt(block.id) }))
    dragBlock(required(blocks[0], 'a').id, 90, 60)
    act(() => {
      history().undo()
    })

    for (const original of before) {
      expect(blockAt(original.id).x).toBeCloseTo(original.x, 5)
      expect(blockAt(original.id).y).toBeCloseTo(original.y, 5)
    }
  })

  it('a marquee touching one member takes the whole group', () => {
    const blocks = seed(3)
    render(<App />)
    select(required(blocks[0], 'a').id, required(blocks[1], 'b').id)
    press('g', { ctrlKey: true })
    act(() => {
      store().clearSelection()
    })

    // A box over the first block only; the second must come along.
    fireEvent.pointerDown(getCanvas(), { clientX: 0, clientY: 0, button: 0, buttons: 1 })
    fireEvent.pointerMove(getCanvas(), { clientX: 140, clientY: 200, buttons: 1 })
    fireEvent.pointerUp(getCanvas(), { clientX: 140, clientY: 200, buttons: 0 })

    expect([...store().selectedIds].sort()).toEqual(
      [required(blocks[0], 'a').id, required(blocks[1], 'b').id].sort(),
    )
  })
})

describe('deleting a group', () => {
  it('removes every member and cascades their connections', () => {
    const blocks = seed(3)
    const [a, b, c] = blocks
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
      store().addConnection({
        id: 'bc',
        sourceId: required(b, 'b').id,
        targetId: required(c, 'c').id,
      })
      useHistoryStore.getState().clear()
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)
    press('g', { ctrlKey: true })

    press('Delete')

    expect(store().blockOrder).toEqual([required(c, 'c').id])
    expect(store().connectionOrder).toEqual([])
    expect(store().groupOrder).toEqual([])
  })

  it('undo restores the members, the arrows and the group itself', () => {
    const blocks = seed(3)
    const [a, b, c] = blocks
    act(() => {
      store().addConnection({
        id: 'ab',
        sourceId: required(a, 'a').id,
        targetId: required(b, 'b').id,
      })
      store().addConnection({
        id: 'bc',
        sourceId: required(b, 'b').id,
        targetId: required(c, 'c').id,
      })
      useHistoryStore.getState().clear()
    })
    render(<App />)
    select(required(a, 'a').id, required(b, 'b').id)
    press('g', { ctrlKey: true })
    const groupId = store().groupOrder[0] ?? ''

    press('Delete')
    act(() => {
      history().undo()
    })

    expect(store().blockOrder).toEqual(blocks.map((block) => block.id))
    expect([...store().connectionOrder].sort()).toEqual(['ab', 'bc'])
    expect(store().groups[groupId]?.blockIds).toEqual([
      required(a, 'a').id,
      required(b, 'b').id,
    ])
  })

  it('deleting one member shrinks the group, and undo refills it', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    const groupId = store().groupOrder[0] ?? ''

    // Step into the group to single out one member, then delete just that one.
    fireEvent.doubleClick(blockElement(required(blocks[1], 'b').id))
    press('Delete')

    expect(store().groups[groupId]?.blockIds).toEqual([
      required(blocks[0], 'a').id,
      required(blocks[2], 'c').id,
    ])

    act(() => {
      history().undo()
    })
    expect(store().groups[groupId]?.blockIds).toEqual(blocks.map((block) => block.id))
  })
})

describe('copying a group', () => {
  it('copies the group along with wholly selected members', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    press('d', { ctrlKey: true })

    expect(store().groupOrder).toHaveLength(2)
    const copy = store().groups[store().groupOrder[1] ?? '']
    // Remapped, not pointing back at the originals.
    for (const id of copy?.blockIds ?? []) {
      expect(blocks.map((block) => block.id)).not.toContain(id)
    }
  })

  it('does not copy a group only part of which is selected', () => {
    const blocks = seed(3)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })

    // Step into the group, then duplicate just the one member.
    fireEvent.doubleClick(blockElement(required(blocks[0], 'a').id))
    press('d', { ctrlKey: true })

    expect(store().groupOrder).toHaveLength(1)
    expect(store().blockOrder).toHaveLength(4)
  })

  it('undoing the duplicate takes the copied group with it', () => {
    const blocks = seed(2)
    render(<App />)
    select(...blocks.map((block) => block.id))
    press('g', { ctrlKey: true })
    press('d', { ctrlKey: true })

    act(() => {
      history().undo()
    })
    expect(store().groupOrder).toHaveLength(1)
  })
})
