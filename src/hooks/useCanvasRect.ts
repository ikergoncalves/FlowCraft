import { useEffect, useState, type RefObject } from 'react'
import type { CanvasRect } from '../types'

const EMPTY_RECT: CanvasRect = { left: 0, top: 0, width: 0, height: 0 }

function sameRect(a: CanvasRect, b: CanvasRect): boolean {
  return (
    a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
  )
}

/**
 * Tracks an element's box in client pixels.
 *
 * `ResizeObserver` covers size changes; a capturing scroll listener and a
 * window resize listener cover position changes, which `ResizeObserver` does
 * not report. Everything downstream (`viewBox`, `screenToWorld`) depends on
 * both the size *and* the offset, so the whole rect is tracked.
 */
export function useCanvasRect(ref: RefObject<Element | null>): CanvasRect {
  const [rect, setRect] = useState<CanvasRect>(EMPTY_RECT)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const box = element.getBoundingClientRect()
      const next: CanvasRect = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }
      setRect((previous) => (sameRect(previous, next) ? previous : next))
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    // Capture phase so scrolling in any ancestor is seen too.
    window.addEventListener('scroll', measure, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [ref])

  return rect
}
