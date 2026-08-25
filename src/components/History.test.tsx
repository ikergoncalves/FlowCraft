import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useHistoryStore } from '../history/historyStore'
import { clearClipboard } from '../store/clipboard'
import { useDiagramStore } from '../store/diagramStore'
import type { Block } from '../types'
import { DEFAULT_VIEWPORT, GRID_SIZE } from '../utils/coords'

/*
 * Undo and redo as the user meets them: real gestures, real keystrokes, real
 * toolbar buttons.
 *
 * Assertions land on the store wherever the behaviour under test is about
 * state. Phase 3 had a test pass with the delete cascade turned off because a
 * DOM assertion was masked by a defensive guard in the canvas, and a history
 * bug hides in exactly that gap: the arrows can be missing from the document
 * while the picture still looks right.
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
    // Off, so every expected coordinate is the one the pointer produced rather
    // than the one the grid rounded it to.
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

interface BlockSpec {
  x: number
  y: number
  width?: number
  height?: number
  text?: string
}

/** Seeds blocks straight through the store, then empties the history. */
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
        text: spec.text ?? 'Block',
      }),
    )
    useHistoryStore.getState().clear()
  })
  return created
}

const blockElement = (id: string): Element =>
  required(getCanvas().querySelector(`[data-block-id="${id}"]`), `block ${id}`)

const handleElement = (handle: string): Element =>
  required(
    getCanvas().querySelector(`[data-resize-handle="${handle}"]`),
    `${handle} handle`,
  )

const blockAt = (id: string) => required(store().blocks[id], `block ${id} in the store`)

const centreOf = (block: Block) => ({
  x: block.x + block.width / 2,
  y: block.y + block.height / 2,
})

interface DragOptions {
  hold?: boolean
  midDrag?: () => void
  shiftKey?: boolean
}

const drag = (
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: DragOptions = {},
) => {
  const modifiers = { shiftKey: options.shiftKey ?? false }
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

/** Reveals a block's ports the way a pointer entering it would. */
const hover = (id: string) => {
  fireEvent.pointerOver(blockElement(id), { clientX: 0, clientY: 0 })
}

const dragFromPort = (source: Block, side: string, to: { x: number; y: number }) => {
  hover(source.id)
  const port = required(
    getCanvas().querySelector(`[data-port-side="${side}"]`),
    `${side} port`,
  )
  drag(port, centreOf(source), to)
}

const undoButton = () => screen.getByTestId('undo')
const redoButton = () => screen.getByTestId('redo')

const press = (key: string, modifiers: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyDown(document.body, { key, ...modifiers })
}

const undoLabels = () => history().undoStack.map((command) => command.label)

describe('moving', () => {
  it('records one entry per drag and puts the block back on undo', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 230, y: 90 })
    expect(blockAt(block.id)).toMatchObject({ x: 180, y: 60 })
    expect(undoLabels()).toEqual(['Move block'])

    act(() => {
      history().undo()
    })
    expect(blockAt(block.id)).toMatchObject({ x: 100, y: 100 })
  })

  it('redoes the move it just undid', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 230, y: 90 })
    act(() => {
      history().undo()
      history().redo()
    })
    expect(blockAt(block.id)).toMatchObject({ x: 180, y: 60 })
  })

  it('labels a multi-block move with its count and restores every block', () => {
    render(<App />)
    const [first, second] = seed({ x: 0, y: 0 }, { x: 300, y: 0 })
    if (!first || !second) throw new Error('missing seeds')

    act(() => {
      store().select([first.id, second.id])
    })
    drag(blockElement(first.id), { x: 50, y: 30 }, { x: 90, y: 30 })
    expect(undoLabels()).toEqual(['Move 2 blocks'])

    act(() => {
      history().undo()
    })
    expect(blockAt(first.id)).toMatchObject({ x: 0, y: 0 })
    expect(blockAt(second.id)).toMatchObject({ x: 300, y: 0 })
  })

  it('records nothing for a click that never moved', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    fireEvent.pointerDown(blockElement(block.id), {
      clientX: 150,
      clientY: 130,
      button: 0,
      buttons: 1,
    })
    fireEvent.pointerUp(getCanvas(), { clientX: 150, clientY: 130, buttons: 0 })

    expect(undoLabels()).toEqual([])
  })

  it('records nothing when a marquee ends', () => {
    render(<App />)
    seed({ x: 100, y: 100 })

    drag(getCanvas(), { x: 400, y: 400 }, { x: 600, y: 600 })
    expect(undoLabels()).toEqual([])
  })

  it('records nothing when Escape cancels the drag', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    // An earlier edit, so "nothing was recorded" is provable rather than
    // vacuous: the undo after this must reach *that* edit.
    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 250, y: 130 })
    expect(blockAt(block.id)).toMatchObject({ x: 200, y: 100 })

    drag(
      blockElement(block.id),
      { x: 250, y: 130 },
      { x: 500, y: 400 },
      {
        hold: true,
        midDrag: () => {
          fireEvent.keyDown(window, { key: 'Escape' })
        },
      },
    )
    fireEvent.pointerUp(getCanvas(), { clientX: 500, clientY: 400, buttons: 0 })

    expect(blockAt(block.id)).toMatchObject({ x: 200, y: 100 })
    expect(undoLabels()).toEqual(['Move block'])

    act(() => {
      history().undo()
    })
    // Straight back past the cancelled gesture to the first drag's start.
    expect(blockAt(block.id)).toMatchObject({ x: 100, y: 100 })
  })
})

