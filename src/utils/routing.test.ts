import { describe, expect, it } from 'vitest'
import type { AnchorSide, Point } from '../types'
import { ANCHOR_SIDES } from '../types'
import type { Rect } from './geometry'
import {
  ANCHOR_STUB,
  anchorPoint,
  chooseAnchors,
  pathFromPoints,
  routeConnection,
  type AnchorPair,
} from './routing'

const rect = (x: number, y: number, width = 100, height = 50): Rect => ({
  x,
  y,
  width,
  height,
})

/** Every coordinate of every point is a real number. */
const allFinite = (points: readonly Point[]): boolean =>
  points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))

/** Consecutive points share an x or a y — i.e. no diagonal segments. */
const allOrthogonal = (points: readonly Point[]): boolean => {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) return false
    if (Math.abs(a.x - b.x) > 1e-9 && Math.abs(a.y - b.y) > 1e-9) return false
  }
  return true
}

describe('anchorPoint', () => {
  const box = rect(10, 20, 100, 60)

  it('returns the midpoint of each edge', () => {
    expect(anchorPoint(box, 'n')).toEqual({ x: 60, y: 20 })
    expect(anchorPoint(box, 's')).toEqual({ x: 60, y: 80 })
    expect(anchorPoint(box, 'w')).toEqual({ x: 10, y: 50 })
    expect(anchorPoint(box, 'e')).toEqual({ x: 110, y: 50 })
  })

  it('puts every anchor of a zero-sized rect on the same point', () => {
    const dot = rect(42, 17, 0, 0)
    for (const side of ANCHOR_SIDES) {
      expect(anchorPoint(dot, side)).toEqual({ x: 42, y: 17 })
    }
  })

  it('handles a rect with only one dimension collapsed', () => {
    expect(anchorPoint(rect(0, 0, 100, 0), 'n')).toEqual({ x: 50, y: 0 })
    expect(anchorPoint(rect(0, 0, 100, 0), 's')).toEqual({ x: 50, y: 0 })
    expect(anchorPoint(rect(0, 0, 0, 100), 'w')).toEqual({ x: 0, y: 50 })
  })

  it('works with negative coordinates', () => {
    expect(anchorPoint(rect(-200, -100, 40, 20), 'e')).toEqual({ x: -160, y: -90 })
  })

  it('always lands on the rect boundary', () => {
    const box2 = rect(5, 7, 33, 21)
    for (const side of ANCHOR_SIDES) {
      const point = anchorPoint(box2, side)
      const onVerticalEdge = point.x === box2.x || point.x === box2.x + box2.width
      const onHorizontalEdge = point.y === box2.y || point.y === box2.y + box2.height
      expect(onVerticalEdge || onHorizontalEdge).toBe(true)
    }
  })
})

