import {
  arrowMarkerStrokes,
  CONNECTION_CORNER_RADIUS,
  markerIdForStroke,
} from '../components/connectionStyle'
import type { DocumentSlice } from '../persistence/document'
import { STYLE_METRICS, THEMES, type ThemeName } from '../theme/tokens'
import type { Block, Connection } from '../types'
import { boundingBox, type Rect } from '../utils/geometry'
import { pathFromPoints, resolveAnchors, routeConnection } from '../utils/routing'
import { blockShapeStyle, blockTextStyle, connectionLineStyle } from '../utils/style'

/**
 * The diagram as a standalone `.svg` file.
 *
 * **Built from the document, not scraped from the DOM.** The obvious
 * implementation is to clone the live `<svg>` and strip the editing chrome out
 * of it, and it was rejected on three counts:
 *
 *  - *It exports what is on screen.* The canvas renders the visible region;
 *    Phase 7 adds virtualisation, at which point the live SVG holds only the
 *    blocks near the camera and a DOM-scraping export would silently write out
 *    a partial diagram. Nothing about that failure looks like a failure.
 *  - *Stripping is a list that rots.* "Remove the grid, the marquee, the
 *    ports, the handles, the outlines, the group boxes, the ghost, the halo,
 *    the hit paths" is a list to be kept in step with every future affordance,
 *    and forgetting an entry means shipping editing furniture inside someone's
 *    diagram. Building from the document inverts it: chrome is absent because
 *    it was never a thing the document had.
 *  - *It needs a rendered app.* A pure function of the document can be tested
 *    exhaustively without a renderer, and could later be called from anywhere.
 *
 * Nothing here duplicates rendering logic. The routing, the style resolution
 * and the marker-id scheme are the very same functions the canvas draws with,
 * so an exported arrow lands on the same coordinates as the one on screen.
 *
 * **Styles travel as an embedded `<style>`, not as inline attributes on every
 * element.** A loose `.svg` has no access to the app's stylesheet, so the
 * class-based defaults have to become concrete values somewhere. A `<style>`
 * block wins over inlining because:
 *
 *  - it preserves the document's own semantics — a block with no `fill` is
 *    *supposed* to take the theme's, and inlining would flatten "unstyled"
 *    into "explicitly this colour", which is a different document;
 *  - it is one rule instead of five attributes per element, so a
 *    five-hundred-block diagram exports as a file a person can still open in
 *    an editor and re-theme by changing four lines;
 *  - per-element overrides keep working exactly as they do in the app, because
 *    they are inline styles and inline styles beat a class.
 *
 * The one thing deliberately *not* carried over is
 * `vector-effect: non-scaling-stroke`. On the canvas it keeps a border one
 * screen pixel wide at any zoom, which is an editing affordance; in a static
 * file it would make borders thin out as the image is scaled up, which is a
 * rendering artefact rather than the drawing.
 */

/** Blank space around the content, in world units. */
export const EXPORT_MARGIN = 24

/** Arrowhead geometry, in world units — no zoom to divide by in a file. */
const ARROW_LENGTH = 10
const ARROW_WIDTH = 8

