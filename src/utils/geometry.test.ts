import { describe, expect, it } from 'vitest'
import {
  HANDLE_CURSORS,
  MIN_BLOCK_SIZE,
  RESIZE_HANDLES,
  boundingBox,
  handlePositions,
  normalizeRect,
  rectContainsPoint,
  rectsIntersect,
  resizeRect,
  type Rect,
  type ResizeHandle,
} from './geometry'

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
})

describe('normalizeRect', () => {
  const expected = rect(10, 20, 90, 60)

  it('handles a drag towards the bottom-right', () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 100, y: 80 })).toEqual(expected)
  })

  it('handles a drag towards the top-left', () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 10, y: 20 })).toEqual(expected)
  })

  it('handles a drag towards the top-right', () => {
    expect(normalizeRect({ x: 10, y: 80 }, { x: 100, y: 20 })).toEqual(expected)
  })

  it('handles a drag towards the bottom-left', () => {
    expect(normalizeRect({ x: 100, y: 20 }, { x: 10, y: 80 })).toEqual(expected)
  })

  it('collapses to a zero-size rect when both corners coincide', () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(rect(5, 5, 0, 0))
  })

  it('copes with negative coordinates', () => {
    expect(normalizeRect({ x: -30, y: 10 }, { x: -10, y: -20 })).toEqual(
      rect(-30, -20, 20, 30),
    )
  })
})

describe('rectsIntersect', () => {
  const base = rect(0, 0, 100, 100)

  it('is true for a partial overlap', () => {
    expect(rectsIntersect(base, rect(50, 50, 100, 100))).toBe(true)
  })

  it('is true when one rect contains the other, either way round', () => {
    const inner = rect(20, 20, 10, 10)
    expect(rectsIntersect(base, inner)).toBe(true)
    expect(rectsIntersect(inner, base)).toBe(true)
  })

  it('counts edges that only touch as an intersection', () => {
    expect(rectsIntersect(base, rect(100, 0, 50, 50))).toBe(true)
    expect(rectsIntersect(base, rect(0, 100, 50, 50))).toBe(true)
    // Corner-to-corner contact is still contact.
    expect(rectsIntersect(base, rect(100, 100, 50, 50))).toBe(true)
  })

  it('is false for disjoint rects on either axis', () => {
    expect(rectsIntersect(base, rect(101, 0, 50, 50))).toBe(false)
    expect(rectsIntersect(base, rect(0, 101, 50, 50))).toBe(false)
    expect(rectsIntersect(base, rect(-60, -60, 50, 50))).toBe(false)
  })

  it('lets a zero-size rect act as a point probe', () => {
    expect(rectsIntersect(base, rect(50, 50, 0, 0))).toBe(true)
    expect(rectsIntersect(base, rect(150, 50, 0, 0))).toBe(false)
  })

  it('lets a zero-width marquee still cross what it passes over', () => {
    expect(rectsIntersect(base, rect(50, -20, 0, 200))).toBe(true)
  })
})

describe('rectContainsPoint', () => {
  const base = rect(10, 10, 80, 40)

  it('is true inside and on the edges', () => {
    expect(rectContainsPoint(base, { x: 50, y: 30 })).toBe(true)
    expect(rectContainsPoint(base, { x: 10, y: 10 })).toBe(true)
    expect(rectContainsPoint(base, { x: 90, y: 50 })).toBe(true)
  })

  it('is false outside', () => {
    expect(rectContainsPoint(base, { x: 9, y: 30 })).toBe(false)
    expect(rectContainsPoint(base, { x: 50, y: 51 })).toBe(false)
  })
})

describe('boundingBox', () => {
  it('returns null for an empty list', () => {
    expect(boundingBox([])).toBeNull()
  })

  it('returns an equal box for a single rect', () => {
    expect(boundingBox([rect(4, 8, 16, 32)])).toEqual(rect(4, 8, 16, 32))
  })

  it('spans several rects', () => {
    expect(
      boundingBox([rect(0, 0, 10, 10), rect(50, 20, 10, 10), rect(-20, 5, 5, 5)]),
    ).toEqual(rect(-20, 0, 80, 30))
  })

  it('ignores a rect fully inside another', () => {
    expect(boundingBox([rect(0, 0, 100, 100), rect(10, 10, 5, 5)])).toEqual(
      rect(0, 0, 100, 100),
    )
  })
})

