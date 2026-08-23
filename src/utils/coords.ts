import type { CanvasRect, Point, Viewport } from '../types'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 }

/** Base grid spacing, in world units. Phase 3 snaps to this. */
export const GRID_SIZE = 20

/** Keeps `zoom` inside [MIN_ZOOM, MAX_ZOOM]. `NaN` collapses to the minimum. */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Client (screen) pixels -> world units. */
export function screenToWorld(point: Point, viewport: Viewport, rect: CanvasRect): Point {
  return {
    x: viewport.x + (point.x - rect.left) / viewport.zoom,
    y: viewport.y + (point.y - rect.top) / viewport.zoom,
  }
}

/** World units -> client (screen) pixels. Inverse of `screenToWorld`. */
export function worldToScreen(point: Point, viewport: Viewport, rect: CanvasRect): Point {
  return {
    x: rect.left + (point.x - viewport.x) * viewport.zoom,
    y: rect.top + (point.y - viewport.y) * viewport.zoom,
  }
}

/**
 * A screen-pixel drag vector expressed in world units.
 *
 * Dividing by the zoom is what keeps a dragged block glued to the cursor at
 * any zoom level: at 2× the pointer covers twice the pixels per world unit.
 * Unlike `screenToWorld` this takes no `CanvasRect` — a delta is translation
 * free, so the canvas offset cancels out.
 */
export function screenDeltaToWorld(delta: Point, zoom: number): Point {
  const safeZoom = clampZoom(zoom)
  return { x: delta.x / safeZoom, y: delta.y / safeZoom }
}

/**
 * The `viewBox` that makes an `<svg>` of `rect`'s pixel size show exactly the
 * world region described by `viewport`. Pan/zoom lives here rather than in a
 * CSS transform so that world units stay the SVG user-space units.
 */
export function viewBoxFor(viewport: Viewport, rect: CanvasRect): string {
  // Guard against a 0x0 rect (first paint, or a detached element in tests):
  // an empty viewBox makes the whole SVG blank.
  const width = Math.max(rect.width, 1) / viewport.zoom
  const height = Math.max(rect.height, 1) / viewport.zoom
  return `${viewport.x} ${viewport.y} ${width} ${height}`
}

/**
 * Zooms to `nextZoom` while pinning the world point currently under
 * `screenPoint` to that same screen position — "zoom at cursor".
 */
export function zoomAtPoint(
  viewport: Viewport,
  screenPoint: Point,
  rect: CanvasRect,
  nextZoom: number,
): Viewport {
  const zoom = clampZoom(nextZoom)
  const anchor = screenToWorld(screenPoint, viewport, rect)
  return {
    zoom,
    x: anchor.x - (screenPoint.x - rect.left) / zoom,
    y: anchor.y - (screenPoint.y - rect.top) / zoom,
  }
}

/** How aggressively a wheel notch changes the zoom. */
export const ZOOM_WHEEL_SENSITIVITY = 0.0015

/**
 * Multiplicative zoom step for one wheel event. Exponential so that zooming
 * in and back out by the same delta returns to the original zoom.
 */
export function zoomFactorForWheel(deltaY: number, deltaMode = 0): number {
  // deltaMode 0 = pixels, 1 = lines, 2 = pages. Normalise to pixels.
  const perLine = 16
  const perPage = 400
  const pixels =
    deltaMode === 1 ? deltaY * perLine : deltaMode === 2 ? deltaY * perPage : deltaY
  return Math.exp(-pixels * ZOOM_WHEEL_SENSITIVITY)
}

/**
 * Pans by a screen-space drag vector. Dragging right moves the content right,
 * which means the camera moves left — hence the subtraction.
 */
export function panByScreenDelta(viewport: Viewport, dx: number, dy: number): Viewport {
  return {
    ...viewport,
    x: viewport.x - dx / viewport.zoom,
    y: viewport.y - dy / viewport.zoom,
  }
}

/**
 * Visual grid spacing in world units: `GRID_SIZE` doubled as needed so the
 * drawn lattice never gets denser than `minScreenSpacing` pixels. Snapping
 * still uses `GRID_SIZE`; this only keeps the backdrop readable when zoomed
 * far out.
 */
export function gridStepForZoom(zoom: number, minScreenSpacing = 12): number {
  const safeZoom = clampZoom(zoom)
  let step = GRID_SIZE
  while (step * safeZoom < minScreenSpacing) {
    step *= 2
  }
  return step
}