describe('resizing', () => {
  it('restores the exact box on undo', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100, width: 200, height: 120 })[0], 'block')
    act(() => {
      store().select(block.id)
    })

    drag(handleElement('se'), { x: 300, y: 220 }, { x: 380, y: 280 })
    expect(blockAt(block.id)).toMatchObject({ width: 280, height: 180 })
    expect(undoLabels()).toEqual(['Resize block'])

    act(() => {
      history().undo()
    })
    expect(blockAt(block.id)).toMatchObject({
      x: 100,
      y: 100,
      width: 200,
      height: 120,
    })
  })

  it('records nothing for a resize that changed no dimension', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100, width: 200, height: 120 })[0], 'block')
    act(() => {
      store().select(block.id)
    })

    // Out and back to exactly where it started.
    drag(handleElement('se'), { x: 300, y: 220 }, { x: 360, y: 260 }, { hold: true })
    fireEvent.pointerMove(getCanvas(), { clientX: 300, clientY: 220, buttons: 1 })
    fireEvent.pointerUp(getCanvas(), { clientX: 300, clientY: 220, buttons: 0 })

    expect(blockAt(block.id)).toMatchObject({ width: 200, height: 120 })
    expect(undoLabels()).toEqual([])
  })
})

describe('text editing', () => {
  it('is one entry for the whole edit, not one per keystroke', async () => {
    const user = userEvent.setup()
    render(<App />)
    const block = required(seed({ x: 100, y: 100, text: 'Before' })[0], 'block')

    fireEvent.doubleClick(blockElement(block.id))
    const input = screen.getByLabelText('Block text')
    await user.clear(input)
    await user.type(input, 'After{Enter}')

    expect(blockAt(block.id).text).toBe('After')
    // Five characters typed, one entry recorded.
    expect(undoLabels()).toEqual(['Edit text'])

    act(() => {
      history().undo()
    })
    expect(blockAt(block.id).text).toBe('Before')
  })

  it('records nothing when the text comes back unchanged', async () => {
    const user = userEvent.setup()
    render(<App />)
    const block = required(seed({ x: 100, y: 100, text: 'Same' })[0], 'block')

    fireEvent.doubleClick(blockElement(block.id))
    await user.type(screen.getByLabelText('Block text'), '{Enter}')

    expect(undoLabels()).toEqual([])
  })

  it('records nothing when the edit is cancelled', async () => {
    const user = userEvent.setup()
    render(<App />)
    const block = required(seed({ x: 100, y: 100, text: 'Before' })[0], 'block')

    fireEvent.doubleClick(blockElement(block.id))
    await user.type(screen.getByLabelText('Block text'), 'Discarded{Escape}')

    expect(blockAt(block.id).text).toBe('Before')
    expect(undoLabels()).toEqual([])
  })

  it('keeps editor keystrokes away from the global shortcuts', async () => {
    const user = userEvent.setup()
    render(<App />)
    const block = required(seed({ x: 100, y: 100, text: 'Before' })[0], 'block')

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 250, y: 130 })
    fireEvent.doubleClick(blockElement(block.id))

    const input = screen.getByLabelText('Block text')
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })

    // The input's own undo owns Ctrl+Z while it is open; the diagram's must
    // not also fire and rewind the drag underneath the editor.
    expect(blockAt(block.id)).toMatchObject({ x: 200, y: 100 })
    await user.type(input, '{Escape}')
  })
})

