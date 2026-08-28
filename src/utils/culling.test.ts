import { describe, expect, it } from 'vitest'
import type { Block, Connection } from '../types'
import {
  CULL_MARGIN_PX,
  connectionBounds,
  visibleBlocks,
  visibleConnections,
  visibleWorldRect,
} from './culling'
import { ANCHOR_STUB, resolveAnchors, routeConnection } from './routing'

const block = (id: string, x: number, y: number): Block => ({
  id,
  type: 'rect',
  x,
  y,
  width: 100,
  height: 50,
  text: id,
})

const link = (id: string, sourceId: string, targetId: string): Connection => ({
  id,
  sourceId,
  targetId,
})

const none = new Set<string>()
const canvas = { left: 0, top: 0, width: 800, height: 600 }

describe('visibleWorldRect', () => {
  it('covers the whole canvas at zoom 1, plus the margin on each side', () => {
    const view = visibleWorldRect({ x: 0, y: 0, zoom: 1 }, canvas)
    expect(view.x).toBe(-CULL_MARGIN_PX)
    expect(view.y).toBe(-CULL_MARGIN_PX)
    expect(view.width).toBe(800 + CULL_MARGIN_PX * 2)
    expect(view.height).toBe(600 + CULL_MARGIN_PX * 2)
  })

  it('follows the camera', () => {
    const view = visibleWorldRect({ x: 1000, y: 500, zoom: 1 }, canvas, 0)
    expect(view).toEqual({ x: 1000, y: 500, width: 800, height: 600 })
  })

  it('covers more world when zoomed out', () => {
    const out = visibleWorldRect({ x: 0, y: 0, zoom: 0.5 }, canvas, 0)
    const inn = visibleWorldRect({ x: 0, y: 0, zoom: 2 }, canvas, 0)
    expect(out.width).toBe(1600)
    expect(inn.width).toBe(400)
  })

  it('keeps the margin a constant band of screen pixels at any zoom', () => {
    // Not a constant band of *world* units: zoomed out, 400 screen pixels is a
    // great deal of world, and a world-space margin would shrink to nothing
    // exactly when the most is on screen.
    const view = visibleWorldRect({ x: 0, y: 0, zoom: 0.25 }, canvas)
    expect(view.x).toBe(-CULL_MARGIN_PX / 0.25)
  })

  it('survives the 0x0 canvas of a first paint', () => {
    const view = visibleWorldRect(
      { x: 0, y: 0, zoom: 1 },
      { left: 0, top: 0, width: 0, height: 0 },
      0,
    )
    expect(view.width).toBe(1)
    expect(view.height).toBe(1)
  })
})

describe('connectionBounds', () => {
  it('contains every point of the route it bounds', () => {
    // The property the whole culling scheme rests on. Checked against the
    // router itself rather than restated, over every relative arrangement of
    // two blocks — left, right, above, below, overlapping, concentric.
    const offsets = [-400, -180, -60, 0, 60, 180, 400]
    for (const dx of offsets) {
      for (const dy of offsets) {
        const source = block('s', 0, 0)
        const target = block('t', dx, dy)
        const bounds = connectionBounds(source, target)
        const points = routeConnection(
          source,
          target,
          resolveAnchors({}, source, target),
        )
        for (const point of points) {
          expect(point.x).toBeGreaterThanOrEqual(bounds.x)
          expect(point.y).toBeGreaterThanOrEqual(bounds.y)
          expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width)
          expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height)
        }
      }
    }
  })

  it('grows the union of the two rects by the anchor stub', () => {
    const bounds = connectionBounds(block('s', 0, 0), block('t', 200, 0))
    expect(bounds.x).toBe(-ANCHOR_STUB)
    expect(bounds.width).toBe(300 + ANCHOR_STUB * 2)
  })
})