describe('chooseAnchors', () => {
  const source = rect(0, 0, 100, 50)

  it('exits east and enters west when the target is to the right', () => {
    expect(chooseAnchors(source, rect(400, 0))).toEqual({ source: 'e', target: 'w' })
  })

  it('exits west and enters east when the target is to the left', () => {
    expect(chooseAnchors(source, rect(-400, 0))).toEqual({ source: 'w', target: 'e' })
  })

  it('exits south and enters north when the target is below', () => {
    expect(chooseAnchors(source, rect(0, 400))).toEqual({ source: 's', target: 'n' })
  })

  it('exits north and enters south when the target is above', () => {
    expect(chooseAnchors(source, rect(0, -400))).toEqual({ source: 'n', target: 's' })
  })

  it('picks the axis with the larger separation on a diagonal', () => {
    // Mostly right, a little down.
    expect(chooseAnchors(source, rect(400, 80))).toEqual({ source: 'e', target: 'w' })
    // Mostly down, a little right.
    expect(chooseAnchors(source, rect(80, 400))).toEqual({ source: 's', target: 'n' })
  })

  it('breaks an exact diagonal tie in favour of the horizontal axis', () => {
    // Centres offset by (300, 300).
    expect(chooseAnchors(source, rect(300, 300))).toEqual({ source: 'e', target: 'w' })
  })

  it('still answers for overlapping blocks', () => {
    const anchors = chooseAnchors(source, rect(20, 10))
    expect(ANCHOR_SIDES).toContain(anchors.source)
    expect(ANCHOR_SIDES).toContain(anchors.target)
  })

  it('answers e/w for two concentric blocks rather than failing', () => {
    expect(chooseAnchors(source, rect(0, 0, 100, 50))).toEqual({
      source: 'e',
      target: 'w',
    })
  })

  it('inverts the pair when source and target are swapped', () => {
    const pairs: [Rect, Rect][] = [
      [rect(0, 0), rect(400, 0)],
      [rect(0, 0), rect(0, 400)],
      [rect(0, 0), rect(-400, 60)],
      [rect(0, 0), rect(60, -400)],
      [rect(10, 20, 33, 44), rect(500, 130, 21, 90)],
    ]

    for (const [a, b] of pairs) {
      const forward = chooseAnchors(a, b)
      const backward = chooseAnchors(b, a)
      expect(backward).toEqual({ source: forward.target, target: forward.source })
    }
  })

  it('picks sides that face each other', () => {
    const opposite: Record<AnchorSide, AnchorSide> = { n: 's', s: 'n', e: 'w', w: 'e' }
    for (const target of [rect(400, 0), rect(0, 400), rect(-400, 0), rect(0, -400)]) {
      const anchors = chooseAnchors(source, target)
      expect(anchors.target).toBe(opposite[anchors.source])
    }
  })
})