describe('block creation', () => {
  it('undoes a created block and puts the selection back', () => {
    render(<App />)
    const existing = required(seed({ x: 0, y: 0 })[0], 'block')
    act(() => {
      store().select(existing.id)
      store().setTool('rect')
    })

    fireEvent.click(getCanvas(), { clientX: 500, clientY: 400 })
    expect(store().blockOrder).toHaveLength(2)
    expect(undoLabels()).toEqual(['Add block'])

    act(() => {
      history().undo()
    })
    expect(store().blockOrder).toEqual([existing.id])
    // The selection the creation replaced comes back with it.
    expect(store().selectedIds).toEqual([existing.id])
  })
})

describe('connections', () => {
  it('undoes only the connection, leaving both blocks alone', () => {
    render(<App />)
    const [source, target] = seed({ x: 0, y: 0 }, { x: 400, y: 0 })
    if (!source || !target) throw new Error('missing seeds')

    dragFromPort(source, 'e', centreOf(target))
    expect(store().connectionOrder).toHaveLength(1)
    expect(undoLabels()).toEqual(['Add connection'])

    act(() => {
      history().undo()
    })
    expect(store().connectionOrder).toEqual([])
    expect(store().blockOrder).toEqual([source.id, target.id])
  })

  it('records nothing when the connect drag is released over empty canvas', () => {
    render(<App />)
    const source = required(seed({ x: 0, y: 0 })[0], 'block')

    dragFromPort(source, 'e', { x: 800, y: 700 })
    expect(store().connectionOrder).toEqual([])
    expect(undoLabels()).toEqual([])
  })

  it('restores a deleted block together with its arrows and their anchors', () => {
    render(<App />)
    const [source, target] = seed({ x: 0, y: 0 }, { x: 400, y: 0 })
    if (!source || !target) throw new Error('missing seeds')

    dragFromPort(source, 'e', centreOf(target))
    const connection = required(
      store().connections[required(store().connectionOrder[0], 'connection id')],
      'connection',
    )

    act(() => {
      store().select(source.id)
    })
    press('Delete')

    // Store, not DOM: the canvas skips painting a dangling arrow, so a missing
    // cascade would look identical either way on screen.
    expect(store().blockOrder).toEqual([target.id])
    expect(store().connectionOrder).toEqual([])
    expect(undoLabels()).toEqual(['Add connection', 'Delete block and connection'])

    act(() => {
      history().undo()
    })
    expect(store().blockOrder).toEqual([source.id, target.id])
    expect(store().connections[connection.id]).toEqual(connection)
    // And selected again, so the user can see what came back.
    expect(store().selectedIds).toEqual([source.id])
  })

  it('deletes a selected arrow on its own and restores just that', () => {
    render(<App />)
    const [source, target] = seed({ x: 0, y: 0 }, { x: 400, y: 0 })
    if (!source || !target) throw new Error('missing seeds')

    dragFromPort(source, 'e', centreOf(target))
    const id = required(store().connectionOrder[0], 'connection id')

    act(() => {
      store().selectConnections(id)
    })
    press('Delete')
    expect(undoLabels()).toEqual(['Add connection', 'Delete connection'])

    act(() => {
      history().undo()
    })
    expect(store().connectionOrder).toEqual([id])
    expect(store().blockOrder).toEqual([source.id, target.id])
    expect(store().selectedConnectionIds).toEqual([id])
  })
})

describe('keyboard shortcuts', () => {
  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z and Ctrl+Y', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 250, y: 130 })

    press('z', { ctrlKey: true })
    expect(blockAt(block.id).x).toBe(100)

    press('Z', { ctrlKey: true, shiftKey: true })
    expect(blockAt(block.id).x).toBe(200)

    press('z', { ctrlKey: true })
    press('y', { ctrlKey: true })
    expect(blockAt(block.id).x).toBe(200)
  })

  it('undoes with Cmd+Z as well', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 250, y: 130 })

    press('z', { metaKey: true })
    expect(blockAt(block.id).x).toBe(100)
  })

  it('leaves unlisted browser accelerators alone', () => {
    render(<App />)
    seed({ x: 100, y: 100 })

    // Ctrl+R must still reload rather than picking the rectangle tool.
    press('r', { ctrlKey: true })
    expect(store().tool).toBe('select')

    // And an unmodified R must still pick it.
    press('r')
    expect(store().tool).toBe('rect')
  })
})

