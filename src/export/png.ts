import type { SvgExport } from './svg'

/**
 * The same SVG, rasterised.
 *
 * The PNG is produced *from the exported SVG* rather than from a second
 * renderer: it is drawn into a `<canvas>` with `drawImage` and read back out.
 * That guarantees the two exports cannot drift — there is only one description
 * of the picture, and the PNG is a photograph of it.
 *
 * **No `foreignObject`, and therefore no font problem.** Rasterising an SVG
 * that embeds HTML is where this normally goes wrong: browsers refuse to draw
 * a `foreignObject` subtree into a canvas, or draw it without its styles, and
 * the failure is silent. FlowCraft's labels are plain `<text>`, and the only
 * HTML in the editor — the text-input overlay — is not part of the document at
 * all. The one remaining risk is the font: the export names a system stack, so
 * the rasteriser resolves it from the same machine that displayed it.
 */

export const PNG_SCALES = [1, 2] as const
export type PngScale = (typeof PNG_SCALES)[number]

export interface PngOptions {
  scale: PngScale
  /**
   * A colour to paint under the image, or `null` for transparency.
   *
   * **Opaque by default, and that is a real decision.** A transparent PNG of a
   * dark-theme diagram is white text and pale strokes on nothing; dropped into
   * a document with a white page — which is to say most documents — it is
   * invisible, and the user has no way to tell from the thumbnail. Transparent
   * is genuinely useful for compositing, so it stays available; it is just not
   * what someone who clicked "PNG" and pasted the result into a report meant.
   */
  background: string | null
}

/** The pixel size a given scale produces. Exact, so callers can show it. */
export function pngSize(
  svg: SvgExport,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(svg.width * scale)),
    height: Math.max(1, Math.round(svg.height * scale)),
  }
}

/**
 * How big a canvas the guard below is willing to ask for.
 *
 * Deliberately conservative rather than per-browser. There is no way to ask a
 * browser what its limit is — the only honest test is to allocate a canvas and
 * see whether it comes back broken — and the numbers vary by engine, platform
 * and available memory. Chrome and Firefox cap a side at 32767 and the area
 * near 2^28 pixels; Safari on iOS has historically been far lower. 16384 and
 * 2^28 sit inside every one of them.
 */
export const MAX_PNG_DIMENSION = 16384
export const MAX_PNG_AREA = 268_435_456

/**
 * Why a size cannot be rasterised, or `null` if it can.
 *
 * **Checked up front rather than discovered.** Assigning an oversized
 * `canvas.width` does not throw: the canvas comes back unusable and `toBlob`
 * hands over `null`, which this module already turns into "The canvas produced
 * no image". That message is true and useless — it describes the symptom, says
 * nothing about the cause, and leaves the user with no idea that 1x would have
 * worked. Refusing early costs two comparisons and lets the message name the
 * actual problem and the actual remedy.
 */
export function pngSizeError(size: { width: number; height: number }): string | null {
  const fits =
    size.width <= MAX_PNG_DIMENSION &&
    size.height <= MAX_PNG_DIMENSION &&
    size.width * size.height <= MAX_PNG_AREA
  if (fits) return null

  const limit = `${String(MAX_PNG_DIMENSION)}px per side and ${String(
    MAX_PNG_AREA / 1_000_000,
  )} megapixels`
  return (
    `This diagram is ${String(size.width)}×${String(size.height)} at that scale, ` +
    `past the ${limit} a browser canvas allows. ` +
    `Try a smaller scale, or export SVG — it has no size limit.`
  )
}

/** Loads the markup as an image, via a blob URL that is always revoked. */
function loadImage(markup: string): Promise<{ image: HTMLImageElement; url: string }> {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({ image, url })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      // A decode failure here means the markup is not valid SVG, which would
      // be a bug in the exporter rather than anything the user did.
      reject(new Error('The exported SVG could not be rendered'))
    }
    image.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The canvas produced no image'))
    }, 'image/png')
  })
}

/**
 * Rasterises an exported SVG.
 *
 * Rejects rather than returning a blank image if anything goes wrong. A PNG
 * that is quietly the wrong picture is worse than an error message: the user
 * finds out about the first one after they have sent it to someone.
 */
export async function renderPng(
  svg: SvgExport,
  { scale, background }: PngOptions,
): Promise<Blob> {
  const size = pngSize(svg, scale)
  const tooBig = pngSizeError(size)
  if (tooBig) throw new Error(tooBig)

  const { width, height } = size
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot rasterise to a canvas')

  const { image, url } = await loadImage(svg.markup)
  try {
    if (background !== null) {
      context.fillStyle = background
      context.fillRect(0, 0, width, height)
    }
    // Scaling happens in `drawImage` rather than by enlarging the SVG's own
    // width and height: the vector is re-rendered at the target size, so 2x is
    // genuinely twice the detail rather than a doubled bitmap.
    context.drawImage(image, 0, 0, width, height)
    return await toBlob(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}
