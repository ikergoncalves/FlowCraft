import { describe, expect, it } from 'vitest'
import { snapPoint, snapValue } from './snap'
import { GRID_SIZE } from './coords'

describe('snapValue', () => {
  it('leaves exact multiples of the grid alone', () => {
    for (const value of [0, 20, 40, 200, -20, -140]) {
      expect(snapValue(value)).toBe(value)
    }
  })

  it('rounds to the nearest multiple', () => {
    expect(snapValue(3)).toBe(0)
    expect(snapValue(9)).toBe(0)
    expect(snapValue(11)).toBe(20)
    expect(snapValue(29)).toBe(20)
    expect(snapValue(31)).toBe(40)
    expect(snapValue(197)).toBe(200)
  })

  it('breaks a half-step tie toward positive infinity, both signs alike', () => {
    expect(snapValue(10)).toBe(20)
    expect(snapValue(30)).toBe(40)
    // -10 is equidistant from -20 and 0; rounding up picks 0.
    expect(snapValue(-10)).toBe(0)
    expect(snapValue(-30)).toBe(-20)
  })

  it('never returns -0, so snapped coordinates compare cleanly', () => {
    expect(Object.is(snapValue(-4), 0)).toBe(true)
    expect(Object.is(snapValue(-10), 0)).toBe(true)
  })

  it('handles negatives away from the origin', () => {
    expect(snapValue(-11)).toBe(-20)
    expect(snapValue(-29)).toBe(-20)
    expect(snapValue(-31)).toBe(-40)
    expect(snapValue(-197)).toBe(-200)
  })

  it('honours a custom step', () => {
    expect(snapValue(7, 5)).toBe(5)
    expect(snapValue(8, 5)).toBe(10)
    expect(snapValue(103, 50)).toBe(100)
    expect(snapValue(0.3, 0.25)).toBeCloseTo(0.25, 10)
  })

  it('is idempotent', () => {
    for (const value of [0, 3, 10, -10, 197, -197, 12.5, -0.4]) {
      expect(snapValue(snapValue(value))).toBe(snapValue(value))
      expect(snapValue(snapValue(value, 7), 7)).toBe(snapValue(value, 7))
    }
  })

  it('is monotonic, so a slow drag never stutters backwards', () => {
    let previous = -Infinity
    for (let value = -100; value <= 100; value += 0.5) {
      const snapped = snapValue(value)
      expect(snapped).toBeGreaterThanOrEqual(previous)
      previous = snapped
    }
  })

  it('returns the value untouched for a step that has no lattice', () => {
    expect(snapValue(37, 0)).toBe(37)
    expect(snapValue(37, -20)).toBe(37)
    expect(snapValue(37, Number.NaN)).toBe(37)
  })

  it('passes non-finite values straight through rather than collapsing to 0', () => {
    expect(snapValue(Number.NaN)).toBeNaN()
    expect(snapValue(Infinity)).toBe(Infinity)
  })

  it('defaults to the shared GRID_SIZE', () => {
    expect(snapValue(11)).toBe(snapValue(11, GRID_SIZE))
  })
})

describe('snapPoint', () => {
  it('snaps both axes independently', () => {
    expect(snapPoint({ x: 11, y: 29 })).toEqual({ x: 20, y: 20 })
    expect(snapPoint({ x: -11, y: 31 })).toEqual({ x: -20, y: 40 })
  })

  it('leaves a point already on the lattice alone', () => {
    expect(snapPoint({ x: 40, y: -60 })).toEqual({ x: 40, y: -60 })
  })

  it('honours a custom step', () => {
    expect(snapPoint({ x: 7, y: 12 }, 5)).toEqual({ x: 5, y: 10 })
  })

  it('is idempotent', () => {
    const once = snapPoint({ x: 13.7, y: -48.2 })
    expect(snapPoint(once)).toEqual(once)
  })
})
