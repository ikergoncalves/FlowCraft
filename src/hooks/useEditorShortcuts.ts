import { useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { Tool } from '../types'

/** Tool shortcuts, keyed by `KeyboardEvent.key` in lower case. */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  r: 'rect',
  t: 'text',
}

/**
 * True when the event came from somewhere the user is typing, in which case
 * editor shortcuts must stay out of the way.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * Global editor shortcuts: V/R/T pick a tool, Delete/Backspace removes the
 * selection, Escape clears it, and 0 resets the view.
 *
 * Reads the store through `getState()` inside the handler so the listener can
 * be registered once instead of re-binding on every state change.
 */
export function useEditorShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return

      const { selectedIds, setTool, removeBlocks, clearSelection, resetView } =
        useDiagramStore.getState()

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