describe('visibleBlocks', () => {
  const view = { x: 0, y: 0, width: 500, height: 500 }

  it('keeps what is inside the view', () => {
    const inside = [block('a', 10, 10), block('b', 300, 300)]
    expect(visibleBlocks(inside, view, none)).toEqual(inside)
  })

  it('drops what is outside it', () => {
    const blocks = [block('a', 10, 10), block('far', 9000, 9000)]
    expect(visibleBlocks(blocks, view, none).map((b) => b.id)).toEqual(['a'])
  })

  it('keeps a block that only partly overlaps the edge', () => {
    // Half in is still visible, and a cull that took it would leave a block
    // sliced off at the window edge.
    expect(visibleBlocks([block('edge', 450, 450)], view, none)).toHaveLength(1)
    expect(visibleBlocks([block('edge', -50, -25)], view, none)).toHaveLength(1)
  })

  it('keeps a block touching the boundary exactly', () => {
    // The right edge of this block is exactly the left edge of the view.
    expect(visibleBlocks([block('touch', -100, 0)], view, none)).toHaveLength(1)
  })

  it('drops a block one unit past the boundary', () => {
    expect(visibleBlocks([block('past', -101, 0)], view, none)).toHaveLength(0)
  })

  it('never culls a selected block, however far away it is', () => {
    // The alarming case: dragging a block off the edge of the window must not
    // make it disappear out from under the cursor.
    const blocks = [block('held', 90000, 90000)]
    expect(visibleBlocks(blocks, view, new Set(['held']))).toHaveLength(1)
  })

  it('preserves paint order', () => {
    const blocks = [block('a', 0, 0), block('far', 9000, 0), block('c', 100, 0)]
    expect(visibleBlocks(blocks, view, none).map((b) => b.id)).toEqual(['a', 'c'])
  })

  it('returns the very same array when nothing is culled', () => {
    const blocks = [block('a', 0, 0)]
    expect(visibleBlocks(blocks, view, none)).toBe(blocks)
  })
})

describe('visibleConnections', () => {
  const view = { x: 0, y: 0, width: 500, height: 500 }
  const near = block('near', 0, 0)
  const alsoNear = block('alsoNear', 300, 0)
  const far = block('far', 9000, 9000)
  const alsoFar = block('alsoFar', 9300, 9000)
  const map = new Map([near, alsoNear, far, alsoFar].map((b) => [b.id, b]))

  it('keeps an arrow between two visible blocks', () => {
    const kept = visibleConnections(
      [link('c', 'near', 'alsoNear')],
      map,
      view,
      none,
      none,
    )
    expect(kept).toHaveLength(1)
  })

  it('drops an arrow between two blocks that are both away', () => {
    const kept = visibleConnections([link('c', 'far', 'alsoFar')], map, view, none, none)
    expect(kept).toHaveLength(0)
  })

  it('keeps an arrow that only crosses the view, with both ends outside it', () => {
    // The bound is the union of the two rects, so a long arrow from far
    // above-left to far below-right sweeps the view and stays.
    const above = block('above', -50, -9000)
    const below = block('below', -50, 9000)
    const kept = visibleConnections(
      [link('c', 'above', 'below')],
      new Map([
        [above.id, above],
        [below.id, below],
      ]),
      view,
      none,
      none,
    )
    expect(kept).toHaveLength(1)
  })

  it('keeps an arrow attached to a selected block wherever that block goes', () => {
    // Otherwise an arrow would snap off its block at the window edge mid-drag.
    const kept = visibleConnections(
      [link('c', 'far', 'alsoFar')],
      map,
      view,
      new Set(['far']),
      none,
    )
    expect(kept).toHaveLength(1)
  })

  it('keeps a selected arrow wherever it is', () => {
    const kept = visibleConnections(
      [link('c', 'far', 'alsoFar')],
      map,
      view,
      none,
      new Set(['c']),
    )
    expect(kept).toHaveLength(1)
  })

  it('drops an arrow whose endpoint is missing rather than rendering nothing', () => {
    const kept = visibleConnections([link('c', 'near', 'gone')], map, view, none, none)
    expect(kept).toHaveLength(0)
  })

  it('preserves paint order', () => {
    const kept = visibleConnections(
      [
        link('a', 'near', 'alsoNear'),
        link('b', 'far', 'alsoFar'),
        link('c', 'alsoNear', 'near'),
      ],
      map,
      view,
      none,
      none,
    )
    expect(kept.map((c) => c.id)).toEqual(['a', 'c'])
  })

  it('returns the very same array when nothing is culled', () => {
    const all = [link('a', 'near', 'alsoNear')]
    expect(visibleConnections(all, map, view, none, none)).toBe(all)
  })
})
