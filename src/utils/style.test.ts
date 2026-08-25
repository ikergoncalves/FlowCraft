import { describe, expect, it } from 'vitest'
import type { BlockStyle } from '../types'
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_CONNECTION_STYLE,
  MIXED,
  blockShapeAttributes,
  blockTextAttributes,
  connectionDashArray,
  connectionLineAttributes,
  isMixed,
  resolveBlockStyle,
  resolveConnectionStyle,
  sharedBlockField,
  sharedConnectionField,
  sharedValue,
} from './style'

describe('resolveBlockStyle', () => {
  it('gives every default when there is no style at all', () => {
    expect(resolveBlockStyle()).toEqual(DEFAULT_BLOCK_STYLE)
    expect(resolveBlockStyle(undefined)).toEqual(DEFAULT_BLOCK_STYLE)
  })

  it('merges a partial style over the defaults', () => {
    expect(resolveBlockStyle({ fill: '#ff0000' })).toEqual({
      ...DEFAULT_BLOCK_STYLE,
      fill: '#ff0000',
    })
  })

  it('keeps every explicit field, including a falsy one', () => {
    // A zero-width border is a real choice, not an absent one.
    expect(resolveBlockStyle({ strokeWidth: 0 }).strokeWidth).toBe(0)
  })

  it('lets an explicitly undefined field fall back to the default', () => {
    // `{ fill: undefined }` is what a spread of an absent field produces; it
    // must not shadow the default with `undefined`.
    const style: BlockStyle = { fill: undefined, fontSize: 20 }
    expect(resolveBlockStyle(style).fill).toBe(DEFAULT_BLOCK_STYLE.fill)
    expect(resolveBlockStyle(style).fontSize).toBe(20)
  })

  it('does not mutate the style it was given', () => {
    const style: BlockStyle = { fill: '#ff0000' }
    resolveBlockStyle(style)
    expect(style).toEqual({ fill: '#ff0000' })
  })
})

describe('resolveConnectionStyle', () => {
  it('gives every default when there is no style', () => {
    expect(resolveConnectionStyle()).toEqual(DEFAULT_CONNECTION_STYLE)
  })

  it('merges a partial style over the defaults', () => {
    expect(resolveConnectionStyle({ dashed: true })).toEqual({
      ...DEFAULT_CONNECTION_STYLE,
      dashed: true,
    })
  })
})

describe('sharedValue', () => {
  it('returns the value everything agrees on', () => {
    expect(sharedValue(['#fff', '#fff', '#fff'])).toBe('#fff')
  })

  it('returns MIXED as soon as one diverges', () => {
    expect(sharedValue(['#fff', '#fff', '#000'])).toBe(MIXED)
  })

  it('treats an empty list as mixed', () => {
    expect(isMixed(sharedValue([]))).toBe(true)
  })

  it('compares by value, not identity', () => {
    expect(sharedValue([1, 1])).toBe(1)
    expect(sharedValue([true, true])).toBe(true)
  })
})

describe('sharedBlockField', () => {
  it('agrees when unstyled blocks all fall back to the same default', () => {
    expect(sharedBlockField([undefined, undefined], 'fill')).toBe(
      DEFAULT_BLOCK_STYLE.fill,
    )
  })

  it('agrees when a set style happens to equal the default', () => {
    // Resolution happens before comparison, so "explicitly the default" and
    // "unset" are the same *displayed* value — which is what the panel shows.
    expect(
      sharedBlockField([{ fill: DEFAULT_BLOCK_STYLE.fill }, undefined], 'fill'),
    ).toBe(DEFAULT_BLOCK_STYLE.fill)
  })

  it('reports MIXED across N divergent blocks', () => {
    const styles = [{ fill: '#111111' }, { fill: '#222222' }, { fill: '#333333' }]
    expect(sharedBlockField(styles, 'fill')).toBe(MIXED)
  })

  it('reports MIXED when only one of many diverges', () => {
    const styles = [
      { fontSize: 14 },
      { fontSize: 14 },
      { fontSize: 22 },
      { fontSize: 14 },
    ]
    expect(sharedBlockField(styles, 'fontSize')).toBe(MIXED)
  })

  it('answers per field, so one divergence does not poison the rest', () => {
    const styles = [
      { fill: '#111111', fontSize: 14 },
      { fill: '#222222', fontSize: 14 },
    ]
    expect(sharedBlockField(styles, 'fill')).toBe(MIXED)
    expect(sharedBlockField(styles, 'fontSize')).toBe(14)
  })
})

describe('sharedConnectionField', () => {
  it('reports MIXED when the dashes disagree', () => {
    expect(sharedConnectionField([{ dashed: true }, undefined], 'dashed')).toBe(MIXED)
  })

  it('agrees when they do not', () => {
    expect(sharedConnectionField([{ dashed: true }, { dashed: true }], 'dashed')).toBe(
      true,
    )
  })
})

describe('blockShapeAttributes', () => {
  it('emits nothing at all for an unstyled block', () => {
    // The whole point: no attributes means the stylesheet is still in charge,
    // which is what keeps Phase 6's themes able to repaint an unstyled block.
    expect(blockShapeAttributes()).toEqual({})
    expect(blockShapeAttributes({})).toEqual({})
  })

  it('emits only the fields that are set', () => {
    expect(blockShapeAttributes({ fill: '#ff0000' })).toEqual({ fill: '#ff0000' })
  })

  it('never emits the text fields onto the shape', () => {
    expect(blockShapeAttributes({ textColor: '#ff0000', fontSize: 30 })).toEqual({})
  })

  it('puts the text fields on the label instead', () => {
    expect(blockTextAttributes({ textColor: '#ff0000', fontSize: 30 })).toEqual({
      fill: '#ff0000',
      fontSize: 30,
    })
  })
})

describe('connectionDashArray', () => {
  it('is undefined for a solid line', () => {
    expect(connectionDashArray()).toBeUndefined()
    expect(connectionDashArray({ dashed: false })).toBeUndefined()
  })

  it('scales the pattern with the stroke width', () => {
    expect(connectionDashArray({ dashed: true, strokeWidth: 2 })).toBe('6 4')
  })

  it('uses the default width when none is set', () => {
    const width = DEFAULT_CONNECTION_STYLE.strokeWidth
    expect(connectionDashArray({ dashed: true })).toBe(`${width * 3} ${width * 2}`)
  })
})

describe('connectionLineAttributes', () => {
  it('emits nothing for an unstyled connection', () => {
    expect(connectionLineAttributes()).toEqual({})
  })

  it('emits the dash array only when dashed', () => {
    expect(connectionLineAttributes({ stroke: '#ff0000' })).toEqual({ stroke: '#ff0000' })
    expect(connectionLineAttributes({ dashed: true, strokeWidth: 1 })).toEqual({
      strokeWidth: 1,
      strokeDasharray: '3 2',
    })
  })
})
