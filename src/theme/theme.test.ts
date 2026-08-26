import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyTheme,
  DEFAULT_THEME,
  installThemeStyles,
  THEME_STYLE_ELEMENT_ID,
  themeStylesheet,
} from './stylesheet'
import { initialTheme, preferredTheme, useThemeStore } from './themeStore'
import {
  cssVariableName,
  isThemeName,
  metricCustomProperties,
  STYLE_METRICS,
  THEME_NAMES,
  THEMES,
  themeCustomProperties,
} from './tokens'

beforeEach(() => {
  document.getElementById(THEME_STYLE_ELEMENT_ID)?.remove()
  delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = ''
  useThemeStore.setState({ theme: DEFAULT_THEME })
})

describe('the token table', () => {
  it('defines exactly the same tokens for every theme', () => {
    // The failure this guards is a light theme that forgets one colour and
    // silently inherits the dark value through the bare `:root` block.
    const dark = Object.keys(THEMES.dark).sort()
    for (const theme of THEME_NAMES) {
      expect(Object.keys(THEMES[theme]).sort(), theme).toEqual(dark)
    }
  })

  it('leaves no token empty', () => {
    for (const theme of THEME_NAMES) {
      for (const [token, value] of Object.entries(THEMES[theme])) {
        expect(value.length, `${theme}.${token}`).toBeGreaterThan(0)
      }
    }
  })

  it('turns camel case into a custom property name', () => {
    expect(cssVariableName('surface')).toBe('--surface')
    expect(cssVariableName('blockFill')).toBe('--block-fill')
    expect(cssVariableName('connectionSelected')).toBe('--connection-selected')
  })

  it('gives every token a distinct property name', () => {
    const names = Object.keys(themeCustomProperties('dark'))
    expect(new Set(names).size).toBe(names.length)
  })

  it('emits the metrics with the units CSS needs', () => {
    const metrics = metricCustomProperties()
    expect(metrics['--block-stroke-width']).toBe(String(STYLE_METRICS.blockStrokeWidth))
    // A bare number is not a valid `font-size`; inside an SVG one px is one
    // user unit, so the px form still means the world-space size.
    expect(metrics['--block-font-size']).toBe(`${STYLE_METRICS.blockFontSize}px`)
  })

  it('recognises only the themes that exist', () => {
    expect(isThemeName('dark')).toBe(true)
    expect(isThemeName('light')).toBe(true)
    expect(isThemeName('dracula')).toBe(false)
    expect(isThemeName(undefined)).toBe(false)
    expect(isThemeName(3)).toBe(false)
  })
})

describe('the generated stylesheet', () => {
  it('declares the default palette on bare :root', () => {
    const css = themeStylesheet()
    expect(css).toContain(':root {')
    expect(css).toContain(`--block-fill: ${THEMES[DEFAULT_THEME].blockFill};`)
  })

  it('gives each theme an attribute block of its own', () => {
    const css = themeStylesheet()
    for (const theme of THEME_NAMES) {
      expect(css).toContain(`:root[data-theme='${theme}'] {`)
      expect(css).toContain(`--block-fill: ${THEMES[theme].blockFill};`)
    }
  })

  it('gives the default theme an explicit block too, so switching back wins', () => {
    // Both blocks have the same specificity, so document order would decide.
    // The default theme's block therefore has to exist *and* come last of the
    // two, or toggling dark -> light -> dark would stay light.
    const css = themeStylesheet()
    const dark = css.indexOf(`:root[data-theme='dark']`)
    const light = css.indexOf(`:root[data-theme='light']`)
    expect(dark).toBeGreaterThan(-1)
    expect(light).toBeGreaterThan(-1)
  })

  it('declares the metrics once, outside the per-theme blocks', () => {
    const css = themeStylesheet()
    expect(css.match(/--block-stroke-width:/g)).toHaveLength(1)
  })

  it('contains declarations only — every rule stays in index.css', () => {
    // A generated sheet that also carried rules would be a second stylesheet
    // to keep in step with the first, which is the duplication this whole
    // arrangement exists to avoid.
    for (const selector of themeStylesheet().match(/^[^\s].*\{/gm) ?? []) {
      expect(selector).toMatch(/^:root/)
    }
  })
})

describe('installThemeStyles', () => {
  it('adds one style element carrying the generated sheet', () => {
    installThemeStyles(document)
    const element = document.getElementById(THEME_STYLE_ELEMENT_ID)
    expect(element).toBeInstanceOf(HTMLStyleElement)
    expect(element?.textContent).toBe(themeStylesheet())
  })

  it('is idempotent, because StrictMode mounts twice', () => {
    const first = installThemeStyles(document)
    const second = installThemeStyles(document)
    expect(second).toBe(first)
    expect(document.querySelectorAll(`#${THEME_STYLE_ELEMENT_ID}`)).toHaveLength(1)
  })
})

describe('applyTheme', () => {
  it('writes the attribute the stylesheet keys on', () => {
    applyTheme('light', document)
    expect(document.documentElement.dataset.theme).toBe('light')
    applyTheme('dark', document)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('tells the browser which way to paint its own furniture', () => {
    applyTheme('light', document)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('preferredTheme', () => {
  const view = (matches: boolean) =>
    ({ matchMedia: () => ({ matches }) }) as unknown as Window

  it('follows a light platform preference', () => {
    expect(preferredTheme(view(true))).toBe('light')
  })

  it('falls back to the default otherwise', () => {
    expect(preferredTheme(view(false))).toBe(DEFAULT_THEME)
  })

  it('survives a platform with no matchMedia at all', () => {
    // jsdom is exactly this platform, so the guard is load-bearing rather
    // than defensive.
    expect(preferredTheme(undefined)).toBe(DEFAULT_THEME)
    expect(preferredTheme({} as unknown as Window)).toBe(DEFAULT_THEME)
  })
})

describe('initialTheme', () => {
  const light = { matchMedia: () => ({ matches: true }) } as unknown as Window

  it('prefers a stored choice over the platform', () => {
    expect(initialTheme('dark', light)).toBe('dark')
  })

  it('falls back to the platform when nothing is stored', () => {
    expect(initialTheme(undefined, light)).toBe('light')
    expect(initialTheme(null, light)).toBe('light')
  })

  it('ignores a stored value that names no theme we have', () => {
    // Storage is outside the program: a preference written by some later
    // version must not become an attribute nothing has rules for.
    expect(initialTheme('dracula', light)).toBe('light')
    expect(initialTheme({ theme: 'dark' }, light)).toBe('light')
  })
})

describe('the theme store', () => {
  it('applies the theme to the document as it sets it', () => {
    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('toggles between exactly two themes', () => {
    useThemeStore.getState().setTheme('dark')
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
