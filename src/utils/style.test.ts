import { describe, expect, it } from 'vitest'
import { STYLE_METRICS, THEMES } from '../theme/tokens'
import type { BlockStyle } from '../types'
import {
  MIXED,
  blockShapeStyle,
  blockTextStyle,
  connectionDashArray,
  connectionLineStyle,
  defaultBlockStyle,
  defaultConnectionStyle,
  isMixed,
  resolveBlockStyle,
  resolveConnectionStyle,
  sharedBlockField,
  sharedConnectionField,
  sharedValue,
} from './style'

/** The defaults the app opens with, and the ones most of these tests use. */
const DARK = defaultBlockStyle('dark')
const DARK_LINE = defaultConnectionStyle('dark')
const LIGHT = defaultBlockStyle('light')
const LIGHT_LINE = defaultConnectionStyle('light')

describe('defaults per theme', () => {
  it('reads its colours out of the theme token table', () => {
    // The Phase 5 debt, asserted away: there is no second table to drift from.
    // If someone edits a token, this passes; if someone re-introduces a
    // hand-written copy of it, this is what fails.
    expect(DARK.fill).toBe(THEMES.dark.blockFill)
    expect(DARK.stroke).toBe(THEMES.dark.blockStroke)
    expect(DARK.textColor).toBe(THEMES.dark.text)
    expect(DARK_LINE.stroke).toBe(THEMES.dark.connection)

    expect(LIGHT.fill).toBe(THEMES.light.blockFill)
    expect(LIGHT.stroke).toBe(THEMES.light.blockStroke)
    expect(LIGHT.textColor).toBe(THEMES.light.text)
    expect(LIGHT_LINE.stroke).toBe(THEMES.light.connection)
  })

  it('gives the two themes genuinely different colours', () => {
    expect(LIGHT.fill).not.toBe(DARK.fill)
    expect(LIGHT.textColor).not.toBe(DARK.textColor)
    expect(LIGHT_LINE.stroke).not.toBe(DARK_LINE.stroke)
  })

  it('keeps the sizes out of the theme, because a border has no colour', () => {
    expect(LIGHT.strokeWidth).toBe(DARK.strokeWidth)
    expect(LIGHT.fontSize).toBe(DARK.fontSize)
    expect(DARK.strokeWidth).toBe(STYLE_METRICS.blockStrokeWidth)
    expect(DARK.fontSize).toBe(STYLE_METRICS.blockFontSize)
    expect(DARK_LINE.strokeWidth).toBe(STYLE_METRICS.connectionStrokeWidth)
    expect(LIGHT_LINE.dashed).toBe(false)
  })

  it('hands back a fresh object each time, so a caller cannot poison it', () => {
    const first = defaultBlockStyle('dark')
    first.fill = '#000000'
    expect(defaultBlockStyle('dark').fill).toBe(THEMES.dark.blockFill)
  })
})

describe('resolveBlockStyle', () => {
  it('gives every default when there is no style at all', () => {
    expect(resolveBlockStyle(undefined, DARK)).toEqual(DARK)
  })

  it('merges a partial style over the defaults', () => {
    expect(resolveBlockStyle({ fill: '#ff0000' }, DARK)).toEqual({
      ...DARK,
      fill: '#ff0000',
    })
  })

  it('resolves an unstyled block differently under each theme', () => {
    // The reason the defaults are an argument: "what does unstyled look like"
    // is a question with two answers now.
    expect(resolveBlockStyle(undefined, DARK).fill).toBe(THEMES.dark.blockFill)
    expect(resolveBlockStyle(undefined, LIGHT).fill).toBe(THEMES.light.blockFill)
  })

  it('resolves a styled block identically under both themes', () => {
    const style: BlockStyle = { fill: '#e2683c' }
    expect(resolveBlockStyle(style, DARK).fill).toBe('#e2683c')
    expect(resolveBlockStyle(style, LIGHT).fill).toBe('#e2683c')
  })

  it('keeps every explicit field, including a falsy one', () => {
    // A zero-width border is a real choice, not an absent one.
    expect(resolveBlockStyle({ strokeWidth: 0 }, DARK).strokeWidth).toBe(0)
  })

  it('lets an explicitly undefined field fall back to the default', () => {
    // `{ fill: undefined }` is what a spread of an absent field produces; it
    // must not shadow the default with `undefined`.
    const style: BlockStyle = { fill: undefined, fontSize: 20 }
    expect(resolveBlockStyle(style, DARK).fill).toBe(DARK.fill)
    expect(resolveBlockStyle(style, DARK).fontSize).toBe(20)
  })

  it('does not mutate the style it was given', () => {
    const style: BlockStyle = { fill: '#ff0000' }
    resolveBlockStyle(style, DARK)
    expect(style).toEqual({ fill: '#ff0000' })
  })
})

