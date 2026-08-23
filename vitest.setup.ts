import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * jsdom ships no ResizeObserver. The canvas only uses it to react to layout
 * changes, which never happen in a test, so an inert stub is enough — tests
 * that need a specific canvas size stub `getBoundingClientRect` instead.
 */
class ResizeObserverStub implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverStub
}

/**
 * jsdom implements PointerEvent but not pointer capture, which
 * @use-gesture calls on every pointerdown. No-ops are fine: capture only
 * affects which element keeps receiving moves, and tests dispatch directly.
 */
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
    return false
  }
}

afterEach(() => {
  cleanup()
})
