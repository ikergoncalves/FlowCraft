import { describe, expect, it } from 'vitest'
import type { CanvasRect, Point, Viewport } from '../types'
import {
  DEFAULT_VIEWPORT,
  GRID_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  gridStepForZoom,
  panByScreenDelta,
  screenDeltaToWorld,
  screenToWorld,
  viewBoxFor,
  worldToScreen,
  zoomAtPoint,
  zoomFactorForWheel,
} from './coords'

const rect: CanvasRect = { left: 24, top: 64, width: 800, height: 600 }
const rectAtOrigin: CanvasRect = { left: 0, top: 0, width: 1024, height: 768 }

const viewports: Viewport[] = [
  DEFAULT_VIEWPORT,
  { x: 0, y: 0, zoom: 0.1 },
  { x: 0, y: 0, zoom: 4 },
  { x: -320.5, y: 128.25, zoom: 0.37 },
  { x: 1000, y: -2500, zoom: 2.75 },
]

const points: Point[] = [
  { x: 0, y: 0 },
  { x: 24, y: 64 },
  { x: 413.5, y: 220.75 },
  { x: -100, y: -60 },
]

function expectClose(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 9)
  expect(actual.y).toBeCloseTo(expected.y, 9)
}

describe('screenToWorld / worldToScreen', () => {
  it('round-trips screen -> world -> screen across zooms and offsets', () => {
    for (const viewport of viewports) {
      for (const point of points) {
        const world = screenToWorld(point, viewport, rect)
        expectClose(worldToScreen(world, viewport, rect), point)
      }
    }
  })

  it('round-trips world -> screen -> world across zooms and offsets', () => {
    for (const viewport of viewports) {
      for (const point of points) {
        const screen = worldToScreen(point, viewport, rect)
        expectClose(screenToWorld(screen, viewport, rect), point)
      }
    }
  })

  it('maps the canvas top-left corner to the viewport origin', () => {
    const viewport: Viewport = { x: 150, y: -75, zoom: 2 }
    expectClose(screenToWorld({ x: rect.left, y: rect.top }, viewport, rect), {
      x: viewport.x,
      y: viewport.y,
    })
  })

  it('subtracts the canvas offset, so an offset canvas shifts the mapping', () => {
    const centered = screenToWorld({ x: 100, y: 100 }, DEFAULT_VIEWPORT, rect)
    const atOrigin = screenToWorld({ x: 100, y: 100 }, DEFAULT_VIEWPORT, rectAtOrigin)
    expect(centered).toEqual({ x: 100 - rect.left, y: 100 - rect.top })
    expect(atOrigin).toEqual({ x: 100, y: 100 })
  })

  it('scales world distances by the zoom factor on screen', () => {
    const viewport: Viewport = { x: 0, y: 0, zoom: 3 }
    const a = worldToScreen({ x: 0, y: 0 }, viewport, rectAtOrigin)
    const b = worldToScreen({ x: 10, y: 20 }, viewport, rectAtOrigin)
    expect(b.x - a.x).toBeCloseTo(30)
    expect(b.y - a.y).toBeCloseTo(60)
  })
})

describe('clampZoom', () => {
  it('keeps in-range values untouched', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(0.5)).toBe(0.5)
    expect(clampZoom(3.999)).toBe(3.999)
  })

  it('clamps to the documented 0.1x - 4x limits', () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM)
    expect(clampZoom(-5)).toBe(MIN_ZOOM)
    expect(clampZoom(1000)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(MIN_ZOOM)
  })

  it('accepts the boundaries themselves', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
  })

  it('collapses NaN to the minimum rather than propagating it', () => {
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
  })
})

describe('zoomAtPoint', () => {
  const cursors: Point[] = [
    { x: rect.left, y: rect.top },
    { x: 300, y: 250 },
    { x: rect.left + rect.width, y: rect.top + rect.height },
  ]

  it('keeps the world point under the cursor fixed', () => {
    for (const viewport of viewports) {
      for (const cursor of cursors) {
        for (const nextZoom of [0.25, 0.8, 1, 1.6, 3.5]) {
          const before = screenToWorld(cursor, viewport, rect)
          const zoomed = zoomAtPoint(viewport, cursor, rect, nextZoom)
          const after = screenToWorld(cursor, zoomed, rect)
          expectClose(after, before)
        }
      }
    }
  })

  it('still pins the cursor when the requested zoom is clamped', () => {
    const viewport: Viewport = { x: 40, y: 90, zoom: 1 }
    const cursor: Point = { x: 500, y: 400 }
    const before = screenToWorld(cursor, viewport, rect)

    const tooFarIn = zoomAtPoint(viewport, cursor, rect, 50)
    expect(tooFarIn.zoom).toBe(MAX_ZOOM)
    expectClose(screenToWorld(cursor, tooFarIn, rect), before)

    const tooFarOut = zoomAtPoint(viewport, cursor, rect, 0.0001)
    expect(tooFarOut.zoom).toBe(MIN_ZOOM)
    expectClose(screenToWorld(cursor, tooFarOut, rect), before)
  })

  it('leaves the viewport unchanged when the zoom does not change', () => {
    const viewport: Viewport = { x: 12, y: 34, zoom: 1.5 }
    const result = zoomAtPoint(viewport, { x: 200, y: 200 }, rect, 1.5)
    expect(result.x).toBeCloseTo(viewport.x, 9)
    expect(result.y).toBeCloseTo(viewport.y, 9)
    expect(result.zoom).toBe(viewport.zoom)
  })

  it('returns to the starting viewport after zooming in and back out', () => {
    const viewport: Viewport = { x: -60, y: 15, zoom: 1 }
    const cursor: Point = { x: 420, y: 310 }
    const zoomedIn = zoomAtPoint(viewport, cursor, rect, 2)
    const backOut = zoomAtPoint(zoomedIn, cursor, rect, 1)
    expectClose(backOut, viewport)
    expect(backOut.zoom).toBe(viewport.zoom)
  })
})

