import { describe, expect, it } from 'vitest'
import type { DocumentSlice } from '../persistence/document'
import { STYLE_METRICS, THEMES } from '../theme/tokens'
import type { Block, Connection } from '../types'
import { contentBounds, EXPORT_MARGIN, exportSvg } from './svg'

const block = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  type: 'rect',
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  text: id,
  ...extra,
})

function slice(overrides: Partial<DocumentSlice> = {}): DocumentSlice {
  return {
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    groups: {},
    groupOrder: [],
    ...overrides,
  }
}

/** Two blocks side by side, wired together. */
function wired(connectionStyle?: Connection['style']): DocumentSlice {
  return slice({
    blocks: { a: block('a'), b: block('b', { x: 400 }) },
    blockOrder: ['a', 'b'],
    connections: {
      ab: {
        id: 'ab',
        sourceId: 'a',
        targetId: 'b',
        sourceAnchor: 'e',
        ...(connectionStyle ? { style: connectionStyle } : {}),
      },
    },
    connectionOrder: ['ab'],
  })
}

const svgOf = (document: DocumentSlice, options = {}) => {
  const result = exportSvg(document, { theme: 'dark', ...options })
  if (!result) throw new Error('expected an export')
  return result
}

/** Parses the markup, which is also the only real proof it is well-formed. */
function parse(markup: string): Document {
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const error = parsed.querySelector('parsererror')
  if (error) throw new Error(`not well-formed: ${error.textContent ?? ''}`)
  return parsed
}

describe('an empty diagram', () => {
  it('exports nothing at all', () => {
    // Documented behaviour, and the toolbar disables the buttons to match: a
    // blank file that opens as a blank page is indistinguishable from a bug.
    expect(exportSvg(slice(), { theme: 'dark' })).toBeNull()
    expect(contentBounds(slice())).toBeNull()
  })

  it('exports nothing even when there are connections but no blocks', () => {
    const orphaned = slice({
      connections: { ab: { id: 'ab', sourceId: 'a', targetId: 'b' } },
      connectionOrder: ['ab'],
    })
    expect(exportSvg(orphaned, { theme: 'dark' })).toBeNull()
  })
})

describe('the exported markup', () => {
  it('is well-formed XML with an SVG root', () => {
    const parsed = parse(svgOf(wired()).markup)
    expect(parsed.documentElement.tagName).toBe('svg')
    expect(parsed.documentElement.getAttribute('xmlns')).toBe(
      'http://www.w3.org/2000/svg',
    )
  })

  it('declares its own size, so it opens standalone', () => {
    const svg = svgOf(wired())
    const root = parse(svg.markup).documentElement
    expect(Number(root.getAttribute('width'))).toBe(svg.width)
    expect(Number(root.getAttribute('height'))).toBe(svg.height)
  })

  it('escapes a label that would otherwise break the file', () => {
    const nasty = slice({
      blocks: { a: block('a', { text: 'a < b & c > d "quoted"' }) },
      blockOrder: ['a'],
    })
    const parsed = parse(svgOf(nasty).markup)
    expect(parsed.querySelector('text')?.textContent).toBe('a < b & c > d "quoted"')
  })

  it('carries every block, in paint order', () => {
    const three = slice({
      blocks: { a: block('a'), b: block('b', { x: 200 }), c: block('c', { x: 400 }) },
      blockOrder: ['c', 'a', 'b'],
    })
    const texts = [...parse(svgOf(three).markup).querySelectorAll('text')].map(
      (node) => node.textContent,
    )
    expect(texts).toEqual(['c', 'a', 'b'])
  })

  it('draws arrows under blocks, as the canvas does', () => {
    const parsed = parse(svgOf(wired()).markup)
    const nodes = [...parsed.documentElement.children]
    const line = nodes.findIndex((node) => node.classList.contains('connection__line'))
    const firstBlock = nodes.findIndex((node) => node.tagName === 'g')
    expect(line).toBeGreaterThan(-1)
    expect(line).toBeLessThan(firstBlock)
  })

  it('gives a text block a label and no box', () => {
    const note = slice({
      blocks: { a: block('a', { type: 'text', text: 'note' }) },
      blockOrder: ['a'],
    })
    const parsed = parse(svgOf(note).markup)
    expect(parsed.querySelectorAll('rect.block__shape')).toHaveLength(0)
    expect(parsed.querySelector('text')?.textContent).toBe('note')
  })
})

