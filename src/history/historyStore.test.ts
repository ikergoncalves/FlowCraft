import { beforeEach, describe, expect, it } from 'vitest'
import { useDiagramStore } from '../store/diagramStore'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import type { Command, SelectionSnapshot } from './command'
import { EMPTY_SELECTION } from './command'
import { HISTORY_LIMIT, redoLabel, undoLabel, useHistoryStore } from './historyStore'

/*
 * The stack mechanics, tested against commands that only write to a log.
 *
 * Nothing here touches the diagram: whether a command puts a block back is the
 * next file's business. What matters here is that the stacks move the right
 * commands in the right direction, exactly once each.
 */

const history = () => useHistoryStore.getState()

beforeEach(() => {
  useHistoryStore.getState().clear()
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

interface Spy extends Command {
  applied: number
  reverted: number
}

function spyCommand(
  label: string,
  log: string[] = [],
  selection: { before?: SelectionSnapshot; after?: SelectionSnapshot } = {},
): Spy {
  const command: Spy = {
    label,
    applied: 0,
    reverted: 0,
    selectionBefore: selection.before ?? EMPTY_SELECTION,
    selectionAfter: selection.after ?? EMPTY_SELECTION,
    apply: () => {
      command.applied += 1
      log.push(`apply:${label}`)
    },
    revert: () => {
      command.reverted += 1
      log.push(`revert:${label}`)
    },
  }
  return command
}

const labels = (stack: 'undoStack' | 'redoStack') =>
  useHistoryStore.getState()[stack].map((command) => command.label)

describe('running and recording', () => {
  it('applies a command and puts it on the undo stack', () => {
    const command = spyCommand('First')
    history().run(command)

    expect(command.applied).toBe(1)
    expect(labels('undoStack')).toEqual(['First'])
  })

  it('records without applying, for gestures that already moved the store', () => {
    const command = spyCommand('Drag')
    history().record(command)

    expect(command.applied).toBe(0)
    expect(labels('undoStack')).toEqual(['Drag'])
  })

  it('starts with nothing to undo or redo', () => {
    expect(undoLabel(history())).toBeNull()
    expect(redoLabel(history())).toBeNull()
  })
})

describe('undo and redo', () => {
  it('reverts the newest command and moves it to the redo stack', () => {
    const log: string[] = []
    history().run(spyCommand('First', log))
    history().run(spyCommand('Second', log))
    history().undo()

    expect(log).toEqual(['apply:First', 'apply:Second', 'revert:Second'])
    expect(labels('undoStack')).toEqual(['First'])
    expect(labels('redoStack')).toEqual(['Second'])
  })

  it('re-applies on redo and moves the command back', () => {
    const log: string[] = []
    history().run(spyCommand('Only', log))
    history().undo()
    history().redo()

    expect(log).toEqual(['apply:Only', 'revert:Only', 'apply:Only'])
    expect(labels('undoStack')).toEqual(['Only'])
    expect(labels('redoStack')).toEqual([])
  })

  it('walks the whole stack back in order and forward again', () => {
    const log: string[] = []
    for (const label of ['A', 'B', 'C']) history().run(spyCommand(label, log))
    history().undo()
    history().undo()
    history().undo()

    expect(log.slice(3)).toEqual(['revert:C', 'revert:B', 'revert:A'])

    history().redo()
    history().redo()
    history().redo()
    expect(log.slice(6)).toEqual(['apply:A', 'apply:B', 'apply:C'])
  })

  it('does nothing when there is nothing to undo or redo', () => {
    expect(() => {
      history().undo()
      history().redo()
    }).not.toThrow()
    expect(labels('undoStack')).toEqual([])
    expect(labels('redoStack')).toEqual([])
  })

  it('reports the label of whatever is next in each direction', () => {
    history().run(spyCommand('Move 3 blocks'))
    expect(undoLabel(history())).toBe('Move 3 blocks')
    expect(redoLabel(history())).toBeNull()

    history().undo()
    expect(undoLabel(history())).toBeNull()
    expect(redoLabel(history())).toBe('Move 3 blocks')
  })
})

describe('the redo stack', () => {
  it('is cleared by a new command', () => {
    history().run(spyCommand('First'))
    history().undo()
    expect(labels('redoStack')).toEqual(['First'])

    history().run(spyCommand('Second'))
    // The future 'First' described branched away the moment 'Second' ran.
    expect(labels('redoStack')).toEqual([])
    expect(labels('undoStack')).toEqual(['Second'])
  })

  it('is cleared by a plain record, not just by run', () => {
    history().run(spyCommand('First'))
    history().undo()
    history().record(spyCommand('Gesture'))

    expect(labels('redoStack')).toEqual([])
  })

  it('survives an undo of an undo — redo does not clear it', () => {
    for (const label of ['A', 'B', 'C']) history().run(spyCommand(label))
    history().undo()
    history().undo()
    expect(labels('redoStack')).toEqual(['C', 'B'])

    history().redo()
    expect(labels('redoStack')).toEqual(['C'])
    expect(labels('undoStack')).toEqual(['A', 'B'])
  })
})

describe('the reentrancy guard', () => {
  it('ignores a record raised from inside a revert', () => {
    const sneaky: Command = {
      label: 'Sneaky',
      selectionBefore: EMPTY_SELECTION,
      selectionAfter: EMPTY_SELECTION,
      apply: () => {},
      revert: () => {
        // Exactly what a naive "record on every store change" hook would do.
        useHistoryStore.getState().record(spyCommand('Echo'))
      },
    }

    history().run(sneaky)
    history().undo()

    // Undoing must not leave a new entry behind, or Ctrl+Z would toggle
    // between two states forever instead of walking backwards.
    expect(labels('undoStack')).toEqual([])
    expect(labels('redoStack')).toEqual(['Sneaky'])
  })

  it('ignores a run raised from inside an apply during redo', () => {
    const nested = spyCommand('Nested')
    const outer: Command = {
      label: 'Outer',
      selectionBefore: EMPTY_SELECTION,
      selectionAfter: EMPTY_SELECTION,
      apply: () => {
        useHistoryStore.getState().run(nested)
      },
      revert: () => {},
    }

    // The first `run` is not reentrant, so the nested one goes through — and
    // lands first, because it finishes inside `outer.apply()`.
    history().run(outer)
    expect(labels('undoStack')).toEqual(['Nested', 'Outer'])

    history().clear()
    history().record(outer)
    history().undo()
    history().redo()

    expect(nested.applied).toBe(1) // only from the very first run
    expect(labels('undoStack')).toEqual(['Outer'])
  })

  it('leaves the guard down after a command throws', () => {
    const explosive: Command = {
      label: 'Boom',
      selectionBefore: EMPTY_SELECTION,
      selectionAfter: EMPTY_SELECTION,
      apply: () => {},
      revert: () => {
        throw new Error('boom')
      },
    }

    history().record(explosive)
    expect(() => {
      history().undo()
    }).toThrow('boom')

    // `finally` has to put the flag back, or the history is dead for the rest
    // of the session.
    expect(useHistoryStore.getState().applying).toBe(false)
    history().run(spyCommand('After'))
    expect(labels('undoStack')).toEqual(['After'])
  })
})

describe('the history limit', () => {
  it('keeps the newest entries and drops the oldest', () => {
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      history().run(spyCommand(`Edit ${i}`))
    }

    const stack = labels('undoStack')
    expect(stack).toHaveLength(HISTORY_LIMIT)
    expect(stack[0]).toBe('Edit 10')
    expect(stack[stack.length - 1]).toBe(`Edit ${HISTORY_LIMIT + 9}`)
  })

  it('still undoes correctly right after trimming', () => {
    const log: string[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      history().run(spyCommand(`Edit ${i}`, log))
    }
    history().undo()

    expect(log[log.length - 1]).toBe(`revert:Edit ${HISTORY_LIMIT + 4}`)
    expect(labels('undoStack')).toHaveLength(HISTORY_LIMIT - 1)
  })

  it('caps the stack when redo pushes onto a full one', () => {
    for (let i = 0; i < HISTORY_LIMIT; i += 1) history().run(spyCommand(`Edit ${i}`))
    history().undo()
    history().redo()

    expect(labels('undoStack')).toHaveLength(HISTORY_LIMIT)
  })
})

describe('selection', () => {
  const selection = (blockIds: string[]): SelectionSnapshot => ({
    blockIds,
    connectionIds: [],
  })

  it('is restored to the "before" state on undo', () => {
    const command = spyCommand('Delete block', [], {
      before: selection(['a', 'b']),
      after: EMPTY_SELECTION,
    })

    history().run(command)
    expect(useDiagramStore.getState().selectedIds).toEqual([])

    history().undo()
    // Restoring the elements without re-selecting them would leave the user
    // with no idea what just came back.
    expect(useDiagramStore.getState().selectedIds).toEqual(['a', 'b'])
  })

  it('is restored to the "after" state on redo', () => {
    const command = spyCommand('Paste block', [], {
      before: selection(['a']),
      after: selection(['copy']),
    })

    history().run(command)
    history().undo()
    expect(useDiagramStore.getState().selectedIds).toEqual(['a'])

    history().redo()
    expect(useDiagramStore.getState().selectedIds).toEqual(['copy'])
  })

  it('restores a mixed block-and-connection selection verbatim', () => {
    const command = spyCommand('Delete 1 block and 1 connection', [], {
      before: { blockIds: ['a'], connectionIds: ['ab'] },
      after: EMPTY_SELECTION,
    })

    history().run(command)
    history().undo()

    const state = useDiagramStore.getState()
    expect(state.selectedIds).toEqual(['a'])
    expect(state.selectedConnectionIds).toEqual(['ab'])
  })

  it('is not, on its own, an undoable command', () => {
    useDiagramStore.getState().addBlock({
      id: 'a',
      type: 'rect',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: '',
    })
    useHistoryStore.getState().clear()

    useDiagramStore.getState().select('a')
    useDiagramStore.getState().clearSelection()
    useDiagramStore.getState().selectAll()

    // Clicking around must not fill the history with entries that change
    // nothing anyone would call an edit.
    expect(labels('undoStack')).toEqual([])
  })
})
