import { useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { Tool } from '../types'

/** Tool shortcuts, keyed by `KeyboardEvent.key` in lower case. */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  r: 'rect',
  t: 'text',
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
 * Global editor shortcuts: V/R/T pick a tool, Delete/Backspace removes the
 * selection, Ctrl/Cmd + A selects everything, Escape clears the selection, and
 * 0 resets the view.
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
      if (isEditableTarget(event.target)) return

      const { selectedIds, setTool, removeBlocks, clearSelection, resetView, selectAll } =
        useDiagramStore.getState()

      // Ctrl/Cmd + A is the one accelerator this editor claims. Everything
      // below is an unmodified key, so modified events bow out right after —
      // no other browser shortcut gets swallowed.
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault()
          selectAll()
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const nextTool = TOOL_KEYS[event.key.toLowerCase()]
      if (nextTool) {
        event.preventDefault()
        setTool(nextTool)
        return
      }

      switch (event.key) {
        case 'Delete':
        case 'Backspace':
          if (selectedIds.length > 0) {
            event.preventDefault()
            removeBlocks(selectedIds)
          }
          return
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