describe('resolveConnectionStyle', () => {
  it('gives every default when there is no style', () => {
    expect(resolveConnectionStyle(undefined, DARK_LINE)).toEqual(DARK_LINE)
  })

  it('merges a partial style over the defaults', () => {
    expect(resolveConnectionStyle({ dashed: true }, DARK_LINE)).toEqual({
      ...DARK_LINE,
      dashed: true,
    })
  })

  it('follows the theme for an unstyled arrow and not for a styled one', () => {
    expect(resolveConnectionStyle(undefined, LIGHT_LINE).stroke).toBe(
      THEMES.light.connection,
    )
    expect(resolveConnectionStyle({ stroke: '#ffaa00' }, LIGHT_LINE).stroke).toBe(
      '#ffaa00',
    )
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
    expect(sharedBlockField([undefined, undefined], 'fill', DARK)).toBe(DARK.fill)
  })

  it('follows the active theme when the blocks are unstyled', () => {
    expect(sharedBlockField([undefined, undefined], 'fill', LIGHT)).toBe(LIGHT.fill)
  })

  it('agrees when a set style happens to equal the default', () => {
    // Resolution happens before comparison, so "explicitly the default" and
    // "unset" are the same *displayed* value — which is what the panel shows.
    expect(sharedBlockField([{ fill: DARK.fill }, undefined], 'fill', DARK)).toBe(
      DARK.fill,
    )
  })

  it('reports MIXED once a theme swap pulls the default away from a set value', () => {
    // A block explicitly painted the dark default sitting beside an unstyled
    // one: they match in the dark theme and genuinely differ in the light one,
    // and the panel has to say so rather than showing one of the two.
    const styles = [{ fill: DARK.fill }, undefined]
    expect(sharedBlockField(styles, 'fill', DARK)).toBe(DARK.fill)
    expect(sharedBlockField(styles, 'fill', LIGHT)).toBe(MIXED)
  })

  it('reports MIXED across N divergent blocks', () => {
    const styles = [{ fill: '#111111' }, { fill: '#222222' }, { fill: '#333333' }]
    expect(sharedBlockField(styles, 'fill', DARK)).toBe(MIXED)
  })

  it('reports MIXED when only one of many diverges', () => {
    const styles = [
      { fontSize: 14 },
      { fontSize: 14 },
      { fontSize: 22 },
      { fontSize: 14 },
    ]
    expect(sharedBlockField(styles, 'fontSize', DARK)).toBe(MIXED)
  })

  it('answers per field, so one divergence does not poison the rest', () => {
    const styles = [
      { fill: '#111111', fontSize: 14 },
      { fill: '#222222', fontSize: 14 },
    ]
    expect(sharedBlockField(styles, 'fill', DARK)).toBe(MIXED)
    expect(sharedBlockField(styles, 'fontSize', DARK)).toBe(14)
  })
})

describe('sharedConnectionField', () => {
  it('reports MIXED when the dashes disagree', () => {
    expect(
      sharedConnectionField([{ dashed: true }, undefined], 'dashed', DARK_LINE),
    ).toBe(MIXED)
  })

  it('agrees when they do not', () => {
    expect(
      sharedConnectionField([{ dashed: true }, { dashed: true }], 'dashed', DARK_LINE),
    ).toBe(true)
  })

  it('follows the theme for the line colour of unstyled arrows', () => {
    expect(sharedConnectionField([undefined, undefined], 'stroke', LIGHT_LINE)).toBe(
      THEMES.light.connection,
    )
  })
})

describe('blockShapeStyle', () => {
  it('emits nothing at all for an unstyled block', () => {
    // The whole point: no properties means the stylesheet is still in charge,
    // which is what keeps the themes able to repaint an unstyled block.
    expect(blockShapeStyle()).toEqual({})
    expect(blockShapeStyle({})).toEqual({})
  })

  it('emits only the fields that are set', () => {
    expect(blockShapeStyle({ fill: '#ff0000' })).toEqual({ fill: '#ff0000' })
  })

  it('never emits the text fields onto the shape', () => {
    expect(blockShapeStyle({ textColor: '#ff0000', fontSize: 30 })).toEqual({})
  })

  it('puts the text fields on the label instead', () => {
    expect(blockTextStyle({ textColor: '#ff0000', fontSize: 30 })).toEqual({
      fill: '#ff0000',
      fontSize: 30,
    })
  })

  it('never emits a resolved default, whatever the theme', () => {
    // Rendering must stay sparse: the moment a default leaks into the emitted
    // style, the element stops following the theme.
    expect(blockShapeStyle(undefined)).toEqual({})
    expect(blockTextStyle(undefined)).toEqual({})
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
    const width = STYLE_METRICS.connectionStrokeWidth
    expect(connectionDashArray({ dashed: true })).toBe(`${width * 3} ${width * 2}`)
  })
})

describe('connectionLineStyle', () => {
  it('emits nothing for an unstyled connection', () => {
    expect(connectionLineStyle()).toEqual({})
  })

  it('emits the dash array only when dashed', () => {
    expect(connectionLineStyle({ stroke: '#ff0000' })).toEqual({ stroke: '#ff0000' })
    expect(connectionLineStyle({ dashed: true, strokeWidth: 1 })).toEqual({
      strokeWidth: 1,
      strokeDasharray: '3 2',
    })
  })
})