/** The font stack the app uses, repeated here because a file has no CSS. */
const FONT_STACK = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`

export interface SvgExportOptions {
  /** Which palette the unstyled elements come out in. */
  theme: ThemeName
  margin?: number
  /**
   * A background rectangle, or `null` for a transparent file. Defaults to the
   * theme's surface — see `png.ts` on why opaque is the right default.
   */
  background?: string | null
}

export interface SvgExport {
  markup: string
  /** The rendered size in pixels, which is also the viewBox size. */
  width: number
  height: number
}

const round = (value: number): number => Math.round(value * 100) / 100

/** XML-escapes text content. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** XML-escapes an attribute value, quotes included. */
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

/** `{ strokeWidth: 2 }` -> `stroke-width:2`, or `''` for an empty style. */
function cssText(style: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue
    const property = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    parts.push(`${property}:${typeof value === 'number' ? round(value) : value}`)
  }
  return parts.join(';')
}

/** ` style="…"`, or nothing at all when the element sets no properties. */
function styleAttribute(style: Record<string, string | number | undefined>): string {
  const text = cssText(style)
  return text.length > 0 ? ` style="${escapeAttribute(text)}"` : ''
}

/**
 * Every point the drawing actually occupies.
 *
 * Not just the blocks' bounding box: an orthogonal route leaves its anchor
 * along a stub before turning, so an arrow between two blocks can bow outside
 * the box that contains both of them. Framing on the blocks alone would clip
 * exactly the arrows that took the long way round.
 */
export function contentBounds(document: DocumentSlice): Rect | null {
  const blocks = document.blockOrder
    .map((id) => document.blocks[id])
    .filter((block): block is Block => block !== undefined)
  const box = boundingBox(blocks)
  if (box === null) return null

  let minX = box.x
  let minY = box.y
  let maxX = box.x + box.width
  let maxY = box.y + box.height

  for (const connection of connectionsOf(document)) {
    const source = document.blocks[connection.sourceId]
    const target = document.blocks[connection.targetId]
    if (!source || !target) continue
    for (const point of routeConnection(
      source,
      target,
      resolveAnchors(connection, source, target),
    )) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function connectionsOf(document: DocumentSlice): Connection[] {
  return document.connectionOrder
    .map((id) => document.connections[id])
    .filter((connection): connection is Connection => connection !== undefined)
}

/** One arrowhead marker, in a fixed user-space size. */
function marker(id: string, fill: string | undefined): string {
  const paint = fill === undefined ? '' : ` style="fill:${escapeAttribute(fill)}"`
  return [
    `<marker id="${escapeAttribute(id)}" viewBox="0 0 ${ARROW_LENGTH} ${ARROW_WIDTH}"`,
    ` markerUnits="userSpaceOnUse" markerWidth="${ARROW_LENGTH}" markerHeight="${ARROW_WIDTH}"`,
    ` refX="${ARROW_LENGTH}" refY="${ARROW_WIDTH / 2}" orient="auto">`,
    `<path class="connection__arrow"${paint}`,
    ` d="M 0 0 L ${ARROW_LENGTH} ${ARROW_WIDTH / 2} L 0 ${ARROW_WIDTH} z" /></marker>`,
  ].join('')
}

/**
 * The stylesheet the file carries, with the theme's values written out.
 *
 * Generated from the same token table the app's own stylesheet is, so an
 * exported diagram and the canvas it came from cannot disagree about what an
 * unstyled block looks like.
 */
function styleSheet(theme: ThemeName): string {
  const tokens = THEMES[theme]
  return [
    `.block__shape{fill:${tokens.blockFill};stroke:${tokens.blockStroke};stroke-width:${STYLE_METRICS.blockStrokeWidth}}`,
    `.block__text{fill:${tokens.text};font-size:${STYLE_METRICS.blockFontSize}px;font-family:${FONT_STACK}}`,
    `.connection__line{fill:none;stroke:${tokens.connection};stroke-width:${STYLE_METRICS.connectionStrokeWidth};stroke-linecap:round;stroke-linejoin:round}`,
    `.connection__arrow{fill:${tokens.connection}}`,
  ].join('\n    ')
}

function blockMarkup(block: Block): string {
  const centerX = round(block.x + block.width / 2)
  const centerY = round(block.y + block.height / 2)
  const label = escapeText(block.text)

  // A text block has no box in the export: its invisible hit rectangle exists
  // only so the pointer can grab it, which a file has no use for.
  const shape =
    block.type === 'rect'
      ? `<rect class="block__shape" x="${round(block.x)}" y="${round(block.y)}"` +
        ` width="${round(block.width)}" height="${round(block.height)}" rx="4"` +
        `${styleAttribute(blockShapeStyle(block.style))} />`
      : ''

  const text =
    label.length === 0
      ? ''
      : `<text class="block__text" x="${centerX}" y="${centerY}"` +
        ` text-anchor="middle" dominant-baseline="central"` +
        `${styleAttribute(blockTextStyle(block.style))}>${label}</text>`

  return `<g>${shape}${text}</g>`
}

function connectionMarkup(connection: Connection, document: DocumentSlice): string {
  const source = document.blocks[connection.sourceId]
  const target = document.blocks[connection.targetId]
  if (!source || !target) return ''

  const points = routeConnection(
    source,
    target,
    resolveAnchors(connection, source, target),
  )
  const path = pathFromPoints(points, CONNECTION_CORNER_RADIUS)
  const markerId = markerIdForStroke(connection.style?.stroke)

  return (
    `<path class="connection__line" d="${escapeAttribute(path)}"` +
    `${styleAttribute(connectionLineStyle(connection.style))}` +
    ` marker-end="url(#${escapeAttribute(markerId)})" />`
  )
}

/**
 * The diagram as SVG markup, or `null` when there is nothing to export.
 *
 * **An empty diagram exports nothing at all**, and the toolbar disables the
 * buttons accordingly. The alternatives were a fixed-size blank rectangle and
 * a zero-sized file, and both are worse in the same way: they hand back
 * something that looks like a successful export and opens as a blank page,
 * which is indistinguishable from a bug that ate the user's diagram. Refusing
 * is the only outcome that cannot be mistaken for a broken one.
 */
export function exportSvg(
  document: DocumentSlice,
  { theme, margin = EXPORT_MARGIN, background }: SvgExportOptions,
): SvgExport | null {
  const bounds = contentBounds(document)
  if (bounds === null) return null

  /*
   * The frame comes from the content, never from the viewport. Where the
   * camera happened to be sitting is a property of one person's session — it
   * is not even saved with the document — and an export that depended on it
   * would give two people different files for the same diagram.
   */
  const x = round(bounds.x - margin)
  const y = round(bounds.y - margin)
  const width = round(Math.max(bounds.width + margin * 2, 1))
  const height = round(Math.max(bounds.height + margin * 2, 1))

  const fill = background === undefined ? THEMES[theme].surface : background
  const backdrop =
    fill === null
      ? ''
      : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeAttribute(fill)}" />`

  // Only the markers something points at: the default when any arrow is
  // unstyled, plus one per colour actually in use.
  const connections = connectionsOf(document)
  const strokes = arrowMarkerStrokes(connections)
  const needsDefault = connections.some(
    (connection) => connection.style?.stroke === undefined,
  )
  const markers = [
    ...(needsDefault ? [marker(markerIdForStroke(undefined), undefined)] : []),
    ...strokes.map((stroke) => marker(markerIdForStroke(stroke), stroke)),
  ]
  const defs = markers.length > 0 ? `<defs>${markers.join('')}</defs>` : ''

  const blocks = document.blockOrder
    .map((id) => document.blocks[id])
    .filter((block): block is Block => block !== undefined)

  const markup = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="${x} ${y} ${width} ${height}">`,
    `\n  <style>\n    ${styleSheet(theme)}\n  </style>\n  `,
    defs,
    backdrop,
    // Arrows under blocks, as on the canvas, so an arrow never covers the box
    // it points at.
    ...connections.map((connection) => connectionMarkup(connection, document)),
    ...blocks.map(blockMarkup),
    `\n</svg>\n`,
  ].join('')

  return { markup, width, height }
}