describe('routeConnection', () => {
  const ew: AnchorPair = { source: 'e', target: 'w' }

  it('starts on the source anchor and ends on the target anchor', () => {
    const source = rect(0, 0, 100, 50)
    const target = rect(300, 200, 100, 50)
    const anchors = chooseAnchors(source, target)

    const points = routeConnection(source, target, anchors)

    expect(points[0]).toEqual(anchorPoint(source, anchors.source))
    expect(points[points.length - 1]).toEqual(anchorPoint(target, anchors.target))
  })

  it('keeps every segment orthogonal', () => {
    const source = rect(0, 0, 100, 50)
    for (const target of [
      rect(300, 200),
      rect(-300, 200),
      rect(300, -200),
      rect(0, 400),
      rect(400, 0),
      rect(37, 511, 21, 87),
    ]) {
      const points = routeConnection(source, target, chooseAnchors(source, target))
      expect(allOrthogonal(points)).toBe(true)
    }
  })

  it('leaves the source edge perpendicular to it', () => {
    const source = rect(0, 0, 100, 50)
    const target = rect(300, 200)
    const points = routeConnection(source, target, ew)

    const [first, second] = points
    // An east exit means the first step is purely horizontal.
    expect(first?.y).toBe(second?.y)
    expect((second?.x ?? 0) > (first?.x ?? 0)).toBe(true)
  })

  it('arrives at the target edge perpendicular to it', () => {
    const source = rect(0, 0, 100, 50)
    const target = rect(300, 200)
    const points = routeConnection(source, target, ew)

    const last = points[points.length - 1]
    const penultimate = points[points.length - 2]
    // A west entry means the final step is purely horizontal.
    expect(last?.y).toBe(penultimate?.y)
    expect((last?.x ?? 0) > (penultimate?.x ?? 0)).toBe(true)
  })

  it('honours explicit anchors instead of re-deriving them', () => {
    const source = rect(0, 0, 100, 50)
    const target = rect(300, 200, 100, 50)

    const points = routeConnection(source, target, { source: 'n', target: 'e' })

    expect(points[0]).toEqual(anchorPoint(source, 'n'))
    expect(points[points.length - 1]).toEqual(anchorPoint(target, 'e'))
    expect(allOrthogonal(points)).toBe(true)
  })

  it('routes a plain horizontal pair as a straight line', () => {
    const points = routeConnection(rect(0, 0, 100, 50), rect(300, 0, 100, 50), ew)
    expect(points).toEqual([
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ])
  })

  it('bends exactly once when one side faces x and the other faces y', () => {
    const points = routeConnection(rect(0, 0, 100, 50), rect(300, 200, 100, 50), {
      source: 'e',
      target: 'n',
    })

    expect(points).toEqual([
      { x: 100, y: 25 },
      { x: 350, y: 25 },
      { x: 350, y: 200 },
    ])
  })

  it('jogs across the middle when both sides face the same axis', () => {
    const source = rect(0, 0, 100, 50)
    const target = rect(300, 200, 100, 50)

    const points = routeConnection(source, target, ew)

    expect(points).toEqual([
      { x: 100, y: 25 },
      { x: 200, y: 25 },
      { x: 200, y: 225 },
      { x: 300, y: 225 },
    ])
  })

  it('is stable: the same input always gives the same route', () => {
    const source = rect(13, 29, 77, 41)
    const target = rect(311, 187, 63, 95)
    const anchors = chooseAnchors(source, target)

    const first = routeConnection(source, target, anchors)
    const second = routeConnection(source, target, anchors)

    expect(second).toEqual(first)
  })

  it('respects a custom stub length', () => {
    const source = rect(0, 0, 100, 50)
    const target = rect(300, 200, 100, 50)

    const points = routeConnection(
      source,
      target,
      { source: 'e', target: 'n' },
      {
        stub: 40,
      },
    )

    // The elbow still sits on the target's x, so only the entry stub moves.
    expect(allOrthogonal(points)).toBe(true)
    expect(points[0]).toEqual({ x: 100, y: 25 })
  })

  describe('degenerate cases', () => {
    const expectSane = (points: Point[]) => {
      expect(allFinite(points)).toBe(true)
      expect(allOrthogonal(points)).toBe(true)
      expect(points.length).toBeGreaterThanOrEqual(2)
    }

    it('survives overlapping blocks', () => {
      const source = rect(0, 0, 100, 100)
      const target = rect(20, 20, 100, 100)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives a target completely inside the source', () => {
      const source = rect(0, 0, 400, 400)
      const target = rect(150, 150, 40, 40)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives blocks aligned on x', () => {
      const source = rect(0, 0, 100, 50)
      const target = rect(0, 400, 100, 50)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives blocks aligned on y', () => {
      const source = rect(0, 0, 100, 50)
      const target = rect(400, 0, 100, 50)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives blocks closer together than the stub', () => {
      const source = rect(0, 0, 100, 50)
      const target = rect(100 + ANCHOR_STUB / 4, 0, 100, 50)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives touching blocks', () => {
      const source = rect(0, 0, 100, 50)
      const target = rect(100, 0, 100, 50)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives zero-sized blocks', () => {
      const source = rect(0, 0, 0, 0)
      const target = rect(300, 200, 0, 0)
      expectSane(routeConnection(source, target, chooseAnchors(source, target)))
    })

    it('survives a block connected to itself without producing NaN', () => {
      const box = rect(50, 60, 100, 50)
      for (const side of ANCHOR_SIDES) {
        for (const other of ANCHOR_SIDES) {
          const points = routeConnection(box, box, { source: side, target: other })
          expect(allFinite(points)).toBe(true)
          expect(allOrthogonal(points)).toBe(true)
        }
      }
    })

    it('never produces NaN for any anchor pair on any of these layouts', () => {
      const layouts: [Rect, Rect][] = [
        [rect(0, 0), rect(0, 0)],
        [rect(0, 0), rect(5, 5)],
        [rect(0, 0, 0, 0), rect(0, 0, 0, 0)],
        [rect(-500, -500), rect(500, 500)],
        [rect(0, 0, 1e6, 1e6), rect(1, 1, 1, 1)],
      ]

      for (const [source, target] of layouts) {
        for (const side of ANCHOR_SIDES) {
          for (const other of ANCHOR_SIDES) {
            const points = routeConnection(source, target, {
              source: side,
              target: other,
            })
            expect(allFinite(points)).toBe(true)
          }
        }
      }
    })
  })
})