describe('nudging with the arrow keys', () => {
  it('moves the selection one unit per press', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    act(() => {
      store().select(block.id)
    })

    press('ArrowRight')
    expect(blockAt(block.id)).toMatchObject({ x: 101, y: 100 })
    press('ArrowUp')
    expect(blockAt(block.id)).toMatchObject({ x: 101, y: 99 })
  })

  it('moves a grid step with Shift held', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    act(() => {
      store().select(block.id)
    })

    press('ArrowDown', { shiftKey: true })
    expect(blockAt(block.id)).toMatchObject({ y: 100 + GRID_SIZE })
  })

  it('still moves one raw unit when snapping is on', () => {
    render(<App />)
    const block = required(seed({ x: 103, y: 100 })[0], 'block')
    act(() => {
      store().setSnapToGrid(true)
      store().select(block.id)
    })

    press('ArrowRight')
    // 104, not 120: a nudge is a nudge, whatever the Snap toggle says.
    expect(blockAt(block.id)).toMatchObject({ x: 104 })
  })

  it('collapses a held key into a single undo entry', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    act(() => {
      store().select(block.id)
    })

    for (let i = 0; i < 8; i += 1) press('ArrowRight')
    expect(blockAt(block.id)).toMatchObject({ x: 108 })
    expect(undoLabels()).toEqual(['Move block'])

    act(() => {
      history().undo()
    })
    // All eight, in one press. One-unit-per-Ctrl+Z would be unusable.
    expect(blockAt(block.id)).toMatchObject({ x: 100 })
  })

  it('splits into two entries once the merge window has passed', () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      const block = required(seed({ x: 100, y: 100 })[0], 'block')
      act(() => {
        store().select(block.id)
      })

      press('ArrowRight')
      press('ArrowRight')
      expect(undoLabels()).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(1500)
      })
      press('ArrowRight')

      expect(undoLabels()).toEqual(['Move block', 'Move block'])
      expect(blockAt(block.id)).toMatchObject({ x: 103 })

      act(() => {
        history().undo()
      })
      // Only the press after the pause comes back.
      expect(blockAt(block.id)).toMatchObject({ x: 102 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not merge nudges of different selections', () => {
    render(<App />)
    const [first, second] = seed({ x: 0, y: 0 }, { x: 300, y: 0 })
    if (!first || !second) throw new Error('missing seeds')

    act(() => {
      store().select(first.id)
    })
    press('ArrowRight')
    act(() => {
      store().select(second.id)
    })
    press('ArrowRight')

    expect(undoLabels()).toEqual(['Move block', 'Move block'])
  })

  it('does nothing at all with an empty selection', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    press('ArrowRight')
    expect(blockAt(block.id)).toMatchObject({ x: 100 })
    expect(undoLabels()).toEqual([])
  })
})

