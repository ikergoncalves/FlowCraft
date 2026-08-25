import type { BlockStyle, ConnectionStyle } from '../types'

/**
 * Style resolution, and the two jobs it has to keep apart.
 *
 * **Rendering** must emit nothing for a field the document does not set, so an
 * unstyled block keeps taking its colours from `index.css` — that is what lets
 * Phase 6 swap a theme by editing custom properties instead of rewriting every
 * block in the document. `blockStyleAttributes` therefore returns a *sparse*
 * prop object.
 *
 * **The panel** needs a concrete value to put in a colour swatch or a number
 * box, because there is no such thing as an empty `<input type="color">`.
 * `resolveBlockStyle` fills the gaps from the tables below.
 *
 * The two must never be confused. Resolving at render time would bake today's
 * palette into every block the moment anyone opened the panel.
 */

/**
 * What the stylesheet paints when the document says nothing.
 *
 * These mirror the custom properties in `index.css` and exist only so the
 * panel can show the user what they are about to change. Nothing writes them
 * into a block: a block whose fill is set to exactly this value still carries
 * an explicit `fill`, and that is the honest record of what the user did.
 */
export const DEFAULT_BLOCK_STYLE: Required<BlockStyle> = {
  fill: '#232833',
  stroke: '#3b4351',
  strokeWidth: 1,
  fontSize: 14,
  textColor: '#e7eaf0',
}

/** `DEFAULT_BLOCK_STYLE` for arrows, mirroring `.connection__line`. */
export const DEFAULT_CONNECTION_STYLE: Required<ConnectionStyle> = {
  stroke: '#7d8798',
  strokeWidth: 1.75,
  dashed: false,
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

/** A block's style with every gap filled from the defaults, for display. */
export function resolveBlockStyle(style?: BlockStyle): Required<BlockStyle> {
  return { ...DEFAULT_BLOCK_STYLE, ...(style ? defined(style) : {}) }
}

/** `resolveBlockStyle` for arrows. */
export function resolveConnectionStyle(
  style?: ConnectionStyle,
): Required<ConnectionStyle> {
  return { ...DEFAULT_CONNECTION_STYLE, ...(style ? defined(style) : {}) }
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

/** The shared value of one resolved field across a selection of blocks. */
export function sharedBlockField<K extends keyof BlockStyle>(
  styles: readonly (BlockStyle | undefined)[],
  field: K,
): Shared<Required<BlockStyle>[K]> {
  return sharedValue(styles.map((style) => resolveBlockStyle(style)[field]))
}

/** `sharedBlockField` for arrows. */
export function sharedConnectionField<K extends keyof ConnectionStyle>(
  styles: readonly (ConnectionStyle | undefined)[],
  field: K,
): Shared<Required<ConnectionStyle>[K]> {
  return sharedValue(styles.map((style) => resolveConnectionStyle(style)[field]))
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
 * still falls through to the class — which is what keeps Phase 6's themes able
 * to repaint an unstyled block, and leaves `vector-effect` where it belongs.
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
 * with the zoom exactly as the base `font-size` attribute does.
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
 * a solid line with faint notches in it.
 */
export function connectionDashArray(style?: ConnectionStyle): string | undefined {
  if (!style?.dashed) return undefined
  const width = style.strokeWidth ?? DEFAULT_CONNECTION_STYLE.strokeWidth
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