describe('editing chrome', () => {
  /** A document with everything the canvas would draw furniture around. */
  const busy = () =>
    slice({
      blocks: {
        a: block('a'),
        b: block('b', { x: 400 }),
      },
      blockOrder: ['a', 'b'],
      connections: { ab: { id: 'ab', sourceId: 'a', targetId: 'b', sourceAnchor: 'e' } },
      connectionOrder: ['ab'],
      groups: { g1: { id: 'g1', blockIds: ['a', 'b'] } },
      groupOrder: ['g1'],
    })

  it('leaves out every piece of it', () => {
    // The list the DOM-scraping approach would have had to maintain by hand.
    // Here it is a check rather than a mechanism: none of these was ever put
    // in, because the export is built from the document.
    const markup = svgOf(busy()).markup
    for (const chrome of [
      'canvas__grid',
      'flowcraft-grid',
      'marquee',
      'block__selection',
      'selection__bounds',
      'selection__handle',
      'selection__group',
      'group-bounds',
      'connection__hit',
      'connection__halo',
      'connection__ghost',
      'connect-target',
      'port',
      'data-testid',
      'data-block-id',
    ]) {
      expect(markup, chrome).not.toContain(chrome)
    }
  })

  it('exports a group as nothing, because a group is not a drawing', () => {
    // Its members are already there; the outline is an editing affordance.
    const withGroup = svgOf(busy()).markup
    const withoutGroup = svgOf(slice({ ...busy(), groups: {}, groupOrder: [] })).markup
    expect(withGroup).toBe(withoutGroup)
  })

  it('drops the non-scaling stroke, which is a zoom affordance', () => {
    // On the canvas it keeps a border one screen pixel wide at any zoom. In a
    // file it would make borders thin out as the image is scaled up.
    expect(svgOf(busy()).markup).not.toContain('non-scaling-stroke')
  })
})

