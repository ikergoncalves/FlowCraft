import { useEffect } from 'react'
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  nudgeSelection,
  pasteClipboard,
} from '../history/actions'
import { useHistoryStore } from '../history/historyStore'
import { useDiagramStore } from '../store/diagramStore'
import type { Point, Tool } from '../types'
import { GRID_SIZE } from '../utils/coords'

/** Tool shortcuts, keyed by `KeyboardEvent.key` in lower case. */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  r: 'rect',
  t: 'text',
}

/** Which way each arrow key points, as a unit vector in world space. */
const ARROW_KEYS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/** Elements that swallow keystrokes on their own. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * True when the event came from somewhere the user is typing, in which case
 * editor shortcuts must stay out of the way.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (EDITABLE_TAGS.has(target.tagName)) return true

  // `isContentEditable` is the browser's own answer and already accounts for
  // inheritance, but jsdom does not implement it (it reads `undefined`), so
  // the attribute is the fallback. `closest` covers descendants of an
  // editable region the same way `isContentEditable` would, and an explicit
  // `contenteditable="false"` correctly opts back out.
  if (target instanceof HTMLElement && target.isContentEditable) return true
  const editable = target.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}

/**
 * Handles the accelerators — the ones with Ctrl/Cmd held.
 *
 * Returns whether the event was claimed. Anything not on this list is left
 * alone with its default intact, which is the whole reason this is a lookup
 * rather than a blanket `preventDefault` on modified keys: Ctrl+R, Ctrl+T and
 * Ctrl+W still belong to the browser.
 */
function handleAccelerator(event: KeyboardEvent): boolean {
  const history = useHistoryStore.getState()
  const key = event.key.toLowerCase()

  switch (key) {
    case 'a':
      useDiagramStore.getState().selectAll()
      return true
    case 'z':
      // Shift+Ctrl+Z is the platform-neutral redo; plain Ctrl+Z undoes.
      if (event.shiftKey) history.redo()
      else history.undo()
      return true
    case 'y':
      // Ctrl+Y is redo out of Windows habit. Harmless elsewhere, and cheaper
      // than teaching half the users a second chord.
      if (event.shiftKey) return false
      history.redo()
      return true
    case 'd':
      if (event.shiftKey) return false
      duplicateSelection()
      return true
    case 'c':
      if (event.shiftKey) return false
      // Returns false when the selection is empty; either way the copy is
      // ours to claim, so the browser does not also try to copy the page.
      copySelection()
      return true
    case 'v':
      if (event.shiftKey) return false
      pasteClipboard()
      return true
    default:
      return false
  }
}

/**
 * Global editor shortcuts.
 *
 * | Key                      | Action                                    |
 * | ------------------------ | ----------------------------------------- |
 * | `V` / `R` / `T`          | pick a tool                               |
 * | `G`                      | toggle snapping                           |
 * | `Delete` / `Backspace`   | delete the selection                      |
 * | `Escape`                 | clear the selection                       |
 * | `0`                      | reset the view                            |
 * | Arrows                   | nudge the selection one unit              |
 * | `Shift` + arrows         | nudge it a grid step                      |
 * | `Ctrl/Cmd` + `A`         | select every block                        |
 * | `Ctrl/Cmd` + `Z`         | undo — `Shift` or `Ctrl/Cmd + Y` to redo  |
 * | `Ctrl/Cmd` + `D`         | duplicate the selection                   |
 * | `Ctrl/Cmd` + `C` / `V`   | copy / paste                              |
 *
 * Escape is also how a drag in progress is cancelled; the canvas claims it
 * first, from a capture-phase listener, so a cancelled drag does not also lose
 * its selection.
 *
 * Reads the store through `getState()` inside the handler so the listener can
 * be registered once instead of re-binding on every state change.
 */
export function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Nothing below may fire while the text editor has focus — least of all
      // Ctrl+Z, which the input's own undo owns while it is open.
      if (isEditableTarget(event.target)) return

      const { setTool, clearSelection, resetView, toggleSnapToGrid } =
        useDiagramStore.getState()

      // Alt is never part of an editor accelerator; it is the mid-gesture snap
      // inverter, and claiming Alt chords here would shadow the OS menu keys.
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (handleAccelerator(event)) event.preventDefault()
        // Claimed or not, a modified key is finished here: everything past
        // this point is an unmodified key.
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const arrow = ARROW_KEYS[event.key]
      if (arrow) {
        event.preventDefault()
        // A literal step either way — see `nudgeSelection` on why this
        // ignores the Snap toggle. Shift multiplies rather than snapping, so
        // holding it is predictable wherever the block happens to sit.
        const step = event.shiftKey ? GRID_SIZE : 1
        nudgeSelection(arrow.x * step, arrow.y * step)
        return
      }

      const nextTool = TOOL_KEYS[event.key.toLowerCase()]
      if (nextTool) {
        event.preventDefault()
        setTool(nextTool)
        return
      }

      // Snap has no tool of its own, so it gets a plain key like the tools do.
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault()
        toggleSnapToGrid()
        return
      }

      switch (event.key) {
        case 'Delete':
        case 'Backspace': {
          const { selectedIds, selectedConnectionIds } = useDiagramStore.getState()
          if (selectedIds.length > 0 || selectedConnectionIds.length > 0) {
            event.preventDefault()
            // Blocks, arrows and the cascade come out together as one history
            // entry — undoing a delete must put back everything it took.
            deleteSelection()
          }
          return
        }
        case 'Escape':
          clearSelection()
          return
        case '0':
          event.preventDefault()
          resetView()
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
