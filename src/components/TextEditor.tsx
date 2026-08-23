import { useEffect, useRef, useState } from 'react'
import type { Block, CanvasRect, Viewport } from '../types'
import { worldToScreen } from '../utils/coords'

interface TextEditorProps {
  block: Block
  viewport: Viewport
  /** The canvas box in client pixels; the overlay is positioned inside it. */
  rect: CanvasRect
  onCommit: (text: string) => void
  onCancel: () => void
}

/**
 * An HTML input laid over the block being edited, positioned with
 * `worldToScreen` so it tracks pan and zoom.
 *
 * The draft lives in local state on purpose: the store should only see the
 * committed value, which keeps Phase 4's undo history one entry per edit
 * rather than one per keystroke.
 */
export function TextEditor({
  block,
  viewport,
  rect,
  onCommit,
  onCancel,
}: TextEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(block.text)
  // Escape must not let the blur handler commit on the way out.
  const cancelledRef = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const topLeft = worldToScreen({ x: block.x, y: block.y }, viewport, rect)

  return (
    <input
      ref={inputRef}
      className="text-editor"
      aria-label="Block text"
      value={draft}
      autoFocus
      style={{
        // worldToScreen returns client coordinates; the overlay is positioned
        // relative to the canvas container, so subtract its origin.
        left: topLeft.x - rect.left,
        top: topLeft.y - rect.top,
        width: block.width * viewport.zoom,
        height: block.height * viewport.zoom,
        fontSize: Math.max(10, 14 * viewport.zoom),
      }}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit(draft)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancelledRef.current = true
          onCancel()
        }
        // Keep Delete, V/R/T and friends from reaching the global shortcuts.
        event.stopPropagation()
      }}
      onBlur={() => {
        if (cancelledRef.current) return
        onCommit(draft)
      }}
    />
  )
}
