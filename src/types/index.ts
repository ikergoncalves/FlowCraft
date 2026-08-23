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
