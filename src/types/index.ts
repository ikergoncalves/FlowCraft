/** A point. Unless a name says otherwise, coordinates are in world space. */
export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

/**
 * The canvas element's box in *client* (screen) pixels. Structurally a subset
 * of `DOMRect`, so a `DOMRect` can be passed wherever this is expected.
 */
export interface CanvasRect extends Size {
  left: number
  top: number
}

/**
 * The camera over the diagram.
 *
 * `x`/`y` are the world-space coordinates of the top-left corner of the
 * visible area; `zoom` is screen pixels per world unit. This maps directly
 * onto the `<svg viewBox>` we render with — see `viewBoxFor`.
 */
export interface Viewport extends Point {
  zoom: number
}

export type BlockType = 'rect' | 'text'

/**
 * Per-block visual overrides. Every field is optional and nothing reads them
 * yet: Phase 5 (styling) fills this in without reshaping `Block`.
 */
export interface BlockStyle {
  fill?: string
  stroke?: string
  strokeWidth?: number
  fontSize?: number
}

/** A diagram node. `x`/`y`/`width`/`height` are world space, never pixels. */
export interface Block extends Point, Size {
  id: string
  type: BlockType
  text: string
  style?: BlockStyle
}

export type Tool = 'select' | 'rect' | 'text'

/** Which edge of a block a connection leaves from or arrives at. */
export type AnchorSide = 'n' | 'e' | 's' | 'w'

/** Every side, in clockwise order starting at the top. */
export const ANCHOR_SIDES: readonly AnchorSide[] = ['n', 'e', 's', 'w']

/**
 * Per-connection visual overrides. Empty of meaning until Phase 5, exactly
 * like `BlockStyle`.
 */
export interface ConnectionStyle {
  stroke?: string
  strokeWidth?: number
  dashed?: boolean
}

/**
 * An arrow from one block to another.
 *
 * It stores *ids only* — never endpoint coordinates. Every point of the drawn
 * polyline is derived from the two blocks' current rects at render time, which
 * is the whole reason arrows follow their blocks around with no synchronising
 * code anywhere. Anchors are optional: absent means "pick the sides from the
 * blocks' relative positions", so a connection re-routes itself sensibly when
 * a block is dragged to the other side of its partner.
 */
export interface Connection {
  id: string
  sourceId: string
  targetId: string
  sourceAnchor?: AnchorSide
  targetAnchor?: AnchorSide
  style?: ConnectionStyle
}