describe('resizeRect', () => {
  const base = rect(100, 100, 200, 100)
  const right = base.x + base.width
  const bottom = base.y + base.height

  it('is the identity for a zero delta, on every handle', () => {
    for (const handle of RESIZE_HANDLES) {
      expect(resizeRect(base, handle, { x: 0, y: 0 })).toEqual(base)
    }
  })

  it('moves the west edge and pins the east one', () => {
    const next = resizeRect(base, 'w', { x: 40, y: 0 })
    expect(next).toEqual(rect(140, 100, 160, 100))
    expect(next.x + next.width).toBe(right)
  })

  it('moves the east edge and pins the west one', () => {
    const next = resizeRect(base, 'e', { x: 40, y: 0 })
    expect(next).toEqual(rect(100, 100, 240, 100))
    expect(next.x).toBe(base.x)
  })

  it('moves the north edge and pins the south one', () => {
    const next = resizeRect(base, 'n', { x: 0, y: 30 })
    expect(next).toEqual(rect(100, 130, 200, 70))
    expect(next.y + next.height).toBe(bottom)
  })

  it('moves the south edge and pins the north one', () => {
    const next = resizeRect(base, 's', { x: 0, y: 30 })
    expect(next).toEqual(rect(100, 100, 200, 130))
    expect(next.y).toBe(base.y)
  })

  it('ignores the off-axis component of an edge handle drag', () => {
    expect(resizeRect(base, 'e', { x: 40, y: 999 })).toEqual(
      resizeRect(base, 'e', { x: 40, y: 0 }),
    )
    expect(resizeRect(base, 'n', { x: 999, y: 30 })).toEqual(
      resizeRect(base, 'n', { x: 0, y: 30 }),
    )
  })

  it('drags the NW corner while holding SE still', () => {
    const next = resizeRect(base, 'nw', { x: 20, y: 10 })
    expect(next).toEqual(rect(120, 110, 180, 90))
    expect(next.x + next.width).toBe(right)
    expect(next.y + next.height).toBe(bottom)
  })

  it('drags the NE corner while holding SW still', () => {
    const next = resizeRect(base, 'ne', { x: 20, y: 10 })
    expect(next).toEqual(rect(100, 110, 220, 90))
    expect(next.x).toBe(base.x)
    expect(next.y + next.height).toBe(bottom)
  })

  it('drags the SE corner while holding NW still', () => {
    const next = resizeRect(base, 'se', { x: 20, y: 10 })
    expect(next).toEqual(rect(100, 100, 220, 110))
    expect(next.x).toBe(base.x)
    expect(next.y).toBe(base.y)
  })

  it('drags the SW corner while holding NE still', () => {
    const next = resizeRect(base, 'sw', { x: 20, y: 10 })
    expect(next).toEqual(rect(120, 100, 180, 110))
    expect(next.x + next.width).toBe(right)
    expect(next.y).toBe(base.y)
  })

  it('stops at the minimum size instead of inverting', () => {
    const next = resizeRect(base, 'e', { x: -5000, y: 0 })
    expect(next.width).toBe(MIN_BLOCK_SIZE)
    expect(next.x).toBe(base.x)
  })

  it('keeps the anchor when a min-edge handle overshoots its anchor', () => {
    const next = resizeRect(base, 'nw', { x: 5000, y: 5000 })
    expect(next.width).toBe(MIN_BLOCK_SIZE)
    expect(next.height).toBe(MIN_BLOCK_SIZE)
    // The SE corner is still exactly where it was, and the box did not
    // escape past it.
    expect(next.x + next.width).toBe(right)
    expect(next.y + next.height).toBe(bottom)
    expect(next.x).toBeLessThan(right)
    expect(next.y).toBeLessThan(bottom)
  })

  it('honours a custom minimum', () => {
    const next = resizeRect(base, 'se', { x: -5000, y: -5000 }, { minSize: 50 })
    expect(next).toEqual(rect(100, 100, 50, 50))
  })

  it('never returns a negative dimension, whatever the handle', () => {
    for (const handle of RESIZE_HANDLES) {
      const next = resizeRect(base, handle, { x: -9999, y: -9999 })
      expect(next.width).toBeGreaterThan(0)
      expect(next.height).toBeGreaterThan(0)
    }
  })

  describe('preserveAspect', () => {
    const ratio = base.width / base.height

    it('keeps the ratio on every corner handle', () => {
      for (const handle of ['nw', 'ne', 'se', 'sw'] as const) {
        const next = resizeRect(base, handle, { x: 60, y: 5 }, { preserveAspect: true })
        expect(next.width / next.height).toBeCloseTo(ratio, 10)
      }
    })

    it('follows whichever axis was pushed proportionally further', () => {
      // +60 on a 200-wide box is +30%; +5 on a 100-tall box is only +5%.
      const next = resizeRect(base, 'se', { x: 60, y: 5 }, { preserveAspect: true })
      expect(next.width).toBeCloseTo(260, 10)
      expect(next.height).toBeCloseTo(130, 10)
    })

    it('still pins the anchor corner', () => {
      const next = resizeRect(base, 'nw', { x: -60, y: -5 }, { preserveAspect: true })
      expect(next.x + next.width).toBeCloseTo(right, 10)
      expect(next.y + next.height).toBeCloseTo(bottom, 10)
    })

    it('clears the minimum on both axes without breaking the ratio', () => {
      const next = resizeRect(
        base,
        'se',
        { x: -5000, y: -5000 },
        { preserveAspect: true },
      )
      expect(next.width).toBeGreaterThanOrEqual(MIN_BLOCK_SIZE)
      expect(next.height).toBeGreaterThanOrEqual(MIN_BLOCK_SIZE)
      expect(next.width / next.height).toBeCloseTo(ratio, 10)
    })

    it('is ignored for edge handles, which have no corner to scale about', () => {
      expect(resizeRect(base, 'e', { x: 40, y: 0 }, { preserveAspect: true })).toEqual(
        resizeRect(base, 'e', { x: 40, y: 0 }),
      )
    })

    it('falls back to plain resizing for a degenerate rect', () => {
      const flat = rect(0, 0, 0, 50)
      expect(resizeRect(flat, 'se', { x: 30, y: 30 }, { preserveAspect: true })).toEqual(
        resizeRect(flat, 'se', { x: 30, y: 30 }),
      )
    })
  })
})

