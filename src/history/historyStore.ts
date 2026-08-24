import { create } from 'zustand'
import { useDiagramStore } from '../store/diagramStore'
import type { Command, SelectionSnapshot } from './command'

/**
 * How many commands the undo stack keeps.
 *
 * Bounded because commands hold copies of whatever they touched, so an
 * unbounded stack is an unbounded copy of the document's history. A hundred
 * edits is far more than anyone walks back by hand, and the oldest entries are
 * dropped rather than the newest — losing the edit you just made would be
 * absurd.
 */
export const HISTORY_LIMIT = 100

export interface HistoryState {
  /** Oldest first; the last entry is what Ctrl+Z will undo. */
  undoStack: Command[]
  /** Last entry is what Ctrl+Shift+Z will redo. Cleared by any new command. */
  redoStack: Command[]
  /**
   * True only while `undo`/`redo` is running a command.
   *
   * An explicit guard rather than a "did this call come from a revert?"
   * inference: a command's `revert` calls the same store actions the editor
   * does, so any code path that records on a store change would happily record
   * the undo itself and make Ctrl+Z a no-op that toggles forever. `record` and
   * `run` both bow out while this is set, and they say so in one place.
   */
  applying: boolean

  /** Applies a command and records it. For edits history triggers itself. */
  run: (command: Command) => void
  /**
   * Records a command whose effect is already in the store.
   *
   * This is what a gesture uses: a drag has been updating the store live for
   * feedback, so by the time it ends the work is done and only the record is
   * missing. `apply` would be a no-op here, but calling it anyway would be a
   * lie about where the mutation came from.
   */
  record: (command: Command) => void
  undo: () => void
  redo: () => void
  clear: () => void
}

function restoreSelection(snapshot: SelectionSnapshot): void {
  useDiagramStore.getState().setSelection(snapshot.blockIds, snapshot.connectionIds)
}

/** Drops the oldest entries once the stack outgrows `HISTORY_LIMIT`. */
function capped(stack: Command[]): Command[] {
  return stack.length > HISTORY_LIMIT ? stack.slice(stack.length - HISTORY_LIMIT) : stack
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  undoStack: [],
  redoStack: [],
  applying: false,

  run: (command) => {
    if (get().applying) return
    command.apply()
    // Same three steps as `redo`, in the same order — an edit and a redo of
    // that edit must leave the editor in identical states, selection included.
    restoreSelection(command.selectionAfter)
    get().record(command)
  },

  record: (command) => {
    if (get().applying) return

    set((state) => {
      // Merging is the previous command's call — see `Command.mergeWith`.
      const top = state.undoStack[state.undoStack.length - 1]
      const merged = top?.mergeWith?.(command, Date.now()) ?? null
      const undoStack = merged
        ? [...state.undoStack.slice(0, -1), merged]
        : [...state.undoStack, command]

      // A new edit invalidates every redo: the future those commands describe
      // branched away the moment the document went somewhere else. Keeping
      // them would let redo replay an edit against a document it never saw.
      return { undoStack: capped(undoStack), redoStack: [] }
    })
  },

  undo: () => {
    const state = get()
    if (state.applying) return
    const command = state.undoStack[state.undoStack.length - 1]
    if (!command) return

    set({ applying: true })
    try {
      command.revert()
      restoreSelection(command.selectionBefore)
    } finally {
      // Moved between the stacks with a plain `set`, never through `record`:
      // an undo must not clear the redo stack it is feeding.
      set((current) => ({
        applying: false,
        undoStack: current.undoStack.slice(0, -1),
        redoStack: [...current.redoStack, command],
      }))
    }
  },

  redo: () => {
    const state = get()
    if (state.applying) return
    const command = state.redoStack[state.redoStack.length - 1]
    if (!command) return

    set({ applying: true })
    try {
      command.apply()
      restoreSelection(command.selectionAfter)
    } finally {
      set((current) => ({
        applying: false,
        redoStack: current.redoStack.slice(0, -1),
        undoStack: capped([...current.undoStack, command]),
      }))
    }
  },

  clear: () => {
    set({ undoStack: [], redoStack: [], applying: false })
  },
}))

/** The label of the command Ctrl+Z would undo, or `null` when there is none. */
export function undoLabel(state: HistoryState): string | null {
  return state.undoStack[state.undoStack.length - 1]?.label ?? null
}

/** The redo counterpart of `undoLabel`. */
export function redoLabel(state: HistoryState): string | null {
  return state.redoStack[state.redoStack.length - 1]?.label ?? null
}