describe('zoomFactorForWheel', () => {
  it('scrolling up zooms in, scrolling down zooms out', () => {
    expect(zoomFactorForWheel(-100)).toBeGreaterThan(1)
    expect(zoomFactorForWheel(100)).toBeLessThan(1)
  })

  it('is neutral for a zero delta', () => {
    expect(zoomFactorForWheel(0)).toBe(1)
  })

  it('is exactly reversible for opposite deltas', () => {
    expect(zoomFactorForWheel(120) * zoomFactorForWheel(-120)).toBeCloseTo(1, 12)
  })

  it('normalises line and page delta modes to larger steps than pixels', () => {
    expect(zoomFactorForWheel(3, 1)).toBeLessThan(zoomFactorForWheel(3, 0))
    expect(zoomFactorForWheel(3, 2)).toBeLessThan(zoomFactorForWheel(3, 1))
  })
})

describe('panByScreenDelta', () => {
  it('moves the content with the pointer', () => {
    const viewport: Viewport = { x: 100, y: 100, zoom: 1 }
    // Dragging right by 50px reveals 50 world units further left.
    expect(panByScreenDelta(viewport, 50, 20)).toEqual({ x: 50, y: 80, zoom: 1 })
  })

  it('converts the screen delta through the zoom factor', () => {
    const viewport: Viewport = { x: 0, y: 0, zoom: 2 }
    expect(panByScreenDelta(viewport, 50, 20)).toEqual({ x: -25, y: -10, zoom: 2 })
  })

  it('keeps the point under the pointer fixed while panning', () => {
    const viewport: Viewport = { x: 10, y: 10, zoom: 1.5 }
    const start: Point = { x: 300, y: 300 }
    const world = screenToWorld(start, viewport, rect)
    const panned = panByScreenDelta(viewport, 40, -25)
    expectClose(screenToWorld({ x: start.x + 40, y: start.y - 25 }, panned, rect), world)
  })
})

describe('viewBoxFor', () => {
  it('derives the visible world region from the viewport and canvas size', () => {
    expect(viewBoxFor({ x: 10, y: 20, zoom: 2 }, rectAtOrigin)).toBe('10 20 512 384')
    expect(viewBoxFor({ x: 0, y: 0, zoom: 0.5 }, rectAtOrigin)).toBe('0 0 2048 1536')
  })

  it('never emits a zero-sized viewBox', () => {
    const empty: CanvasRect = { left: 0, top: 0, width: 0, height: 0 }
    expect(viewBoxFor(DEFAULT_VIEWPORT, empty)).toBe('0 0 1 1')
  })
})

describe('gridStepForZoom', () => {
  it('uses the base grid size at 100%', () => {
    expect(gridStepForZoom(1)).toBe(GRID_SIZE)
  })

  it('doubles the step until the lattice stays readable when zoomed out', () => {
    expect(gridStepForZoom(0.1)).toBeGreaterThan(GRID_SIZE)
    expect(gridStepForZoom(0.1) * 0.1).toBeGreaterThanOrEqual(12)
  })

  it('always yields a power-of-two multiple of the base grid size', () => {
    for (const zoom of [0.1, 0.25, 0.5, 1, 2, 4]) {
      const ratio = gridStepForZoom(zoom) / GRID_SIZE
      expect(Number.isInteger(Math.log2(ratio))).toBe(true)
    }
  })
})

describe('screenDeltaToWorld', () => {
  it('passes a delta straight through at 100%', () => {
    expect(screenDeltaToWorld({ x: 40, y: -25 }, 1)).toEqual({ x: 40, y: -25 })
  })

  it('shrinks the world delta when zoomed in', () => {
    expect(screenDeltaToWorld({ x: 40, y: -25 }, 2)).toEqual({ x: 20, y: -12.5 })
    expect(screenDeltaToWorld({ x: 40, y: -25 }, 4)).toEqual({ x: 10, y: -6.25 })
  })

  it('grows the world delta when zoomed out', () => {
    expect(screenDeltaToWorld({ x: 40, y: -25 }, 0.5)).toEqual({ x: 80, y: -50 })
  })

  it('is the inverse of the world -> screen scaling', () => {
    const zoom = 2.5
    const world = screenDeltaToWorld({ x: 37, y: 91 }, zoom)
    expect(world.x * zoom).toBeCloseTo(37, 10)
    expect(world.y * zoom).toBeCloseTo(91, 10)
  })

  it('agrees with the difference of two converted screen points', () => {
    const viewport: Viewport = { x: 120, y: -40, zoom: 3 }
    const from: Point = { x: 200, y: 300 }
    const to: Point = { x: 260, y: 270 }

    const a = screenToWorld(from, viewport, rect)
    const b = screenToWorld(to, viewport, rect)
    const delta = screenDeltaToWorld(
      { x: to.x - from.x, y: to.y - from.y },
      viewport.zoom,
    )

    expect(delta.x).toBeCloseTo(b.x - a.x, 10)
    expect(delta.y).toBeCloseTo(b.y - a.y, 10)
  })

  it('clamps a nonsensical zoom rather than dividing by zero', () => {
    expect(Number.isFinite(screenDeltaToWorld({ x: 10, y: 10 }, 0).x)).toBe(true)
  })
})
