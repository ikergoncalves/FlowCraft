import { useEffect, useRef, useState, type RefObject } from 'react'
import { isEditableTarget } from './useEditorShortcuts'

export interface SpaceKeyState {
  /** For rendering — drives the grab cursor. */
  pressed: boolean
  /** For gesture handlers — always current, never a stale closure. */
  pressedRef: RefObject<boolean>
}

/**
 * Tracks whether the space bar is held, which turns a left-drag into a pan.
 *
 * Exposes both a state value and a ref: the state re-renders the cursor, the
 * ref is what the gesture handler reads without needing to re-bind.
 */
export function useSpaceKey(): SpaceKeyState {
  const [pressed, setPressed] = useState(false)
  const pressedRef = useRef(false)

  useEffect(() => {
    const apply = (value: boolean) => {
      pressedRef.current = value
      setPressed(value)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      if (isEditableTarget(event.target)) return
      // Space would otherwise scroll the page.
      event.preventDefault()
      apply(true)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      apply(false)
    }

    // A window blur (alt-tab mid-pan) never delivers the keyup.
    const onBlur = () => {
      apply(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return { pressed, pressedRef }
}
