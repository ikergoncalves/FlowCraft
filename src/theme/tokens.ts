/**
 * The palette, and the single place any part of the app learns a colour from.
 *
 * **This table is the source of truth, and the stylesheet is generated from
 * it** — see `stylesheet.ts`. That direction was Phase 6's first real decision,
 * because Phase 5 shipped the other arrangement and left a debt behind:
 * `index.css` declared `--block-fill: #232833` and `utils/style.ts` declared
 * `DEFAULT_BLOCK_STYLE.fill = '#232833'`, two hand-kept copies of one fact.
 * With one theme that was merely fragile. With two it is broken outright — the
 * properties panel would show the dark theme's slate while the canvas painted
 * the light theme's white, and the mixed-value detection that compares
 * *resolved* values would answer differently depending on which stylesheet
 * happened to be loaded.
 *
 * The two ways out were to make CSS authoritative and read the values back
 * with `getComputedStyle`, or to make TypeScript authoritative and emit the
 * CSS. TypeScript won on three counts:
 *
 *  - `strokeWidth` and `fontSize` are numbers, not colours. Reading them out
 *    of a custom property means parsing a string back into a number on every
 *    resolution, and a typo in the unit turns into `NaN` at render time
 *    instead of a type error at build time.
 *  - `getComputedStyle` needs a live document with the stylesheet attached.
 *    jsdom has neither (the Vitest config loads no CSS), so every unit test of
 *    resolution would have to stub the reader — which is a second table again,
 *    wearing a different hat.
 *  - Generating one stylesheet from one table cannot drift. Reading a table
 *    back out of a stylesheet can, the moment a rule is edited by hand.
 */

export type ThemeName = 'dark' | 'light'

/** Both themes, in the order the toggle cycles through them. */
export const THEME_NAMES: readonly ThemeName[] = ['dark', 'light']

/**
 * Every colour the app paints with.
 *
 * Split by role rather than by hue: `blockFill` and `surfaceRaised` are the
 * same shade in the dark theme and deliberately different in the light one, so
 * naming them for what they are is what lets the two themes disagree.
 *
 * A type alias rather than an interface, and that is not cosmetic: TypeScript
 * gives an alias an implicit index signature and an interface none, so only
 * this form lets `Object.entries` below see `string` values rather than `any`
 * — which is the difference between a typo in a token name being a build
 * error and being a missing custom property at runtime.
 */
export type ThemeTokens = {
  /** The canvas behind everything. */
  surface: string
  /** Toolbar and text-editor background: one step up from `surface`. */
  surfaceRaised: string
  border: string
  text: string
  textMuted: string
  accent: string
  /** The accent at low opacity, behind a pressed toolbar button. */
  accentSoft: string
  /** The marquee's interior. */
  marqueeFill: string
  /** Floating chrome — the properties panel, the zoom indicator. */
  overlay: string
  /** A hover wash, light-on-dark or dark-on-light as the theme requires. */
  hover: string
  /** The same idea, one step stronger: keycaps and the "Mixed" badge. */
  wash: string
  gridDot: string

  /*
   * Document defaults. These four are what `utils/style.ts` turns into
   * `defaultBlockStyle`/`defaultConnectionStyle`, and they are the reason this
   * table has to be reachable from TypeScript at all: the properties panel
   * shows them, and the mixed-value detection compares against them.
   */
  blockFill: string
  blockStroke: string
  connection: string

  /**
   * The one colour that means "something is not right" — the storage chip when
   * the editor is running without a place to save to. Distinct from `accent`
   * on purpose: accent means "this is active", and a degraded session is not.
   */
  warning: string

  /* Selection chrome. */
  selectionBounds: string
  group: string
  connectionSelected: string
  port: string
}

/**
 * Sizes that are part of the same defaults but do not vary by theme.
 *
 * A border is one unit wide whether the page is dark or light; only its colour
 * is a matter of theme. Keeping them out of `ThemeTokens` means they are
 * written once instead of once per theme, which is the same argument that put
 * the colours here in the first place.
 */
export const STYLE_METRICS = {
  blockStrokeWidth: 1,
  blockFontSize: 14,
  connectionStrokeWidth: 1.75,
} as const

export const THEMES: Record<ThemeName, ThemeTokens> = {
  dark: {
    surface: '#14161a',
    surfaceRaised: '#1c1f26',
    border: '#2c313b',
    text: '#e7eaf0',
    textMuted: '#97a0b0',
    accent: '#4c8dff',
    accentSoft: 'rgb(76 141 255 / 18%)',
    marqueeFill: 'rgb(76 141 255 / 12%)',
    overlay: 'rgb(28 31 38 / 92%)',
    hover: 'rgb(255 255 255 / 6%)',
    wash: 'rgb(255 255 255 / 9%)',
    gridDot: '#333a47',
    blockFill: '#232833',
    blockStroke: '#3b4351',
    connection: '#7d8798',
    warning: '#e0b341',
    selectionBounds: '#6f7d94',
    group: '#a9b6cc',
    connectionSelected: '#4c8dff',
    port: '#4c8dff',
  },
  light: {
    surface: '#f4f6f9',
    surfaceRaised: '#ffffff',
    border: '#d5dae2',
    text: '#1b1f27',
    textMuted: '#5b6472',
    accent: '#2563eb',
    accentSoft: 'rgb(37 99 235 / 14%)',
    marqueeFill: 'rgb(37 99 235 / 10%)',
    overlay: 'rgb(255 255 255 / 94%)',
    hover: 'rgb(15 23 42 / 6%)',
    wash: 'rgb(15 23 42 / 9%)',
    gridDot: '#c6ccd6',
    blockFill: '#ffffff',
    blockStroke: '#c2c9d4',
    connection: '#6b7484',
    warning: '#a16207',
    selectionBounds: '#8b94a5',
    group: '#5b6472',
    connectionSelected: '#2563eb',
    port: '#2563eb',
  },
}

/**
 * `blockFill` -> `--block-fill`.
 *
 * Derived rather than tabulated, so a new token needs no second edit and no
 * two tokens can accidentally be given the same property name.
 */
export function cssVariableName(token: string): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

/** Every custom property one theme defines, ready to be written into CSS. */
export function themeCustomProperties(theme: ThemeName): Record<string, string> {
  const properties: Record<string, string> = {}
  for (const [token, value] of Object.entries(THEMES[theme])) {
    properties[cssVariableName(token)] = value
  }
  return properties
}

/**
 * The theme-independent metrics as custom properties.
 *
 * Emitted alongside the colours so the stylesheet reads its stroke width from
 * the same constant `defaultBlockStyle` does. `blockFontSize` carries a `px`
 * unit because CSS needs one — and inside an SVG one CSS pixel is one user
 * unit, so the number means the same thing on both sides.
 */
export function metricCustomProperties(): Record<string, string> {
  return {
    [cssVariableName('blockStrokeWidth')]: String(STYLE_METRICS.blockStrokeWidth),
    [cssVariableName('blockFontSize')]: `${STYLE_METRICS.blockFontSize}px`,
    [cssVariableName('connectionStrokeWidth')]: String(
      STYLE_METRICS.connectionStrokeWidth,
    ),
  }
}

/** Narrows an arbitrary string to a theme name. */
export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && THEME_NAMES.includes(value as ThemeName)
}