describe('copy, paste and duplicate', () => {
  /** Two blocks wired together, plus an unrelated third. */
  const seedPair = () => {
    const [source, target, other] = seed(
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 0, y: 400 },
    )
    if (!source || !target || !other) throw new Error('missing seeds')
    act(() => {
      store().addConnection({
        id: 'link',
        sourceId: source.id,
        targetId: target.id,
        sourceAnchor: 'e',
      })
      useHistoryStore.getState().clear()
    })
    return { source, target, other }
  }

  it('remaps pasted connections onto the new ids and leaves the originals intact', () => {
    render(<App />)
    const { source, target } = seedPair()

    act(() => {
      store().select([source.id, target.id])
    })
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })

    const pastedIds = store().selectedIds
    expect(pastedIds).toHaveLength(2)
    expect(pastedIds).not.toContain(source.id)

    const pasted = required(
      store()
        .connectionOrder.map((id) => store().connections[id])
        .find((connection) => connection?.id !== 'link'),
      'pasted connection',
    )
    // The failure this guards against does not throw and does not look wrong:
    // the copies would simply stay wired to the blocks they came from.
    expect(pastedIds).toContain(pasted.sourceId)
    expect(pastedIds).toContain(pasted.targetId)
    expect(pasted.sourceId).not.toBe(source.id)
    expect(pasted.targetId).not.toBe(target.id)

    expect(store().connections.link).toMatchObject({
      sourceId: source.id,
      targetId: target.id,
    })
  })

  it('drops a connection with only one end copied', () => {
    render(<App />)
    const { source } = seedPair()

    act(() => {
      store().select(source.id)
    })
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })

    expect(store().blockOrder).toHaveLength(4)
    expect(store().connectionOrder).toEqual(['link'])
  })

  it('offsets the paste and staggers a second one', () => {
    render(<App />)
    const { source } = seedPair()

    act(() => {
      store().select(source.id)
    })
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })
    const first = required(store().selectedIds[0], 'first paste')

    press('v', { ctrlKey: true })
    const second = required(store().selectedIds[0], 'second paste')

    expect(blockAt(first)).toMatchObject({ x: GRID_SIZE, y: GRID_SIZE })
    // Not on top of the first, or three pastes would look like one block.
    expect(blockAt(second)).toMatchObject({ x: GRID_SIZE * 2, y: GRID_SIZE * 2 })
  })

  it('undoes a paste in one entry and puts the selection back', () => {
    render(<App />)
    const { source, target } = seedPair()

    act(() => {
      store().select([source.id, target.id])
    })
    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })
    expect(undoLabels()).toEqual(['Paste 2 blocks and connection'])

    act(() => {
      history().undo()
    })
    expect(store().blockOrder).toHaveLength(3)
    expect(store().connectionOrder).toEqual(['link'])
    expect(store().selectedIds).toEqual([source.id, target.id])
  })

  it('duplicates with Ctrl+D without touching the clipboard', () => {
    render(<App />)
    const { source, target, other } = seedPair()

    act(() => {
      store().select([source.id, target.id])
    })
    press('c', { ctrlKey: true })

    act(() => {
      store().select(other.id)
    })
    press('d', { ctrlKey: true })
    expect(undoLabels()).toEqual(['Duplicate block'])
    expect(store().blockOrder).toHaveLength(4)

    // The clipboard still holds the pair, not the block just duplicated.
    press('v', { ctrlKey: true })
    expect(store().selectedIds).toHaveLength(2)
    expect(undoLabels()).toEqual(['Duplicate block', 'Paste 2 blocks and connection'])
  })

  it('does nothing on an empty selection', () => {
    render(<App />)
    seedPair()

    press('c', { ctrlKey: true })
    press('v', { ctrlKey: true })
    press('d', { ctrlKey: true })

    expect(store().blockOrder).toHaveLength(3)
    expect(undoLabels()).toEqual([])
  })
})

describe('the toolbar buttons', () => {
  it('start disabled with a bare label', () => {
    render(<App />)

    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeDisabled()
    expect(undoButton()).toHaveAttribute('aria-label', 'Undo')
    expect(redoButton()).toHaveAttribute('aria-label', 'Redo')
  })

  it('enable and name the command they would run', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')
    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 250, y: 130 })

    expect(undoButton()).toBeEnabled()
    expect(undoButton()).toHaveAttribute('aria-label', 'Undo: Move block')
    expect(undoButton()).toHaveAttribute('title', 'Undo: Move block')
    expect(redoButton()).toBeDisabled()

    fireEvent.click(undoButton())

    expect(blockAt(block.id).x).toBe(100)
    expect(undoButton()).toBeDisabled()
    expect(redoButton()).toBeEnabled()
    expect(redoButton()).toHaveAttribute('aria-label', 'Redo: Move block')

    fireEvent.click(redoButton())
    expect(blockAt(block.id).x).toBe(200)
  })

  it('reflect a multi-block label', () => {
    render(<App />)
    const [first, second] = seed({ x: 0, y: 0 }, { x: 300, y: 0 })
    if (!first || !second) throw new Error('missing seeds')

    act(() => {
      store().select([first.id, second.id])
    })
    press('Delete')

    expect(undoButton()).toHaveAttribute('aria-label', 'Undo: Delete 2 blocks')
  })

  it('go dead again once the redo stack is dropped by a new edit', () => {
    render(<App />)
    const block = required(seed({ x: 100, y: 100 })[0], 'block')

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 250, y: 130 })
    fireEvent.click(undoButton())
    expect(redoButton()).toBeEnabled()

    drag(blockElement(block.id), { x: 150, y: 130 }, { x: 150, y: 230 })
    expect(redoButton()).toBeDisabled()
  })
})
