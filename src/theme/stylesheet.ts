import {
  metricCustomProperties,
  THEME_NAMES,
  themeCustomProperties,
  type ThemeName,
} from './tokens'

/**
 * Turns the token table into the custom-property declarations `index.css`
 * consumes, and installs them.
 *
 * The generated sheet holds *only* `:root` and `:root[data-theme='…']` blocks
 * — declarations, never rules. Every selector that paints anything stays in
 * `index.css` and refers to the properties by name, which is what makes a
 * theme switch a single attribute write on `<html>` with no component
 * re-rendering and no per-element style rewriting.
 *
 * The default theme is emitted twice: once on bare `:root`, so the page has a
 * complete palette before any attribute is set, and once under an explicit
 * `[data-theme='dark']`, so switching *back* to dark beats the light block on
 * specificity rather than on document order.
 */
export const THEME_STYLE_ELEMENT_ID = 'flowcraft-theme'

/** The theme a document falls back to when nothing has chosen one. */
export const DEFAULT_THEME: ThemeName = 'dark'

function declarations(properties: Record<string, string>, indent = '  '): string {
  return Object.entries(properties)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n')
}

/** The whole generated stylesheet, as text. */
export function themeStylesheet(): string {
  const metrics = declarations(metricCustomProperties())

  const blocks = [
    `:root {\n${declarations(themeCustomProperties(DEFAULT_THEME))}\n${metrics}\n}`,
  ]
  for (const theme of THEME_NAMES) {
    blocks.push(
      `:root[data-theme='${theme}'] {\n${declarations(themeCustomProperties(theme))}\n}`,
    )
  }
  return `${blocks.join('\n\n')}\n`
}

/**
 * Puts the generated sheet into `document`, creating its `<style>` once.
 *
 * Idempotent, because React 19's StrictMode mounts twice in development and a
 * second `<style>` with the same declarations would be harmless but confusing
 * to find later.
 */
export function installThemeStyles(doc: Document = document): HTMLStyleElement {
  const existing = doc.getElementById(THEME_STYLE_ELEMENT_ID)
  const element =
    existing instanceof HTMLStyleElement ? existing : doc.createElement('style')

  element.id = THEME_STYLE_ELEMENT_ID
  element.textContent = themeStylesheet()
  if (!element.isConnected) doc.head.append(element)
  return element
}

/**
 * Switches the document over to a theme.
 *
 * Two writes, and no third: `data-theme` picks the block of custom properties,
 * and `color-scheme` tells the browser to paint its own furniture — form
 * controls, scrollbars, the canvas behind the page — to match. Without the
 * second, a light theme keeps dark scrollbars and the native colour picker in
 * the properties panel opens inverted.
 */
export function applyTheme(theme: ThemeName, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme
  doc.documentElement.style.colorScheme = theme
}