describe('the markers it takes with it', () => {
  it('defines the default one when an arrow needs it', () => {
    const parsed = parse(svgOf(wired()).markup)
    const markers = [...parsed.querySelectorAll('marker')]
    expect(markers.map((node) => node.id)).toEqual(['flowcraft-arrow'])
  })

  it('points every arrow at a marker that is actually defined', () => {
    const two = slice({
      blocks: { a: block('a'), b: block('b', { x: 400 }), c: block('c', { y: 300 }) },
      blockOrder: ['a', 'b', 'c'],
      connections: {
        plain: { id: 'plain', sourceId: 'a', targetId: 'b', sourceAnchor: 'e' },
        red: {
          id: 'red',
          sourceId: 'a',
          targetId: 'c',
          sourceAnchor: 's',
          style: { stroke: '#ff0000' },
        },
      },
      connectionOrder: ['plain', 'red'],
    })
    const parsed = parse(svgOf(two).markup)
    const defined = new Set([...parsed.querySelectorAll('marker')].map((n) => n.id))

    expect(defined).toEqual(new Set(['flowcraft-arrow', 'flowcraft-arrow-ff0000']))
    for (const line of parsed.querySelectorAll('.connection__line')) {
      const reference = /url\(#(.+)\)/.exec(line.getAttribute('marker-end') ?? '')?.[1]
      expect(defined.has(reference ?? '')).toBe(true)
    }
  })

  it('defines only the markers in use, never the whole palette', () => {
    // The anti-explosion property, in a file: a hundred red arrows share one
    // marker and an unused colour costs nothing.
    const parsed = parse(svgOf(wired({ stroke: '#00ff00' })).markup)
    const markers = [...parsed.querySelectorAll('marker')].map((node) => node.id)
    expect(markers).toEqual(['flowcraft-arrow-00ff00'])
    // No default: every arrow in this document is coloured.
    expect(markers).not.toContain('flowcraft-arrow')
  })

  it('paints a coloured arrowhead to match its line', () => {
    const parsed = parse(svgOf(wired({ stroke: '#00ff00' })).markup)
    const head = parsed.querySelector('marker .connection__arrow')
    expect(head?.getAttribute('style')).toContain('#00ff00')
  })

  it('defines no markers at all when there are no arrows', () => {
    const bare = slice({ blocks: { a: block('a') }, blockOrder: ['a'] })
    expect(svgOf(bare).markup).not.toContain('<marker')
  })
})

describe('the frame', () => {
  it('fits the content with a margin on every side', () => {
    const two = slice({
      blocks: { a: block('a', { x: 100, y: 50 }), b: block('b', { x: 400, y: 200 }) },
      blockOrder: ['a', 'b'],
    })
    // Blocks span x 100..500, y 50..260.
    const svg = svgOf(two)
    const viewBox = parse(svg.markup)
      .documentElement.getAttribute('viewBox')
      ?.split(' ')
      .map(Number)

    expect(viewBox).toEqual([
      100 - EXPORT_MARGIN,
      50 - EXPORT_MARGIN,
      400 + EXPORT_MARGIN * 2,
      210 + EXPORT_MARGIN * 2,
    ])
  })

  it('takes the margin it is given', () => {
    const one = slice({ blocks: { a: block('a') }, blockOrder: ['a'] })
    expect(svgOf(one, { margin: 0 }).width).toBe(100)
    expect(svgOf(one, { margin: 10 }).width).toBe(120)
  })

  it('ignores where the camera was', () => {
    // The viewport is not even part of the document, and two people exporting
    // the same diagram must get the same file.
    const one = slice({
      blocks: { a: block('a', { x: 5000, y: -3000 }) },
      blockOrder: ['a'],
    })
    const viewBox = parse(svgOf(one).markup).documentElement.getAttribute('viewBox')
    expect(viewBox).toBe(`${5000 - EXPORT_MARGIN} ${-3000 - EXPORT_MARGIN} 148 108`)
  })

  it('includes an arrow that bows outside the blocks it joins', () => {
    /*
     * Two blocks stacked with the same right edge, both wired out of their
     * east side: the route leaves one, runs down a vertical line clear of both
     * boxes, and comes back into the other. Its widest point is outside the
     * bounding box of the blocks themselves, so framing on the blocks alone
     * would clip the arrow — which is precisely why `contentBounds` walks the
     * routed points as well.
     */
    const stacked = slice({
      blocks: { a: block('a'), b: block('b', { y: 200 }) },
      blockOrder: ['a', 'b'],
      connections: {
        ab: {
          id: 'ab',
          sourceId: 'a',
          targetId: 'b',
          sourceAnchor: 'e',
          targetAnchor: 'e',
        },
      },
      connectionOrder: ['ab'],
    })

    const bounds = contentBounds(stacked)
    expect(bounds).not.toBeNull()
    // Both blocks end at x = 100; the route swings out past it.
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeGreaterThan(100)

    // And the frame really contains it, margin and all.
    const svg = svgOf(stacked)
    const [x, , width] = (parse(svg.markup).documentElement.getAttribute('viewBox') ?? '')
      .split(' ')
      .map(Number)
    expect(x).toBeLessThanOrEqual((bounds?.x ?? 0) - EXPORT_MARGIN)
    expect((x ?? 0) + (width ?? 0)).toBeGreaterThanOrEqual(
      (bounds?.x ?? 0) + (bounds?.width ?? 0) + EXPORT_MARGIN,
    )
  })

  it('never produces a zero-sized image', () => {
    const dot = slice({
      blocks: { a: block('a', { width: 0, height: 0 }) },
      blockOrder: ['a'],
    })
    const svg = svgOf(dot, { margin: 0 })
    expect(svg.width).toBeGreaterThan(0)
    expect(svg.height).toBeGreaterThan(0)
  })
})

describe('how the styles travel', () => {
  it('writes the theme into an embedded stylesheet', () => {
    const parsed = parse(svgOf(wired()).markup)
    const sheet = parsed.querySelector('style')?.textContent ?? ''

    expect(sheet).toContain(THEMES.dark.blockFill)
    expect(sheet).toContain(THEMES.dark.connection)
    expect(sheet).toContain(`${STYLE_METRICS.blockFontSize}px`)
    // No `var()`: a loose file has no `:root` to resolve them against.
    expect(sheet).not.toContain('var(')
  })

  it('exports the theme it is asked for, not whichever one the app is on', () => {
    const light = exportSvg(wired(), { theme: 'light' })
    const dark = exportSvg(wired(), { theme: 'dark' })
    expect(light?.markup).toContain(THEMES.light.blockFill)
    expect(dark?.markup).toContain(THEMES.dark.blockFill)
    expect(light?.markup).not.toBe(dark?.markup)
  })

  it('leaves an unstyled block on the class, so the file can be re-themed', () => {
    // The document's own semantics preserved: "unstyled" stays unstyled rather
    // than being flattened into "explicitly this colour".
    const one = slice({ blocks: { a: block('a') }, blockOrder: ['a'] })
    const shape = parse(svgOf(one).markup).querySelector('rect.block__shape')
    expect(shape?.getAttribute('style')).toBeNull()
    expect(shape?.getAttribute('class')).toBe('block__shape')
  })

  it('inlines a style the user actually chose', () => {
    const painted = slice({
      blocks: { a: block('a', { style: { fill: '#e2683c', strokeWidth: 3 } }) },
      blockOrder: ['a'],
    })
    const shape = parse(svgOf(painted).markup).querySelector('rect.block__shape')
    expect(shape?.getAttribute('style')).toContain('fill:#e2683c')
    expect(shape?.getAttribute('style')).toContain('stroke-width:3')
  })

  it('carries a dashed arrow as a dash array', () => {
    const dashed = parse(svgOf(wired({ dashed: true, strokeWidth: 2 })).markup)
    expect(dashed.querySelector('.connection__line')?.getAttribute('style')).toContain(
      'stroke-dasharray:6 4',
    )
  })

  it('keeps the label colour off the box and the fill off the label', () => {
    const painted = slice({
      blocks: {
        a: block('a', { style: { fill: '#111111', textColor: '#eeeeee', fontSize: 22 } }),
      },
      blockOrder: ['a'],
    })
    const parsed = parse(svgOf(painted).markup)
    const shape = parsed.querySelector('rect.block__shape')?.getAttribute('style') ?? ''
    const text = parsed.querySelector('text')?.getAttribute('style') ?? ''

    expect(shape).toContain('fill:#111111')
    expect(shape).not.toContain('#eeeeee')
    expect(text).toContain('fill:#eeeeee')
    expect(text).toContain('font-size:22')
  })
})

describe('the background', () => {
  it('paints the theme surface by default', () => {
    const parsed = parse(svgOf(wired()).markup)
    const backdrop = parsed.querySelector('svg > rect:not(.block__shape)')
    expect(backdrop?.getAttribute('fill')).toBe(THEMES.dark.surface)
  })

  it('covers exactly the viewBox, so nothing shows through at the edge', () => {
    const svg = svgOf(wired())
    const parsed = parse(svg.markup)
    const backdrop = parsed.querySelector('svg > rect:not(.block__shape)')
    expect(Number(backdrop?.getAttribute('width'))).toBe(svg.width)
    expect(Number(backdrop?.getAttribute('height'))).toBe(svg.height)
  })

  it('leaves it out when asked for transparency', () => {
    const parsed = parse(svgOf(wired(), { background: null }).markup)
    expect(parsed.querySelector('svg > rect:not(.block__shape)')).toBeNull()
  })

  it('takes any colour it is handed', () => {
    const parsed = parse(svgOf(wired(), { background: '#ff00ff' }).markup)
    const backdrop = parsed.querySelector('svg > rect:not(.block__shape)')
    expect(backdrop?.getAttribute('fill')).toBe('#ff00ff')
  })
})

describe('exporting does not change anything', () => {
  it('leaves the document it was given untouched', () => {
    const document = wired()
    const before = structuredClone(document)
    exportSvg(document, { theme: 'dark' })
    exportSvg(document, { theme: 'light', background: null })
    expect(document).toEqual(before)
  })

  it('is deterministic: the same document exports byte for byte the same', () => {
    const document = wired({ stroke: '#00ff00', dashed: true })
    expect(svgOf(document).markup).toBe(svgOf(document).markup)
  })
})
