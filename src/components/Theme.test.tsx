import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useHistoryStore } from '../history/historyStore'
import { useDiagramStore } from '../store/diagramStore'
import {
  DEFAULT_THEME,
  THEME_STYLE_ELEMENT_ID,
  themeStylesheet,
} from '../theme/stylesheet'
import { useThemeStore } from '../theme/themeStore'
import { THEMES } from '../theme/tokens'
import { DEFAULT_VIEWPORT } from '../utils/coords'
import { defaultBlockStyle } from '../utils/style'

/*
 * Themes, and what a jsdom test can honestly say about them.
 *
 * It cannot say what colour anything is. There is no stylesheet loaded (the
 * Vitest config sets `css: false`) and jsdom resolves no custom properties
 * through the cascade even when there is, so `getComputedStyle(shape).fill`
 * here would be an empty string under every theme — a test that asserted a
 * colour would be asserting its own stub.
 *
 * What it can say is the part that actually decides the colour: which of the
 * two mechanisms each element is on. An unstyled block emits *no* inline fill,
 * so whatever the stylesheet says wins and a theme swap reaches it; a styled
 * block emits its own, which beats the class and does not move. Those two
 * facts plus "the generated sheet gives the two themes different values"
 * (`theme/theme.test.ts`) and "the browser really repaints" (the browser
 * harness, through a real `getComputedStyle`) are the whole chain, and each
 * link is asserted where it can be asserted truthfully.
 */

const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 800

const CANVAS_BOX: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: CANVAS_WIDTH,
  bottom: CANVAS_HEIGHT,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  toJSON: () => ({}),
}

beforeAll(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(CANVAS_BOX)
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  useDiagramStore.setState({
    blocks: {},
    blockOrder: [],
    connections: {},
    connectionOrder: [],
    groups: {},
    groupOrder: [],
    viewport: DEFAULT_VIEWPORT,
    selectedIds: [],
    selectedConnectionIds: [],
    tool: 'select',
    snapToGrid: false,
  })
  useHistoryStore.getState().clear()
  useThemeStore.setState({ theme: DEFAULT_THEME })
  document.documentElement.dataset.theme = DEFAULT_THEME
  document.getElementById(THEME_STYLE_ELEMENT_ID)?.remove()
})

const store = () => useDiagramStore.getState()
const themeButton = () => screen.getByTestId('theme-toggle')

/** Seeds one plain block and one painted orange, then clears the history. */
function seedPair(): { plain: string; painted: string } {
  let plain = ''
  let painted = ''
  act(() => {
    plain = store().addBlock({
      type: 'rect',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      text: 'plain',
    }).id
    painted = store().addBlock({
      type: 'rect',
      x: 200,
      y: 0,
      width: 100,
      height: 60,
      text: 'painted',
      style: { fill: '#e2683c' },
    }).id
    useHistoryStore.getState().clear()
  })
  return { plain, painted }
}

const shapeOf = (id: string): SVGRectElement => {
  const node = document.querySelector(`[data-block-id="${id}"] .block__shape`)
  if (!(node instanceof SVGElement)) throw new Error(`no shape for ${id}`)
  return node as SVGRectElement
}

describe('the theme toggle', () => {
  it('names the theme it will switch to, not the one in force', () => {
    render(<App />)
    expect(themeButton()).toHaveAttribute('data-theme-target', 'light')
    expect(themeButton()).toHaveAccessibleName('Switch to the light theme')

    fireEvent.click(themeButton())
    expect(themeButton()).toHaveAttribute('data-theme-target', 'dark')
  })

  it('switches the document over, both ways', () => {
    render(<App />)
    fireEvent.click(themeButton())
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    fireEvent.click(themeButton())
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('answers to L as well as to the button', () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'l' })
    expect(useThemeStore.getState().theme).toBe('light')
    fireEvent.keyDown(window, { key: 'L' })
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('leaves L alone while the text editor has focus', () => {
    seedPair()
    render(<App />)
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'l' })
    expect(useThemeStore.getState().theme).toBe('dark')
    input.remove()
  })

  it('is not an undoable edit', () => {
    render(<App />)
    fireEvent.click(themeButton())
    expect(useHistoryStore.getState().undoStack).toHaveLength(0)
  })
})

describe('what a theme swap reaches', () => {
  it('leaves an unstyled block on the stylesheet, so the theme governs it', () => {
    const { plain } = seedPair()
    render(<App />)

    expect(shapeOf(plain).style.fill).toBe('')
    fireEvent.click(themeButton())
    expect(shapeOf(plain).style.fill).toBe('')

    // And the two themes really do paint that class differently, which is the
    // half of the claim this file cannot measure directly.
    expect(THEMES.light.blockFill).not.toBe(THEMES.dark.blockFill)
    expect(themeStylesheet()).toContain(`--block-fill: ${THEMES.light.blockFill};`)
  })

  it('leaves a painted block exactly as the user painted it', () => {
    const { painted } = seedPair()
    render(<App />)

    expect(shapeOf(painted).style.fill).toBe('rgb(226, 104, 60)')
    fireEvent.click(themeButton())
    expect(shapeOf(painted).style.fill).toBe('rgb(226, 104, 60)')
    expect(store().blocks[painted]?.style?.fill).toBe('#e2683c')
  })

  it('does not touch the document at all', () => {
    const before = structuredClone({
      blocks: store().blocks,
      connections: store().connections,
      groups: store().groups,
    })
    seedPair()
    render(<App />)
    const seeded = structuredClone({
      blocks: store().blocks,
      connections: store().connections,
      groups: store().groups,
    })

    fireEvent.click(themeButton())
    expect(
      structuredClone({
        blocks: store().blocks,
        connections: store().connections,
        groups: store().groups,
      }),
    ).toEqual(seeded)
    expect(before.blocks).toEqual({})
  })
})

describe('the properties panel under a theme', () => {
  it('shows the active theme’s defaults for an unstyled block', () => {
    const { plain } = seedPair()
    render(<App />)
    act(() => {
      store().select(plain)
    })

    const picker = () => screen.getByTestId<HTMLInputElement>('picker-fill')
    expect(picker().value).toBe(defaultBlockStyle('dark').fill)

    fireEvent.click(themeButton())
    expect(picker().value).toBe(defaultBlockStyle('light').fill)
    expect(picker().value).not.toBe(defaultBlockStyle('dark').fill)
  })

  it('keeps showing a painted block’s own colour across a swap', () => {
    const { painted } = seedPair()
    render(<App />)
    act(() => {
      store().select(painted)
    })

    const picker = () => screen.getByTestId<HTMLInputElement>('picker-fill')
    expect(picker().value).toBe('#e2683c')
    fireEvent.click(themeButton())
    expect(picker().value).toBe('#e2683c')
  })

  it('re-decides what counts as mixed when the theme moves', () => {
    // One block painted the dark default, one unstyled. They agree under dark
    // and diverge under light, and the panel has to change its mind — this is
    // the concrete failure the shared table would have caused.
    const { plain } = seedPair()
    let extra = ''
    act(() => {
      extra = store().addBlock({
        type: 'rect',
        x: 400,
        y: 0,
        width: 100,
        height: 60,
        text: 'default-coloured',
        style: { fill: defaultBlockStyle('dark').fill },
      }).id
      useHistoryStore.getState().clear()
    })

    render(<App />)
    act(() => {
      store().select([plain, extra])
    })
    expect(screen.queryByTestId('mixed-indicator')).toBeNull()

    fireEvent.click(themeButton())
    expect(screen.queryAllByTestId('mixed-indicator').length).toBeGreaterThan(0)
  })
})