describe('handlePositions', () => {
  it('puts the handles on the corners and edge midpoints', () => {
    expect(handlePositions(rect(10, 20, 100, 40))).toEqual({
      nw: { x: 10, y: 20 },
      n: { x: 60, y: 20 },
      ne: { x: 110, y: 20 },
      e: { x: 110, y: 40 },
      se: { x: 110, y: 60 },
      s: { x: 60, y: 60 },
      sw: { x: 10, y: 60 },
      w: { x: 10, y: 40 },
    })
  })

  it('covers every handle exactly once, with a cursor for each', () => {
    expect(new Set(RESIZE_HANDLES).size).toBe(RESIZE_HANDLES.length)
    const positions = handlePositions(rect(0, 0, 10, 10))
    for (const handle of RESIZE_HANDLES) {
      expect(positions[handle]).toBeDefined()
      expect(HANDLE_CURSORS[handle]).toMatch(/-resize$/)
    }
    expect(Object.keys(positions).sort()).toEqual([...RESIZE_HANDLES].sort())
  })

  it('agrees with the edge each handle drags', () => {
    const base = rect(100, 100, 200, 100)
    const positions = handlePositions(base)
    const opposite: Record<ResizeHandle, ResizeHandle> = {
      nw: 'se',
      n: 's',
      ne: 'sw',
      e: 'w',
      se: 'nw',
      s: 'n',
      sw: 'ne',
      w: 'e',
    }

    for (const handle of RESIZE_HANDLES) {
      const resized = resizeRect(base, handle, { x: 10, y: 10 })
      // The handle opposite the dragged one must not have moved.
      expect(handlePositions(resized)[opposite[handle]]).toEqual(
        positions[opposite[handle]],
      )
    }
  })
})
