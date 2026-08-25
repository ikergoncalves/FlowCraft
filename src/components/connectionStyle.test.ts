import { describe, expect, it } from 'vitest'
import type { Connection } from '../types'
import { ARROW_MARKER_ID, arrowMarkerStrokes, markerIdForStroke } from './connectionStyle'

const connection = (id: string, stroke?: string): Connection => ({
  id,
  sourceId: 'a',
  targetId: 'b',
  ...(stroke === undefined ? {} : { style: { stroke } }),
})

describe('markerIdForStroke', () => {
  it('uses the shared default marker when no colour is set', () => {
    expect(markerIdForStroke()).toBe(ARROW_MARKER_ID)
    expect(markerIdForStroke(undefined)).toBe(ARROW_MARKER_ID)
  })

  it('derives a valid id from a hex colour', () => {
    expect(markerIdForStroke('#4c8dff')).toBe(`${ARROW_MARKER_ID}-4c8dff`)
  })

  it('derives one from a functional colour too', () => {
    expect(markerIdForStroke('rgb(1, 2, 3)')).toBe(`${ARROW_MARKER_ID}-rgb-1-2-3`)
  })

  it('produces an id a CSS selector and url(#…) can both address', () => {
    for (const colour of ['#4c8dff', 'rgb(1, 2, 3)', 'hsl(200 50% 50% / 40%)', 'red']) {
      expect(markerIdForStroke(colour)).toMatch(/^[A-Za-z][\w-]*$/)
    }
  })

  it('is stable: the same colour always derives the same id', () => {
    // The whole scheme depends on this — two arrows the same colour must land
    // on one marker, not two.
    expect(markerIdForStroke('#ff0000')).toBe(markerIdForStroke('#ff0000'))
  })

  it('ignores case and surrounding space, as CSS does', () => {
    expect(markerIdForStroke('  #FF0000 ')).toBe(markerIdForStroke('#ff0000'))
  })

  it('falls back to the default rather than minting an empty id', () => {
    expect(markerIdForStroke('   ')).toBe(ARROW_MARKER_ID)
  })
})

describe('arrowMarkerStrokes', () => {
  it('is empty when nothing overrides its colour', () => {
    expect(arrowMarkerStrokes([connection('a'), connection('b')])).toEqual([])
  })

  it('collects each colour once, however many arrows use it', () => {
    // The anti-explosion property: markers scale with the palette, not with
    // the diagram. Two hundred arrows in two colours define two markers.
    const many = Array.from({ length: 200 }, (_, i) =>
      connection(`c${i}`, i % 2 === 0 ? '#ff0000' : '#00ff00'),
    )
    expect(arrowMarkerStrokes(many)).toEqual(['#00ff00', '#ff0000'])
  })

  it('never grows past the number of distinct colours', () => {
    const colours = ['#111111', '#222222', '#333333']
    const many = Array.from({ length: 50 }, (_, i) =>
      connection(`c${i}`, colours[i % colours.length]),
    )
    expect(arrowMarkerStrokes(many)).toHaveLength(colours.length)
  })

  it('sorts, so the rendered defs do not churn between renders', () => {
    const forwards = arrowMarkerStrokes([
      connection('a', '#bbb'),
      connection('b', '#aaa'),
    ])
    const backwards = arrowMarkerStrokes([
      connection('b', '#aaa'),
      connection('a', '#bbb'),
    ])
    expect(forwards).toEqual(backwards)
  })

  it('skips the unstyled arrows mixed in among the coloured ones', () => {
    expect(
      arrowMarkerStrokes([connection('a'), connection('b', '#ff0000'), connection('c')]),
    ).toEqual(['#ff0000'])
  })
})