describe('pathFromPoints', () => {
  const noNaN = (d: string) => expect(d).not.toMatch(/NaN|Infinity|undefined/)

  it('returns an empty string for no points', () => {
    expect(pathFromPoints([])).toBe('')
  })

  it('returns a bare moveto for a single point', () => {
    expect(pathFromPoints([{ x: 5, y: 7 }])).toBe('M 5 7')
  })

  it('draws straight segments with no radius', () => {
    const d = pathFromPoints([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ])

    expect(d).toBe('M 0 0 L 10 0 L 10 10')
    noNaN(d)
  })

  it('rounds interior corners when given a radius', () => {
    const d = pathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      8,
    )

    expect(d).toBe('M 0 0 L 92 0 A 8 8 0 0 1 100 8 L 100 100')
    noNaN(d)
  })

  it('never rounds the first or last vertex', () => {
    const d = pathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      8,
    )

    expect(d).toBe('M 0 0 L 100 0')
  })

  it('shrinks the radius to half of the shorter adjoining segment', () => {
    // The second segment is only 6 long, so the corner may use at most 3.
    const d = pathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 6 },
        { x: 200, y: 6 },
      ],
      20,
    )

    const radii = [...d.matchAll(/A (\d+(?:\.\d+)?) /g)].map((match) => Number(match[1]))
    expect(radii).toEqual([3, 3])
    noNaN(d)
  })

  it('keeps a rounded path from folding back on itself', () => {
    // Two corners share the middle segment; together they must not use more
    // than its whole length.
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 10 },
    ]
    const d = pathFromPoints(points, 30)

    const radii = [...d.matchAll(/A (\d+(?:\.\d+)?) /g)].map((match) => Number(match[1]))
    const total = radii.reduce((sum, r) => sum + r, 0)
    expect(total).toBeLessThanOrEqual(10)
    noNaN(d)
  })

  it('turns the correct way for each corner direction', () => {
    // Right then down is clockwise: sweep flag 1.
    const clockwise = pathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    )
    expect(clockwise).toContain('A 10 10 0 0 1')

    // Right then up is anticlockwise: sweep flag 0.
    const anticlockwise = pathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: -100 },
      ],
      10,
    )
    expect(anticlockwise).toContain('A 10 10 0 0 0')
  })

  it('falls back to a line for a zero-length segment', () => {
    const d = pathFromPoints(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      5,
    )

    noNaN(d)
    expect(d).not.toContain('A')
  })

  it('ignores a negative or non-finite radius rather than emitting NaN', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]

    noNaN(pathFromPoints(points, -10))
    noNaN(pathFromPoints(points, Number.NaN))
    expect(pathFromPoints(points, -10)).toBe('M 0 0 L 100 0 L 100 100')
  })

  it('drops non-finite points instead of writing NaN into the path', () => {
    const d = pathFromPoints([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 10 },
      { x: 20, y: 20 },
    ])

    noNaN(d)
    expect(d).toBe('M 0 0 L 20 20')
  })

  it('produces a NaN-free path for every route it is handed', () => {
    const source = rect(0, 0, 100, 50)
    for (const target of [
      rect(400, 0),
      rect(0, 400),
      rect(20, 20),
      rect(-13, -900, 3, 7),
      rect(0, 0, 0, 0),
    ]) {
      const points = routeConnection(source, target, chooseAnchors(source, target))
      noNaN(pathFromPoints(points))
      noNaN(pathFromPoints(points, 8))
    }
  })

  it('rounds long decimals to something readable', () => {
    const d = pathFromPoints([
      { x: 1 / 3, y: 2 / 3 },
      { x: 10, y: 2 / 3 },
    ])

    expect(d).toBe('M 0.33 0.67 L 10 0.67')
  })
})
