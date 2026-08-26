import { STYLE_METRICS, THEMES, type ThemeName } from '../theme/tokens'
import type { BlockStyle, ConnectionStyle } from '../types'

/**
 * Style resolution, and the two jobs it has to keep apart.
 *
 * **Rendering** must emit nothing for a field the document does not set, so an
 * unstyled block keeps taking its colours from the stylesheet — that is what
 * lets a theme swap repaint it by changing custom properties instead of
 * rewriting every block in the document. `blockShapeStyle` therefore returns a
 * *sparse* prop object.
 *
 * **The panel** needs a concrete value to put in a colour swatch or a number
 * box, because there is no such thing as an empty `<input type="color">`.
 * `resolveBlockStyle` fills the gaps.
 *
 * The two must never be confused. Resolving at render time would bake the
 * active theme's palette into every block the moment anyone opened the panel —
 * and with two themes that is not a hypothetical: it would freeze whichever
 * theme happened to be on.
 *
 * **Where the defaults come from.** Not from a table here. Phase 5 kept one,
 * transcribed by hand from `index.css`, and Phase 6 deleted it: the defaults
 * are now derived from `theme/tokens.ts`, the same table the stylesheet is
 * generated from, so the panel and the canvas cannot disagree about what
 * "unstyled" looks like. That also makes the defaults a *function of the
 * theme* rather than a constant, which is why every resolver below takes them
 * as an argument instead of reaching for a module-level value.
 */

/** What the stylesheet paints for a block when the document says nothing. */
export function defaultBlockStyle(theme: ThemeName): Required<BlockStyle> {
  const tokens = THEMES[theme]
  return {
    fill: tokens.blockFill,
    stroke: tokens.blockStroke,
    strokeWidth: STYLE_METRICS.blockStrokeWidth,
    fontSize: STYLE_METRICS.blockFontSize,
    // The label takes the theme's ordinary text colour; it has no token of its
    // own, because a block's label reading differently from the toolbar would
    // be a bug rather than a feature.
    textColor: tokens.text,
  }
}

/** `defaultBlockStyle` for arrows. */
export function defaultConnectionStyle(theme: ThemeName): Required<ConnectionStyle> {
  return {
    stroke: THEMES[theme].connection,
    strokeWidth: STYLE_METRICS.connectionStrokeWidth,
    dashed: false,
  }
}

/**
 * Drops keys whose value is `undefined`.
 *
 * A partial style written as `{ fill: undefined }` must not shadow the
 * stylesheet — spreading it over a default would otherwise hand back
 * `undefined` for a field that has a perfectly good default.
 */
function defined<T extends object>(style: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

/** A block's style with every gap filled from `defaults`, for display. */
export function resolveBlockStyle(
  style: BlockStyle | undefined,
  defaults: Required<BlockStyle>,
): Required<BlockStyle> {
  return { ...defaults, ...(style ? defined(style) : {}) }
}

/** `resolveBlockStyle` for arrows. */
export function resolveConnectionStyle(
  style: ConnectionStyle | undefined,
  defaults: Required<ConnectionStyle>,
): Required<ConnectionStyle> {
  return { ...defaults, ...(style ? defined(style) : {}) }
}

/**
 * The marker for "these elements disagree about this field".
 *
 * A symbol rather than `null` or `''`, both of which a style field could
 * legitimately hold one day. A panel that showed the first block's colour for
 * a divergent selection would be lying about four of the five blocks, and the
 * next click would silently flatten them all onto that lie.
 */
export const MIXED = Symbol('mixed')

/** One agreed value, or `MIXED`. */
export type Shared<T> = T | typeof MIXED

/**
 * The one value every element agrees on, or `MIXED`.
 *
 * An empty list is `MIXED` too: there is nothing to agree, and the panel is
 * not shown for an empty selection anyway.
 */
export function sharedValue<T>(values: readonly T[]): Shared<T> {
  if (values.length === 0) return MIXED
  const first = values[0] as T
  return values.every((value) => Object.is(value, first)) ? first : MIXED
}

/** Narrows a `Shared<T>` for the callers that only care about real values. */
export function isMixed<T>(value: Shared<T>): value is typeof MIXED {
  return value === MIXED
}

/**
 * The shared value of one resolved field across a selection of blocks.
 *
 * `defaults` is threaded in rather than looked up because the answer genuinely
 * depends on the theme: two unstyled blocks agree on "the default fill", and
 * *which* colour that is changes when the theme does.
 */
export function sharedBlockField<K extends keyof BlockStyle>(
  styles: readonly (BlockStyle | undefined)[],
  field: K,
  defaults: Required<BlockStyle>,
): Shared<Required<BlockStyle>[K]> {
  return sharedValue(styles.map((style) => resolveBlockStyle(style, defaults)[field]))
}

/** `sharedBlockField` for arrows. */
export function sharedConnectionField<K extends keyof ConnectionStyle>(
  styles: readonly (ConnectionStyle | undefined)[],
  field: K,
  defaults: Required<ConnectionStyle>,
): Shared<Required<ConnectionStyle>[K]> {
  return sharedValue(
    styles.map((style) => resolveConnectionStyle(style, defaults)[field]),
  )
}

/**
 * The inline style a block's shape needs — and only the fields it actually
 * sets.
 *
 * **Inline style, not presentation attributes.** The first attempt used
 * attributes and the browser harness caught it immediately: in SVG a
 * presentation attribute sits at the *bottom* of the cascade, below every
 * author rule, so `fill="#e2683c"` lost to `.block__shape { fill: … }` and a
 * block the user had painted orange rendered in the default slate. The
 * attribute was there, the DOM assertions were green, and only
 * `getComputedStyle` in a real renderer disagreed.
 *
 * Inline style wins that fight while staying per-property, so an unset field
 * still falls through to the class — which is what keeps a theme able to
 * repaint an unstyled block, and leaves `vector-effect` where it belongs.
 */
export function blockShapeStyle(style?: BlockStyle): {
  fill?: string
  stroke?: string
  strokeWidth?: number
} {
  if (!style) return {}
  return defined({
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
  })
}

/**
 * The same, for a block's label.
 *
 * `fontSize` is a bare number, which React renders as `px` — and inside an SVG
 * one CSS pixel is one user unit, so the size stays in world space and scales
 * with the zoom exactly as the class's `font-size` does.
 */
export function blockTextStyle(style?: BlockStyle): {
  fill?: string
  fontSize?: number
} {
  if (!style) return {}
  return defined({ fill: style.textColor, fontSize: style.fontSize })
}

/**
 * A dash pattern proportional to the stroke, or `undefined` for a solid line.
 *
 * Derived from the width rather than fixed, so a 6-unit arrow does not read as
 * a solid line with faint notches in it. The fallback width is the metric, not
 * a theme lookup: dash geometry has no colour in it.
 */
export function connectionDashArray(style?: ConnectionStyle): string | undefined {
  if (!style?.dashed) return undefined
  const width = style.strokeWidth ?? STYLE_METRICS.connectionStrokeWidth
  return `${width * 3} ${width * 2}`
}

/** The sparse inline style for an arrow's visible line. */
export function connectionLineStyle(style?: ConnectionStyle): {
  stroke?: string
  strokeWidth?: number
  strokeDasharray?: string
} {
  if (!style) return {}
  return defined({
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    strokeDasharray: connectionDashArray(style),
  })
}
